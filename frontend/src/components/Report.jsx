import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { useAuth } from '../auth.jsx'
import { getWeightUnit, setWeightUnit, kgToDisplay } from '../units'

function friendlyDate(iso) {
  const d = new Date(`${iso}T00:00:00`)
  const dow = d.toLocaleDateString('en-US', { weekday: 'short' })
  return `${dow} ${d.getMonth() + 1}/${d.getDate()}`
}

function WeightChart({ weights, unit }) {
  if (weights.length < 2) {
    return <div className="muted">Log at least 2 weights to see a trend.</div>
  }
  const W = 320, H = 140, P = 24
  const xs = weights.map(w => new Date(`${w.log_date}T00:00:00`).getTime())
  const ys = weights.map(w => kgToDisplay(w.weight_kg, unit))
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const yMin = Math.min(...ys), yMax = Math.max(...ys)
  const ySpan = yMax - yMin || 1
  const xSpan = xMax - xMin || 1
  const points = weights.map((w, i) => {
    const x = P + ((xs[i] - xMin) / xSpan) * (W - 2 * P)
    const y = H - P - ((ys[i] - yMin) / ySpan) * (H - 2 * P)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      <polyline fill="none" stroke="#4ade80" strokeWidth="2" points={points} />
      {weights.map((w, i) => {
        const [x, y] = points.split(' ')[i].split(',')
        return <circle key={w.id} cx={x} cy={y} r="3" fill="#4ade80" />
      })}
      <text x={P} y={14} fontSize="10" fill="#888">{yMax.toFixed(1)} {unit}</text>
      <text x={P} y={H - 4} fontSize="10" fill="#888">{yMin.toFixed(1)} {unit}</text>
    </svg>
  )
}

export default function Report() {
  const { token } = useAuth()
  const [stats, setStats] = useState(null)
  const [weights, setWeights] = useState([])
  const [days, setDays] = useState(30)
  const [wUnit, setWUnit] = useState(getWeightUnit())
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([
      apiFetch(`/logs/stats?days=${days}`, { token }),
      apiFetch(`/weights?days=${days}`, { token }),
    ])
      .then(([s, w]) => { if (alive) { setStats(s); setWeights(w) } })
      .catch(e => alive && setErr(e.message))
    return () => { alive = false }
  }, [token, days])

  if (!stats) return <div className="container">Loading…</div>

  const total = stats.under_or_at_goal + stats.over_goal
  const hitPct = total ? Math.round((stats.under_or_at_goal / total) * 100) : 0

  return (
    <div className="container">
      <div className="card">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Report</h3>
          <select value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Calorie goal</h3>
        <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>
          {stats.under_or_at_goal}<span className="muted" style={{ fontSize: '1rem' }}> / {total} days at or under {stats.calorie_goal} kcal ({hitPct}%)</span>
        </div>
        <div className="muted">Average: {stats.average_calories} kcal/day logged</div>
      </div>

      <div className="card">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Weight</h3>
          <select
            value={wUnit}
            onChange={e => { setWeightUnit(e.target.value); setWUnit(e.target.value) }}
          >
            <option value="lb">lb</option>
            <option value="kg">kg</option>
          </select>
        </div>
        <div style={{ height: 8 }} />
        <WeightChart weights={weights} unit={wUnit} />
        {weights.length > 0 && (
          <div className="muted" style={{ marginTop: '0.5rem' }}>
            {kgToDisplay(weights[weights.length - 1].weight_kg, wUnit).toFixed(1)} {wUnit} latest
            {weights.length >= 2 && (() => {
              const delta = kgToDisplay(weights[weights.length - 1].weight_kg, wUnit)
                - kgToDisplay(weights[0].weight_kg, wUnit)
              const sign = delta >= 0 ? '+' : ''
              return ` · ${sign}${delta.toFixed(1)} ${wUnit} over period`
            })()}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Daily calories</h3>
        {stats.per_day.length === 0 && <div className="muted">No entries yet.</div>}
        {stats.per_day.map(d => {
          const over = d.calories > stats.calorie_goal
          return (
            <div key={d.date} className="spread" style={{ padding: '0.4rem 0' }}>
              <span>{friendlyDate(d.date)}</span>
              <span style={{ color: over ? '#f87171' : '#4ade80' }}>
                {Math.round(d.calories)} kcal
              </span>
            </div>
          )
        })}
      </div>

      {err && <div className="error">{err}</div>}
    </div>
  )
}
