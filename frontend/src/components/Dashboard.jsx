import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../api'
import { useAuth } from '../auth.jsx'
import { formatServing } from '../units'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

function localISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayISO() {
  return localISO(new Date())
}

function shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return localISO(d)
}

function friendlyDate(iso) {
  const d = new Date(`${iso}T00:00:00`)
  const dow = d.toLocaleDateString('en-US', { weekday: 'long' })
  return `${dow} ${d.getMonth() + 1}/${d.getDate()}`
}

export default function Dashboard() {
  const { token } = useAuth()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [date, setDate] = useState(sp.get('date') || todayISO())
  const dateInputRef = useRef(null)
  const [summary, setSummary] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setSp({ date }, { replace: true })
  }, [date, setSp])

  const load = useCallback(async () => {
    try {
      const s = await apiFetch(`/logs/day?date=${date}`, { token })
      setSummary(s)
    } catch (e) { setErr(e.message) }
  }, [date, token])

  useEffect(() => { load() }, [load])

  if (!summary) return <div className="container">Loading…</div>

  const pct = Math.min(100, (summary.total_calories / summary.calorie_goal) * 100)
  const isToday = date === todayISO()

  return (
    <div className="container">
      <div className="card">
        <div className="row" style={{ gap: '0.5rem' }}>
          <button className="secondary" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day" style={{ flex: '0 0 auto', padding: '0.6rem 0.9rem' }}>‹</button>
          <button
            className="secondary"
            onClick={() => {
              const el = dateInputRef.current
              if (el?.showPicker) el.showPicker()
              else el?.click()
            }}
            style={{ fontWeight: 600 }}
          >
            {friendlyDate(date)}
          </button>
          <input
            ref={dateInputRef}
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            className="secondary"
            onClick={() => setDate(shiftDate(date, 1))}
            aria-label="Next day"
            disabled={isToday}
            style={{ flex: '0 0 auto', padding: '0.6rem 0.9rem' }}
          >›</button>
        </div>
        {!isToday && (
          <>
            <div style={{ height: 8 }} />
            <button className="secondary" onClick={() => setDate(todayISO())}>Jump to today</button>
          </>
        )}
      </div>

      <div className="card">
        <div className="spread">
          <div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
              {Math.round(summary.total_calories)} <span className="muted" style={{ fontSize: '1rem' }}>/ {summary.calorie_goal} kcal</span>
            </div>
          </div>
          <div className="muted">{Math.max(0, summary.calorie_goal - Math.round(summary.total_calories))} left</div>
        </div>
        <div className="progress"><div style={{ width: `${pct}%` }} /></div>
        <div className="macros">
          <div className="macro"><strong>{summary.total_protein_g}g</strong>Protein</div>
          <div className="macro"><strong>{summary.total_carbs_g}g</strong>Carbs</div>
          <div className="macro"><strong>{summary.total_fat_g}g</strong>Fat</div>
          <div className="macro"><strong>{summary.total_fiber_g}g</strong>Fiber</div>
        </div>
      </div>

      {MEALS.map(meal => {
        const logs = summary.by_meal[meal] || []
        const mealCals = logs.reduce((s, l) => s + l.food.calories_per_serving * l.servings, 0)
        return (
          <div key={meal} className="card meal-section">
            <div className="spread">
              <h3>{meal}</h3>
              <div className="row" style={{ gap: '0.5rem' }}>
                <span className="muted">{Math.round(mealCals)} kcal</span>
                <Link to={`/add?meal=${meal}&date=${date}`}>
                  <button className="secondary" style={{ padding: '0.3rem 0.6rem' }}>+ Add</button>
                </Link>
              </div>
            </div>
            {logs.length === 0 ? (
              <div className="muted" style={{ padding: '0.4rem 0' }}>No entries.</div>
            ) : logs.map(l => (
              <div
                key={l.id}
                className="log-entry"
                onClick={() => nav(`/logs/${l.id}`)}
                style={{ cursor: 'pointer' }}
              >
                <div>
                  <div>{l.food.name}</div>
                  <div className="muted">
                    {l.servings}× {formatServing(l.food)} · {(l.food.calories_per_serving * l.servings).toFixed(1)} kcal
                    {l.food.brand ? ` · ${l.food.brand}` : ''}
                  </div>
                </div>
                <span className="muted" style={{ fontSize: '1.25rem' }}>›</span>
              </div>
            ))}
          </div>
        )
      })}


      {err && <div className="error">{err}</div>}
    </div>
  )
}
