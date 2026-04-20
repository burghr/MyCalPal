import asyncio
import logging
import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
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
FATSECRET_TOKEN_URL = "https://oauth.fatsecret.com/connect/token"
FATSECRET_API_URL = "https://platform.fatsecret.com/rest/server.api"
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
                    "requireAllWords": True,
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


def _score_food(food: dict, q: str) -> int:
    """Rank a branded-source result for the search query.

    Higher is better. Rewards real branded serving sizes (not the 100 g fallback),
    presence of a brand, and matches against query tokens in name/brand.
    """
    s = 0
    g = food.get("serving_size_g")
    # Real branded per-serving grams (not the 100g fallback) means the calorie
    # math on the card reflects how the product is actually eaten.
    if g and abs(g - 100.0) > 0.1:
        s += 3
    if food.get("brand"):
        s += 1
    text = f"{food.get('name') or ''} {food.get('brand') or ''}".lower()
    tokens = [t for t in q.lower().split() if t]
    if tokens:
        hits = sum(1 for t in tokens if t in text)
        if hits == len(tokens):
            s += 2
        elif hits:
            s += 1
    return s


# FatSecret uses OAuth2 client-credentials; tokens live 24h. Cache in-process.
_fs_token: dict = {"access_token": None, "expires_at": 0.0}


async def _fatsecret_token(client: httpx.AsyncClient) -> str | None:
    if not (settings.FATSECRET_CLIENT_ID and settings.FATSECRET_CLIENT_SECRET):
        return None
    if _fs_token["access_token"] and time.time() < _fs_token["expires_at"] - 60:
        return _fs_token["access_token"]
    r = await client.post(
        FATSECRET_TOKEN_URL,
        data={"grant_type": "client_credentials", "scope": "basic"},
        auth=(settings.FATSECRET_CLIENT_ID, settings.FATSECRET_CLIENT_SECRET),
    )
    if r.status_code != 200:
        log.warning("FatSecret token request failed %s: %s", r.status_code, r.text)
    r.raise_for_status()
    data = r.json()
    _fs_token["access_token"] = data["access_token"]
    _fs_token["expires_at"] = time.time() + float(data.get("expires_in", 3600))
    return _fs_token["access_token"]


_FS_DESC_RE = re.compile(
    r"Per\s+(?P<serving>[^-]+?)\s*-\s*Calories:\s*(?P<cal>[\d.]+)kcal"
    r"(?:\s*\|\s*Fat:\s*(?P<fat>[\d.]+)g)?"
    r"(?:\s*\|\s*Carbs:\s*(?P<carb>[\d.]+)g)?"
    r"(?:\s*\|\s*Protein:\s*(?P<pro>[\d.]+)g)?",
    re.IGNORECASE,
)


def _fs_parse_serving_label(label: str) -> tuple[float, str, float | None]:
    """Parse a FatSecret serving label like '1 cup (240g)' or '100g' or '1 bar'.
    Returns (amount, unit, grams_or_None).
    """
    label = label.strip()
    # "1 cup (240g)" / "1 bar (50 g)"
    m = re.match(r"^(\d+(?:\.\d+)?)\s+([^()]+?)\s*\(\s*(\d+(?:\.\d+)?)\s*g\s*\)$", label, re.I)
    if m:
        return float(m.group(1)), m.group(2).strip(), float(m.group(3))
    # "100g" / "240 ml"
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(g|ml|oz)$", label, re.I)
    if m:
        grams = float(m.group(1)) if m.group(2).lower() == "g" else None
        return float(m.group(1)), m.group(2).lower(), grams
    # "1 cup"
    m = re.match(r"^(\d+(?:\.\d+)?)\s+(.+)$", label)
    if m:
        return float(m.group(1)), m.group(2).strip(), None
    return 1.0, label or "serving", None


def _fs_search_item_to_food(item: dict) -> dict | None:
    """Map a foods.search item (has food_description string) to our food dict."""
    desc = item.get("food_description") or ""
    m = _FS_DESC_RE.search(desc)
    if not m:
        return None
    amount, unit, grams = _fs_parse_serving_label(m.group("serving"))
    return {
        "name": item.get("food_name") or "Unknown",
        "brand": item.get("brand_name"),
        "barcode": None,
        "serving_amount": amount,
        "serving_unit": unit,
        "serving_size_g": grams,
        "calories_per_serving": float(m.group("cal")),
        "protein_g": float(m.group("pro") or 0),
        "carbs_g": float(m.group("carb") or 0),
        "fat_g": float(m.group("fat") or 0),
        "fiber_g": 0.0,  # not in search response; populated via food.get if picked
    }


def _fs_food_to_dict(food: dict, barcode: str | None = None) -> dict | None:
    """Map a food.get.v4 response to our food dict (picks first serving)."""
    servings = (food.get("servings") or {}).get("serving")
    if isinstance(servings, dict):
        servings = [servings]
    if not servings:
        return None
    s = servings[0]
    try:
        cal = float(s.get("calories") or 0)
    except (TypeError, ValueError):
        return None
    if not cal:
        return None
    amount = float(s.get("number_of_units") or 1)
    unit = s.get("measurement_description") or "serving"
    grams = s.get("metric_serving_amount")
    if grams and (s.get("metric_serving_unit") or "").lower() == "g":
        grams = float(grams)
    else:
        grams = None
    return {
        "name": food.get("food_name") or "Unknown",
        "brand": food.get("brand_name"),
        "barcode": barcode,
        "serving_amount": amount,
        "serving_unit": unit,
        "serving_size_g": grams,
        "calories_per_serving": cal,
        "protein_g": float(s.get("protein") or 0),
        "carbs_g": float(s.get("carbohydrate") or 0),
        "fat_g": float(s.get("fat") or 0),
        "fiber_g": float(s.get("fiber") or 0),
    }


async def _fatsecret_search(q: str) -> tuple[list[dict], str | None]:
    if not (settings.FATSECRET_CLIENT_ID and settings.FATSECRET_CLIENT_SECRET):
        return [], None
    try:
        async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": USER_AGENT}) as client:
            token = await _fatsecret_token(client)
            if not token:
                return [], None
            r = await client.get(
                FATSECRET_API_URL,
                params={
                    "method": "foods.search",
                    "search_expression": q,
                    "max_results": 20,
                    "format": "json",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        log.warning("FatSecret search failed for %r: %s", q, e)
        return [], f"FatSecret unavailable: {e}"

    if "error" in data:
        err = data["error"]
        msg = f"{err.get('code')}: {err.get('message')}"
        log.warning("FatSecret API error for %r: %s", q, msg)
        return [], f"FatSecret error: {msg}"

    foods = (data.get("foods") or {}).get("food") or []
    if isinstance(foods, dict):
        foods = [foods]
    out = []
    for item in foods:
        mapped = _fs_search_item_to_food(item)
        if mapped and mapped["calories_per_serving"]:
            out.append({"food": mapped, "fs_food_id": item.get("food_id")})
    return out, None


async def _fatsecret_barcode(barcode: str) -> dict | None:
    """Look up a GTIN-13 barcode on FatSecret. Returns our mapped food dict or None."""
    if not (settings.FATSECRET_CLIENT_ID and settings.FATSECRET_CLIENT_SECRET):
        return None
    # FatSecret requires GTIN-13; UPC-A (12) pads a leading zero.
    gtin = barcode.zfill(13) if barcode.isdigit() and len(barcode) <= 13 else barcode
    try:
        async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": USER_AGENT}) as client:
            token = await _fatsecret_token(client)
            if not token:
                return None
            r = await client.get(
                FATSECRET_API_URL,
                params={"method": "food.find_id_for_barcode", "barcode": gtin, "format": "json"},
                headers={"Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
            data = r.json()
            food_id = (data.get("food_id") or {}).get("value") if isinstance(data.get("food_id"), dict) else data.get("food_id")
            if not food_id or str(food_id) == "0":
                return None
            r2 = await client.get(
                FATSECRET_API_URL,
                params={"method": "food.get.v4", "food_id": food_id, "format": "json"},
                headers={"Authorization": f"Bearer {token}"},
            )
            r2.raise_for_status()
            food = (r2.json() or {}).get("food")
            if not food:
                return None
            return _fs_food_to_dict(food, barcode=barcode)
    except Exception as e:
        log.warning("FatSecret barcode %s failed: %s", barcode, e)
        return None


@router.get("/recent")
def recent_foods(
    limit: int = 10,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the user's most-recently-logged distinct foods."""
    from ..models import FoodLog
    # Latest log timestamp per food_id for this user
    sub = (
        db.query(FoodLog.food_id, func.max(FoodLog.created_at).label("last"))
        .filter(FoodLog.user_id == user.id)
        .group_by(FoodLog.food_id)
        .subquery()
    )
    rows = (
        db.query(Food)
        .join(sub, sub.c.food_id == Food.id)
        .order_by(sub.c.last.desc())
        .limit(limit)
        .all()
    )
    return [
        {"source": f.source, "food": FoodOut.model_validate(f).model_dump(), "local_id": f.id}
        for f in rows
    ]


@router.get("/search")
async def search_foods(
    q: str = Query(min_length=1),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Search local foods + Open Food Facts. Returns results plus an off_error field if OFF failed."""
    # Order: USDA (richest portion data) → local saved → Open Food Facts.
    results: list[dict] = []

    # Branded sources (USDA + FatSecret) are merged and scored together so the
    # best match floats to the top regardless of which API it came from. Local
    # saved foods come next, Open Food Facts last (its serving-size handling
    # is the least reliable).
    scored: list[tuple[int, dict]] = []

    (usda_results, usda_error), (fs_results, fs_error), (off_results, off_error) = await asyncio.gather(
        _usda_search(q),
        _fatsecret_search(q),
        _off_search(q),
    )

    for r in usda_results:
        scored.append((_score_food(r["food"], q), {
            "source": "usda",
            "food": r["food"],
            "local_id": None,
            "fdc_id": r["fdc_id"],
        }))

    for r in fs_results:
        scored.append((_score_food(r["food"], q), {
            "source": "fatsecret",
            "food": r["food"],
            "local_id": None,
            "fs_food_id": r["fs_food_id"],
        }))

    scored.sort(key=lambda t: t[0], reverse=True)
    results.extend(r for _, r in scored)

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

    for m in off_results:
        results.append({"source": "openfoodfacts", "food": m, "local_id": None})

    return {"results": results, "off_error": off_error, "usda_error": usda_error, "fs_error": fs_error}


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


@router.get("/fatsecret/{food_id}")
async def fatsecret_detail(
    food_id: int,
    user: User = Depends(get_current_user),
):
    """Fetch a FatSecret food with its full nutrient + portion list."""
    if not (settings.FATSECRET_CLIENT_ID and settings.FATSECRET_CLIENT_SECRET):
        raise HTTPException(503, "FatSecret credentials not configured")
    try:
        async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": USER_AGENT}) as client:
            token = await _fatsecret_token(client)
            if not token:
                raise HTTPException(502, "FatSecret auth failed")
            r = await client.get(
                FATSECRET_API_URL,
                params={"method": "food.get.v4", "food_id": food_id, "format": "json"},
                headers={"Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
            data = r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"FatSecret fetch failed: {e}")

    if "error" in data:
        raise HTTPException(502, f"FatSecret error: {data['error'].get('message')}")

    food = data.get("food") or {}
    servings = (food.get("servings") or {}).get("serving") or []
    if isinstance(servings, dict):
        servings = [servings]
    if not servings:
        raise HTTPException(404, "Food has no serving data")

    # Prefer a non-gram branded serving (e.g. "1 cup") over a 100 g canonical entry.
    primary = next(
        (s for s in servings if (s.get("measurement_description") or "").lower() not in ("g", "gram", "grams", "")),
        servings[0],
    )
    mapped = _fs_food_to_dict({**food, "servings": {"serving": [primary]}})
    if not mapped:
        raise HTTPException(404, "Food missing calorie data")

    portions = []
    for s in servings:
        grams = s.get("metric_serving_amount")
        unit = (s.get("metric_serving_unit") or "").lower()
        if not grams or unit != "g":
            continue
        amount = float(s.get("number_of_units") or 1)
        measure = s.get("measurement_description") or "serving"
        label = s.get("serving_description") or f"{amount} {measure}"
        portions.append({
            "label": label,
            "amount": amount,
            "unit": measure,
            "grams": float(grams),
        })

    seen = set()
    unique = []
    for p in portions:
        if p["label"] in seen:
            continue
        seen.add(p["label"])
        unique.append(p)

    return {"food": mapped, "portions": unique, "fs_food_id": food_id}


@router.get("/barcode/{barcode}")
async def barcode_lookup(
    barcode: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    local = db.query(Food).filter(Food.barcode == barcode).first()
    if local:
        return {"source": local.source, "food": FoodOut.model_validate(local).model_dump(), "local_id": local.id}

    fs_mapped = await _fatsecret_barcode(barcode)
    if fs_mapped:
        return {"source": "fatsecret", "food": fs_mapped, "local_id": None}

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
