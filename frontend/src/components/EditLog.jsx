import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../api'
import { useAuth } from '../auth.jsx'
import { SERVING_UNITS } from '../units'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

export default function EditLog() {
  const { id } = useParams()
  const { token } = useAuth()
  const nav = useNavigate()

  const [log, setLog] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [meal, setMeal] = useState('')
  const [date, setDate] = useState('')
  const [servings, setServings] = useState(1)
  const [editNutrition, setEditNutrition] = useState(false)
  const [n, setN] = useState({
    name: '', brand: '',
    serving_amount: 1, serving_unit: 'serving', serving_size_g: '',
    calories_per_serving: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0,
  })

  useEffect(() => {
    (async () => {
      try {
        const l = await apiFetch(`/logs/${id}`, { token })
        setLog(l)
        setMeal(l.meal)
        setDate(l.log_date)
        setServings(l.servings)
        setN({
          name: l.food.name,
          brand: l.food.brand || '',
          serving_amount: l.food.serving_amount ?? 1,
          serving_unit: l.food.serving_unit || 'serving',
          serving_size_g: l.food.serving_size_g ?? '',
          calories_per_serving: l.food.calories_per_serving,
          protein_g: l.food.protein_g,
          carbs_g: l.food.carbs_g,
          fat_g: l.food.fat_g,
          fiber_g: l.food.fiber_g,
        })
      } catch (e) { setErr(e.message) }
    })()
  }, [id, token])

  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      const body = { log_date: date, meal, servings: Number(servings) }
      if (editNutrition) {
        body.food_overrides = {
          name: n.name,
          brand: n.brand || null,
          serving_amount: Number(n.serving_amount) || 1,
          serving_unit: n.serving_unit || 'serving',
          serving_size_g: n.serving_size_g ? Number(n.serving_size_g) : null,
          calories_per_serving: Number(n.calories_per_serving),
          protein_g: Number(n.protein_g),
          carbs_g: Number(n.carbs_g),
          fat_g: Number(n.fat_g),
          fiber_g: Number(n.fiber_g),
        }
      }
      await apiFetch(`/logs/${id}`, { method: 'PATCH', token, body })
      nav(`/?date=${date}`)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!confirm('Delete this entry?')) return
    setBusy(true)
    try {
      await apiFetch(`/logs/${id}`, { method: 'DELETE', token })
      nav('/')
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  if (!log) return <div className="container">{err || 'Loading…'}</div>

  return (
    <div className="container">
      <div className="card">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Edit entry</h2>
          <button className="secondary" onClick={() => nav(-1)}>Cancel</button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{log.food.name}</h3>
        {log.food.brand && <div className="muted">{log.food.brand}</div>}

        <div style={{ height: 12 }} />
        <div className="row">
          <div>
            <label className="muted">Meal (category)</label>
            <select value={meal} onChange={e => setMeal(e.target.value)}>
              {MEALS.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="muted">Servings</label>
            <input type="number" step="0.1" min="0.1" value={servings} onChange={e => setServings(e.target.value)} />
          </div>
        </div>
        <div style={{ height: 8 }} />
        <label className="muted">Date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>

      <div className="card">
        <label className="row" style={{ gap: '0.5rem' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={editNutrition} onChange={e => setEditNutrition(e.target.checked)} />
          <span>Edit nutrition facts for this entry</span>
        </label>
        <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 0 }}>
          Creates a private copy so other entries using this food stay unchanged.
        </p>

        {editNutrition && (
          <>
            <div style={{ height: 12 }} />
            <input placeholder="Food name" value={n.name} onChange={e => setN({ ...n, name: e.target.value })} />
            <div style={{ height: 8 }} />
            <input placeholder="Brand" value={n.brand} onChange={e => setN({ ...n, brand: e.target.value })} />
            <div style={{ height: 8 }} />
            <div className="row">
              <div>
                <label className="muted">Amount</label>
                <input type="number" step="0.01" min="0" value={n.serving_amount} onChange={e => setN({ ...n, serving_amount: e.target.value })} />
              </div>
              <div>
                <label className="muted">Unit</label>
                <select value={n.serving_unit} onChange={e => setN({ ...n, serving_unit: e.target.value })}>
                  {SERVING_UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div style={{ height: 8 }} />
            <div className="row">
              <div><label className="muted">Grams equivalent (optional)</label><input type="number" value={n.serving_size_g} onChange={e => setN({ ...n, serving_size_g: e.target.value })} /></div>
              <div><label className="muted">Calories per serving</label><input type="number" value={n.calories_per_serving} onChange={e => setN({ ...n, calories_per_serving: e.target.value })} /></div>
            </div>
            <div style={{ height: 8 }} />
            <div className="row">
              <div><label className="muted">Protein (g)</label><input type="number" value={n.protein_g} onChange={e => setN({ ...n, protein_g: e.target.value })} /></div>
              <div><label className="muted">Carbs (g)</label><input type="number" value={n.carbs_g} onChange={e => setN({ ...n, carbs_g: e.target.value })} /></div>
            </div>
            <div style={{ height: 8 }} />
            <div className="row">
              <div><label className="muted">Fat (g)</label><input type="number" value={n.fat_g} onChange={e => setN({ ...n, fat_g: e.target.value })} /></div>
              <div><label className="muted">Fiber (g)</label><input type="number" value={n.fiber_g} onChange={e => setN({ ...n, fiber_g: e.target.value })} /></div>
            </div>
          </>
        )}
      </div>

      {err && <div className="error">{err}</div>}
      <div className="row">
        <button className="danger" onClick={remove} disabled={busy}>Delete</button>
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}
