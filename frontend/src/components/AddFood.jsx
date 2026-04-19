import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../api'
import { useAuth } from '../auth.jsx'
import BarcodeScanner from './BarcodeScanner.jsx'
import { SERVING_UNITS, formatServing } from '../units'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const round1 = (x) => {
  const n = Number(x)
  if (!isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

function pickDefaultMeal() {
  const h = new Date().getHours()
  if (h < 10) return 'breakfast'
  if (h < 14) return 'lunch'
  if (h < 20) return 'dinner'
  return 'snack'
}

export default function AddFood() {
  const { token } = useAuth()
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const mealParam = sp.get('meal')
  const dateParam = sp.get('date')

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [offError, setOffError] = useState(null)
  const [searched, setSearched] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [selected, setSelected] = useState(null) // { food, local_id, fdc_id? }
  const [portions, setPortions] = useState([])   // USDA portions if available
  const [selectedPortion, setSelectedPortion] = useState('')
  const [edited, setEdited] = useState(false)
  const [servingAmount, setServingAmount] = useState(1)
  const [servingUnit, setServingUnit] = useState('serving')
  const [servingG, setServingG] = useState('')
  const [cals, setCals] = useState(0)
  const [protein, setProtein] = useState(0)
  const [carbs, setCarbs] = useState(0)
  const [fat, setFat] = useState(0)
  const [fiber, setFiber] = useState(0)
  // Per-gram nutrient density of the originally-selected food. Used to auto-scale
  // the serving panel when amount / unit / grams change. Null if unknown (e.g. no grams).
  const perG = useRef(null)
  const userOverrodeNutrition = useRef(false)
  const [manualMode, setManualMode] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [meal, setMeal] = useState(
    MEALS.includes(mealParam) ? mealParam : pickDefaultMeal()
  )
  const [servings, setServings] = useState(1)
  const [date, setDate] = useState(dateParam || todayISO())

  const [manual, setManual] = useState({
    name: '', brand: '',
    serving_amount: 1, serving_unit: 'serving', serving_size_g: '',
    calories_per_serving: 0,
    protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0,
  })

  const search = async (e) => {
    e?.preventDefault()
    if (!query.trim()) return
    setErr('')
    setBusy(true)
    try {
      const r = await apiFetch(`/foods/search?q=${encodeURIComponent(query)}`, { token })
      setResults(r.results || [])
      setOffError(r.off_error || null)
      setSearched(true)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const pickResult = async (r) => {
    setSelected(r)
    setEdited(false)
    userOverrodeNutrition.current = false
    setPortions([])
    setSelectedPortion('')

    const f = r.food
    const amount = f.serving_amount ?? 1
    const unit = f.serving_unit || 'serving'
    const baseG = (f.serving_size_g && f.serving_size_g > 0) ? f.serving_size_g
      : unit === 'g' ? amount
      : unit === 'oz' ? amount * 28.3495
      : unit === 'ml' ? amount
      : null

    perG.current = baseG ? {
      cal: f.calories_per_serving / baseG,
      p: (f.protein_g || 0) / baseG,
      c: (f.carbs_g || 0) / baseG,
      fat: (f.fat_g || 0) / baseG,
      fib: (f.fiber_g || 0) / baseG,
    } : null

    setServingAmount(amount)
    setServingUnit(unit)
    setServingG(f.serving_size_g ?? (unit === 'g' ? amount : ''))
    setCals(round1(f.calories_per_serving))
    setProtein(round1(f.protein_g || 0))
    setCarbs(round1(f.carbs_g || 0))
    setFat(round1(f.fat_g || 0))
    setFiber(round1(f.fiber_g || 0))

    // For USDA foods, fetch the list of portion options (1 cup = X g, etc.)
    if (r.source === 'usda' && r.fdc_id) {
      try {
        const detail = await apiFetch(`/foods/usda/${r.fdc_id}`, { token })
        const ps = detail.portions || []
        setPortions(ps)
        // Default to the first non-100g portion if one exists, else 100g.
        const def = ps.find(p => p.label !== '100 g') || ps[0]
        if (def) applyPortionFromObj(def)
      } catch (e) { /* non-fatal */ }
    }
  }

  const applyPortionFromObj = (p) => {
    setSelectedPortion(p.label)
    userOverrodeNutrition.current = false
    setEdited(true)
    setServingAmount(p.amount)
    setServingUnit(p.unit || 'serving')
    setServingG(p.grams)
  }

  const applyPortion = (label) => {
    if (!label) { setSelectedPortion(''); return }
    const p = portions.find(x => x.label === label)
    if (p) applyPortionFromObj(p)
  }

  // Auto-scale nutrients from the per-gram density whenever the effective grams change,
  // UNLESS the user has manually edited a nutrition field.
  useEffect(() => {
    if (!perG.current || userOverrodeNutrition.current) return
    const amtNum = Number(servingAmount) || 0
    const totalG = servingG && Number(servingG) > 0
      ? Number(servingG)
      : servingUnit === 'g' ? amtNum
      : servingUnit === 'oz' ? amtNum * 28.3495
      : servingUnit === 'ml' ? amtNum
      : null
    if (!totalG) return
    setCals(round1(perG.current.cal * totalG))
    setProtein(round1(perG.current.p * totalG))
    setCarbs(round1(perG.current.c * totalG))
    setFat(round1(perG.current.fat * totalG))
    setFiber(round1(perG.current.fib * totalG))
  }, [servingAmount, servingUnit, servingG])

  const onBarcode = async (code) => {
    setScanning(false)
    setErr('')
    setBusy(true)
    try {
      const r = await apiFetch(`/foods/barcode/${encodeURIComponent(code)}`, { token })
      pickResult(r)
      setResults([])
    } catch (e) {
      setErr(`${e.message} — try manual entry.`)
      setManual(m => ({ ...m, barcode: code }))
      setManualMode(true)
    } finally { setBusy(false) }
  }

  const saveAndLog = async () => {
    setErr('')
    setBusy(true)
    try {
      const payload = {
        ...selected.food,
        serving_amount: round1(servingAmount) || 1,
        serving_unit: servingUnit || 'serving',
        serving_size_g: servingG ? round1(servingG) : null,
        calories_per_serving: round1(cals),
        protein_g: round1(protein),
        carbs_g: round1(carbs),
        fat_g: round1(fat),
        fiber_g: round1(fiber),
      }
      let foodId = selected?.local_id
      if (!foodId) {
        const created = await apiFetch('/foods', { method: 'POST', token, body: payload })
        foodId = created.id
      } else if (edited) {
        // User edited a saved food — persist as a private copy without barcode to avoid mutating shared data.
        const created = await apiFetch('/foods', { method: 'POST', token, body: { ...payload, barcode: null } })
        foodId = created.id
      }
      await apiFetch('/logs', {
        method: 'POST', token,
        body: { food_id: foodId, log_date: date, meal, servings: Number(servings) },
      })
      nav('/')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const markEdited = () => setEdited(true)
  const editNutrition = (setter) => (e) => {
    userOverrodeNutrition.current = true
    setter(e.target.value)
    setEdited(true)
  }

  const saveManual = async () => {
    setErr('')
    setBusy(true)
    try {
      const created = await apiFetch('/foods', {
        method: 'POST', token,
        body: {
          name: manual.name,
          brand: manual.brand || null,
          serving_amount: Number(manual.serving_amount) || 1,
          serving_unit: manual.serving_unit || 'serving',
          serving_size_g: manual.serving_size_g ? Number(manual.serving_size_g) : null,
          calories_per_serving: Number(manual.calories_per_serving),
          protein_g: Number(manual.protein_g),
          carbs_g: Number(manual.carbs_g),
          fat_g: Number(manual.fat_g),
          fiber_g: Number(manual.fiber_g),
          barcode: manual.barcode || null,
        },
      })
      await apiFetch('/logs', {
        method: 'POST', token,
        body: { food_id: created.id, log_date: date, meal, servings: Number(servings) },
      })
      nav('/')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (scanning) {
    return (
      <div className="container">
        <div className="card">
          <h2>Scan a barcode</h2>
          <BarcodeScanner onDetected={onBarcode} onClose={() => setScanning(false)} />
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="card">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Add Food</h2>
          <button className="secondary" onClick={() => nav('/')}>Cancel</button>
        </div>
      </div>

      {!selected && !manualMode && (
        <>
          <div className="card">
            <form onSubmit={search}>
              <div className="row">
                <input placeholder="Search foods…" value={query} onChange={e => setQuery(e.target.value)} />
                <button type="submit" disabled={busy} style={{ flex: '0 0 auto' }}>Search</button>
              </div>
            </form>
            <div className="row" style={{ marginTop: '0.75rem' }}>
              <button className="secondary" onClick={() => setScanning(true)}>Scan Barcode</button>
              <button className="secondary" onClick={() => setManualMode(true)}>Manual Entry</button>
            </div>
          </div>

          {results.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              {results.map((r, i) => (
                <div key={i} className="search-result" onClick={() => pickResult(r)}>
                  <div>
                    {r.food.name}
                    <span className="badge">
                      {r.source === 'openfoodfacts' ? 'Open Food Facts'
                        : r.source === 'usda' ? 'USDA'
                        : 'Saved'}
                    </span>
                  </div>
                  <div className="muted">
                    {r.food.brand ? `${r.food.brand} · ` : ''}
                    {Math.round(r.food.calories_per_serving)} kcal / {formatServing(r.food)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {offError && (
            <div className="card" style={{ borderColor: 'var(--danger)' }}>
              <div className="error" style={{ margin: 0 }}>Open Food Facts error: {offError}</div>
              <div className="muted" style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
                You can still add foods manually or via barcode scan.
              </div>
            </div>
          )}

          {searched && results.length === 0 && !busy && (
            <div className="card muted">No results. Try a different search or manual entry.</div>
          )}
        </>
      )}

      {selected && (
        <div className="card">
          <div className="spread" style={{ alignItems: 'flex-start', gap: '1rem' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ margin: 0 }}>{selected.food.name}</h3>
              {selected.food.brand && <div className="muted">{selected.food.brand}</div>}
            </div>
            <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--accent)', lineHeight: 1 }}>
                {round1(Number(cals) * Number(servings || 0))}
              </div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>kcal total</div>
            </div>
          </div>

          {portions.length > 0 && (
            <>
              <div style={{ height: 12 }} />
              <label className="muted">Portion</label>
              <select value={selectedPortion} onChange={e => applyPortion(e.target.value)}>
                <option value="">— pick a portion —</option>
                {portions.map(p => (
                  <option key={p.label} value={p.label}>
                    {p.label} ({Math.round(p.grams)} g)
                  </option>
                ))}
              </select>
            </>
          )}

          <div style={{ height: 12 }} />
          <div className="row">
            <div>
              <label className="muted">Servings</label>
              <input type="number" step="0.1" min="0.1" value={servings} onChange={e => setServings(e.target.value)} />
            </div>
            <div>
              <label className="muted">Meal</label>
              <select value={meal} onChange={e => setMeal(e.target.value)}>
                {MEALS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div style={{ height: 8 }} />
          <label className="muted">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />

          <hr style={{ borderColor: 'var(--border)', margin: '1rem 0' }} />
          <div className="muted" style={{ marginBottom: '0.4rem', fontSize: '0.85rem' }}>
            Nutrition per portion ({servingAmount} {servingUnit}{servingG ? ` ≈ ${round1(servingG)} g` : ''})
          </div>
          <div className="row">
            <div>
              <label className="muted">Calories</label>
              <input type="number" step="0.1" value={cals} onChange={editNutrition(setCals)} />
            </div>
            <div>
              <label className="muted">Grams equiv.</label>
              <input type="number" step="0.1" value={servingG} onChange={e => { setServingG(e.target.value); markEdited() }} />
            </div>
          </div>
          <div style={{ height: 8 }} />
          <div className="row">
            <div><label className="muted">Protein (g)</label><input type="number" step="0.1" value={protein} onChange={editNutrition(setProtein)} /></div>
            <div><label className="muted">Carbs (g)</label><input type="number" step="0.1" value={carbs} onChange={editNutrition(setCarbs)} /></div>
          </div>
          <div style={{ height: 8 }} />
          <div className="row">
            <div><label className="muted">Fat (g)</label><input type="number" step="0.1" value={fat} onChange={editNutrition(setFat)} /></div>
            <div><label className="muted">Fiber (g)</label><input type="number" step="0.1" value={fiber} onChange={editNutrition(setFiber)} /></div>
          </div>
          {perG.current && !userOverrodeNutrition.current && (
            <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>
              Auto-scaling from per-gram density. Editing a value above stops auto-scaling.
            </div>
          )}

          {err && <div className="error">{err}</div>}
          <div style={{ height: 12 }} />
          <div className="row">
            <button className="secondary" onClick={() => setSelected(null)}>Back</button>
            <button onClick={saveAndLog} disabled={busy}>{busy ? 'Logging…' : 'Log It'}</button>
          </div>
        </div>
      )}

      {manualMode && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Manual entry</h3>
          <input placeholder="Food name" value={manual.name} onChange={e => setManual({ ...manual, name: e.target.value })} />
          <div style={{ height: 8 }} />
          <input placeholder="Brand (optional)" value={manual.brand} onChange={e => setManual({ ...manual, brand: e.target.value })} />
          <div style={{ height: 8 }} />
          <div className="row">
            <div>
              <label className="muted">Amount</label>
              <input type="number" step="0.01" min="0" value={manual.serving_amount} onChange={e => setManual({ ...manual, serving_amount: e.target.value })} />
            </div>
            <div>
              <label className="muted">Unit</label>
              <select value={manual.serving_unit} onChange={e => setManual({ ...manual, serving_unit: e.target.value })}>
                {SERVING_UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div style={{ height: 8 }} />
          <div className="row">
            <div>
              <label className="muted">Grams equivalent (optional)</label>
              <input type="number" placeholder="e.g. 240" value={manual.serving_size_g} onChange={e => setManual({ ...manual, serving_size_g: e.target.value })} />
            </div>
            <div>
              <label className="muted">Calories per serving</label>
              <input type="number" value={manual.calories_per_serving} onChange={e => setManual({ ...manual, calories_per_serving: e.target.value })} />
            </div>
          </div>
          <div style={{ height: 8 }} />
          <div className="row">
            <div><label className="muted">Protein (g)</label><input type="number" value={manual.protein_g} onChange={e => setManual({ ...manual, protein_g: e.target.value })} /></div>
            <div><label className="muted">Carbs (g)</label><input type="number" value={manual.carbs_g} onChange={e => setManual({ ...manual, carbs_g: e.target.value })} /></div>
          </div>
          <div style={{ height: 8 }} />
          <div className="row">
            <div><label className="muted">Fat (g)</label><input type="number" value={manual.fat_g} onChange={e => setManual({ ...manual, fat_g: e.target.value })} /></div>
            <div><label className="muted">Fiber (g)</label><input type="number" value={manual.fiber_g} onChange={e => setManual({ ...manual, fiber_g: e.target.value })} /></div>
          </div>
          <hr style={{ borderColor: 'var(--border)', margin: '1rem 0' }} />
          <div className="row">
            <div>
              <label className="muted">Servings</label>
              <input type="number" step="0.1" min="0.1" value={servings} onChange={e => setServings(e.target.value)} />
            </div>
            <div>
              <label className="muted">Meal</label>
              <select value={meal} onChange={e => setMeal(e.target.value)}>
                {MEALS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div style={{ height: 8 }} />
          <label className="muted">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />

          {err && <div className="error">{err}</div>}
          <div style={{ height: 12 }} />
          <div className="row">
            <button className="secondary" onClick={() => setManualMode(false)}>Back</button>
            <button onClick={saveManual} disabled={busy || !manual.name}>{busy ? 'Saving…' : 'Save & Log'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
