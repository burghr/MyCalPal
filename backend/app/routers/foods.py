import logging
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import settings
from ..database import get_db
from ..models import Food, User
from ..schemas import FoodCreate, FoodOut

log = logging.getLogger("mycalpal.foods")

router = APIRouter(prefix="/foods", tags=["foods"])

OFF_SEARCH_V1 = "https://world.openfoodfacts.org/cgi/search.pl"
OFF_SEARCH_V2 = "https://world.openfoodfacts.org/api/v2/search"
OFF_SEARCH_A_LA = "https://search.openfoodfacts.org/search"  # separate infra
OFF_BARCODE_URL = "https://world.openfoodfacts.org/api/v2/product/{barcode}.json"
USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"
USDA_DETAIL_URL = "https://api.nal.usda.gov/fdc/v1/food/{fdc_id}"
USER_AGENT = "MyCalPal/0.1 (contact: local-dev)"
OFF_FIELDS = "code,product_name,generic_name,brands,nutriments"

# USDA nutrient IDs (per-100g basis for Foundation/SR Legacy/Survey food types)
USDA_NUTRIENTS = {"cal": 1008, "protein": 1003, "fat": 1004, "carbs": 1005, "fiber": 1079}


def _coerce_str(val) -> str | None:
    """OFF sometimes returns lists (e.g. brands) from the search.openfoodfacts.org endpoint."""
    if val is None:
        return None
    if isinstance(val, list):
        return ", ".join(str(v) for v in val if v) or None
    return str(val) or None


def _off_to_food_dict(product: dict) -> dict | None:
    """Map an Open Food Facts product to our FoodBase-shaped dict. Returns None if missing calories."""
    nutriments = product.get("nutriments") or {}
    kcal = nutriments.get("energy-kcal_100g") or nutriments.get("energy-kcal_serving")
    if kcal is None:
        return None
    name = _coerce_str(product.get("product_name")) or _coerce_str(product.get("generic_name")) or "Unknown"
    return {
        "name": name,
        "brand": _coerce_str(product.get("brands")),
        "barcode": _coerce_str(product.get("code")),
        "serving_amount": 100.0,
        "serving_unit": "g",
        "serving_size_g": 100.0,
        "calories_per_serving": float(kcal),
        "protein_g": float(nutriments.get("proteins_100g") or 0),
        "carbs_g": float(nutriments.get("carbohydrates_100g") or 0),
        "fat_g": float(nutriments.get("fat_100g") or 0),
        "fiber_g": float(nutriments.get("fiber_100g") or 0),
    }


def _usda_nutrient(nutrients: list[dict], nid: int) -> float:
    for n in nutrients or []:
        if n.get("nutrientId") == nid or n.get("nutrient", {}).get("id") == nid:
            return float(n.get("value") or n.get("amount") or 0)
    return 0.0


def _usda_to_food_dict(item: dict) -> dict:
    """Map a USDA FDC search item to our FoodBase-shaped dict.

    Nutrients from USDA are per 100 g. If the item has a branded serving size
    in grams, scale nutrients to that serving so search results show e.g.
    "70 kcal / 1 bar" instead of "280 kcal / 100 g".
    """
    nuts = item.get("foodNutrients") or []
    name = item.get("description") or "Unknown"
    brand = item.get("brandOwner") or item.get("brandName")

    cal_100 = _usda_nutrient(nuts, USDA_NUTRIENTS["cal"])
    protein_100 = _usda_nutrient(nuts, USDA_NUTRIENTS["protein"])
    carbs_100 = _usda_nutrient(nuts, USDA_NUTRIENTS["carbs"])
    fat_100 = _usda_nutrient(nuts, USDA_NUTRIENTS["fat"])
    fiber_100 = _usda_nutrient(nuts, USDA_NUTRIENTS["fiber"])

    serving_amount = 100.0
    serving_unit = "g"
    serving_g = 100.0
    scale = 1.0

    unit_raw = (item.get("servingSizeUnit") or "").lower()
    if item.get("servingSize") and unit_raw in ("g", "gram", "grm"):
        serving_g = float(item["servingSize"])
        scale = serving_g / 100.0
        label = (item.get("householdServingFullText") or "").strip()
        m = re.match(r"^(\d+(?:\.\d+)?)\s+(.+)$", label) if label else None
        if m:
            serving_amount = float(m.group(1))
            serving_unit = m.group(2)
        elif label:
            serving_amount = 1.0
            serving_unit = label
        else:
            serving_amount = serving_g
            serving_unit = "g"

    return {
        "name": name,
        "brand": brand,
        "barcode": item.get("gtinUpc"),
        "serving_amount": serving_amount,
        "serving_unit": serving_unit,
        "serving_size_g": serving_g,
        "calories_per_serving": round(cal_100 * scale, 1),
        "protein_g": round(protein_100 * scale, 1),
        "carbs_g": round(carbs_100 * scale, 1),
        "fat_g": round(fat_100 * scale, 1),
        "fiber_g": round(fiber_100 * scale, 1),
    }


async def _usda_search(q: str) -> tuple[list[dict], str | None]:
    """Search USDA FoodData Central. Returns list of {food, fdc_id}."""
    if not settings.USDA_API_KEY:
        return [], None  # silently disabled
    try:
        async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": USER_AGENT}) as client:
            r = await client.post(
                USDA_SEARCH_URL,
                params={"api_key": settings.USDA_API_KEY},
                json={
                    "query": q,
                    "pageSize": 15,
                    "dataType": ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"],
                },
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        log.warning("USDA search failed for %r: %s", q, e)
        return [], f"USDA unavailable: {e}"

    out = []
    for item in data.get("foods", []) or []:
        mapped = _usda_to_food_dict(item)
        if mapped["calories_per_serving"]:
            out.append({"food": mapped, "fdc_id": item.get("fdcId")})
    return out, None


async def _try_endpoint(client: httpx.AsyncClient, url: str, params: dict) -> list[dict]:
    """One attempt at an OFF endpoint. Raises on failure so caller can fall through."""
    r = await client.get(url, params=params)
    r.raise_for_status()
    data = r.json()
    # search.openfoodfacts.org returns {"hits": [...]}; world.openfoodfacts.org returns {"products": [...]}
    return data.get("products") or data.get("hits") or []


async def _off_search(q: str) -> tuple[list[dict], str | None]:
    """Try multiple OFF endpoints. Returns (mapped_products, error_message_if_all_failed)."""
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    last_err: str | None = None
    products: list[dict] = []

    attempts = [
        (OFF_SEARCH_A_LA, {"q": q, "page_size": 20, "fields": OFF_FIELDS}),
        (OFF_SEARCH_V2, {"search_terms": q, "page_size": 20, "fields": OFF_FIELDS}),
        (OFF_SEARCH_V1, {
            "search_terms": q, "search_simple": 1, "action": "process",
            "json": 1, "page_size": 20, "fields": OFF_FIELDS,
        }),
    ]

    async with httpx.AsyncClient(timeout=15.0, headers=headers, follow_redirects=True) as client:
        for url, params in attempts:
            try:
                products = await _try_endpoint(client, url, params)
                if products:
                    last_err = None
                    break
            except Exception as e:
                last_err = f"{url.split('/')[2]}: {e}"
                log.warning("OFF endpoint %s failed for %r: %s", url, q, e)
                continue

    mapped: list[dict] = []
    for p in products:
        m = _off_to_food_dict(p)
        if m:
            mapped.append(m)
    return mapped, (None if mapped else last_err)


@router.get("/search")
async def search_foods(
    q: str = Query(min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Search local foods + Open Food Facts. Returns results plus an off_error field if OFF failed."""
    # Order: USDA (richest portion data) → local saved → Open Food Facts.
    results: list[dict] = []

    usda_results, usda_error = await _usda_search(q)
    for r in usda_results:
        results.append({
            "source": "usda",
            "food": r["food"],
            "local_id": None,
            "fdc_id": r["fdc_id"],
        })

    local = (
        db.query(Food)
        .filter(or_(Food.name.ilike(f"%{q}%"), Food.brand.ilike(f"%{q}%")))
        .limit(10)
        .all()
    )
    for f in local:
        results.append(
            {"source": f.source, "food": FoodOut.model_validate(f).model_dump(), "local_id": f.id}
        )

    off_results, off_error = await _off_search(q)
    for m in off_results:
        results.append({"source": "openfoodfacts", "food": m, "local_id": None})

    return {"results": results, "off_error": off_error, "usda_error": usda_error}


@router.get("/usda/{fdc_id}")
async def usda_detail(
    fdc_id: int,
    user: User = Depends(get_current_user),
):
    """Fetch a USDA food + its available portions (cup, tbsp, etc. with gram weights)."""
    if not settings.USDA_API_KEY:
        raise HTTPException(503, "USDA_API_KEY not configured")
    try:
        async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": USER_AGENT}) as client:
            r = await client.get(USDA_DETAIL_URL.format(fdc_id=fdc_id), params={"api_key": settings.USDA_API_KEY})
            r.raise_for_status()
            item = r.json()
    except Exception as e:
        raise HTTPException(502, f"USDA fetch failed: {e}")

    food = _usda_to_food_dict(item)

    portions = []
    # Branded foods: use servingSize / householdServingFullText
    if item.get("servingSize") and item.get("servingSizeUnit"):
        label = item.get("householdServingFullText") or f'{item["servingSize"]} {item["servingSizeUnit"]}'
        grams = item["servingSize"] if item["servingSizeUnit"].lower() in ("g", "gram", "grm") else None
        if grams:
            m = re.match(r"^(\d+(?:\.\d+)?)\s+(.+)$", label.strip())
            amt = float(m.group(1)) if m else 1.0
            unit = m.group(2) if m else label
            portions.append({"label": label, "amount": amt, "unit": unit, "grams": float(grams)})

    # Foundation/SR/Survey: foodPortions array with gramWeight
    for p in item.get("foodPortions") or []:
        grams = p.get("gramWeight")
        if not grams:
            continue
        amount = p.get("amount") or 1
        modifier = p.get("modifier") or ""
        measure = (p.get("measureUnit") or {}).get("name") or ""
        if measure in ("", "undetermined"):
            measure = modifier
            modifier = ""
        desc = p.get("portionDescription") or f'{amount} {measure} {modifier}'.strip()
        portions.append({
            "label": desc,
            "amount": float(amount),
            "unit": measure or "serving",
            "grams": float(grams),
        })

    # Always offer a 100 g fallback
    portions.insert(0, {"label": "100 g", "amount": 100, "unit": "g", "grams": 100.0})

    # De-dupe by label
    seen = set()
    unique = []
    for p in portions:
        if p["label"] in seen:
            continue
        seen.add(p["label"])
        unique.append(p)

    return {"food": food, "portions": unique, "fdc_id": fdc_id}


@router.get("/barcode/{barcode}")
async def barcode_lookup(
    barcode: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    local = db.query(Food).filter(Food.barcode == barcode).first()
    if local:
        return {"source": local.source, "food": FoodOut.model_validate(local).model_dump(), "local_id": local.id}

    async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": USER_AGENT}) as client:
        r = await client.get(OFF_BARCODE_URL.format(barcode=barcode))
        r.raise_for_status()
        data = r.json()
    if data.get("status") != 1:
        raise HTTPException(404, "Barcode not found in Open Food Facts")
    mapped = _off_to_food_dict(data["product"])
    if not mapped:
        raise HTTPException(404, "Product found but no calorie data available")
    return {"source": "openfoodfacts", "food": mapped, "local_id": None}


@router.post("", response_model=FoodOut)
def create_food(
    payload: FoodCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Save a food to the local DB (manual entry or importing from OFF)."""
    if payload.barcode:
        existing = db.query(Food).filter(Food.barcode == payload.barcode).first()
        if existing:
            # Refresh nutrition/serving from the incoming payload — our mappers
            # may have improved (e.g. branded serving size detection) since the
            # row was first cached. Name/brand stay stable.
            for f in ("serving_amount", "serving_unit", "serving_size_g",
                      "calories_per_serving", "protein_g", "carbs_g",
                      "fat_g", "fiber_g"):
                setattr(existing, f, getattr(payload, f))
            db.commit()
            db.refresh(existing)
            return existing
    food = Food(
        **payload.model_dump(),
        source="manual" if not payload.barcode else "openfoodfacts",
        created_by_user_id=user.id,
    )
    db.add(food)
    db.commit()
    db.refresh(food)
    return food
