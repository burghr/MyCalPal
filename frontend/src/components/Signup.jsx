import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { ACTIVITY_LEVELS, suggestCalorieGoal, lbToKg, inToCm } from '../calorie'

export default function Signup() {
  const { signup } = useAuth()
  const nav = useNavigate()
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    email: '', password: '', displayName: '',
    age: '', sex: 'female',
    heightFt: '', heightIn: '', heightCm: '',
    weightLb: '', weightKg: '',
    activity: 'moderate',
    goal: 'maintain',
    units: 'imperial', // 'imperial' | 'metric'
    calorieGoal: '',
    overrideGoal: false,
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Derived metric values (single source of truth for the calc)
  const heightCm = form.units === 'metric'
    ? parseFloat(form.heightCm) || null
    : (form.heightFt || form.heightIn)
      ? inToCm((parseFloat(form.heightFt) || 0) * 12 + (parseFloat(form.heightIn) || 0))
      : null

  const weightKg = form.units === 'metric'
    ? parseFloat(form.weightKg) || null
    : form.weightLb ? lbToKg(parseFloat(form.weightLb)) : null

  const suggested = useMemo(() => suggestCalorieGoal({
    weight_kg: weightKg,
    height_cm: heightCm,
    age: parseInt(form.age, 10) || null,
    sex: form.sex,
    activity_level: form.activity,
    goal_type: form.goal,
  }), [weightKg, heightCm, form.age, form.sex, form.activity, form.goal])

  const effectiveGoal = form.overrideGoal && form.calorieGoal
    ? parseInt(form.calorieGoal, 10)
    : suggested || 2000

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      await signup(
        form.email, form.password, form.displayName, effectiveGoal,
        {
          height_cm: heightCm,
          weight_kg: weightKg,
          age: parseInt(form.age, 10) || null,
          sex: form.sex,
          activity_level: form.activity,
          goal_type: form.goal,
        },
      )
      nav('/')
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }

  return (
    <div className="container">
      <div className="card">
        <h2>Create your account</h2>
        <form onSubmit={submit}>
          <input placeholder="Display name" value={form.displayName} onChange={e => set('displayName', e.target.value)} required />
          <div style={{ height: 8 }} />
          <input type="email" placeholder="Email" value={form.email} onChange={e => set('email', e.target.value)} required />
          <div style={{ height: 8 }} />
          <input type="password" placeholder="Password (min 8)" minLength={8} value={form.password} onChange={e => set('password', e.target.value)} required />

          <hr style={{ borderColor: 'var(--border)', margin: '1rem 0' }} />
          <h3 style={{ marginTop: 0 }}>About you</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            We use this to estimate a daily calorie goal (Mifflin-St Jeor). You can override it below.
          </p>

          <div className="row">
            <div>
              <label className="muted">Age</label>
              <input type="number" min="10" max="120" value={form.age} onChange={e => set('age', e.target.value)} />
            </div>
            <div>
              <label className="muted">Sex</label>
              <select value={form.sex} onChange={e => set('sex', e.target.value)}>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </div>
          </div>

          <div style={{ height: 8 }} />
          <div className="row">
            <button type="button" className={form.units === 'imperial' ? '' : 'secondary'} onClick={() => set('units', 'imperial')}>Imperial</button>
            <button type="button" className={form.units === 'metric' ? '' : 'secondary'} onClick={() => set('units', 'metric')}>Metric</button>
          </div>

          <div style={{ height: 8 }} />
          {form.units === 'imperial' ? (
            <div className="row">
              <div>
                <label className="muted">Height (ft)</label>
                <input type="number" min="3" max="8" value={form.heightFt} onChange={e => set('heightFt', e.target.value)} />
              </div>
              <div>
                <label className="muted">Height (in)</label>
                <input type="number" min="0" max="11" value={form.heightIn} onChange={e => set('heightIn', e.target.value)} />
              </div>
              <div>
                <label className="muted">Weight (lb)</label>
                <input type="number" min="50" max="600" value={form.weightLb} onChange={e => set('weightLb', e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="row">
              <div>
                <label className="muted">Height (cm)</label>
                <input type="number" min="100" max="250" value={form.heightCm} onChange={e => set('heightCm', e.target.value)} />
              </div>
              <div>
                <label className="muted">Weight (kg)</label>
                <input type="number" min="25" max="300" step="0.1" value={form.weightKg} onChange={e => set('weightKg', e.target.value)} />
              </div>
            </div>
          )}

          <div style={{ height: 8 }} />
          <label className="muted">Activity level</label>
          <select value={form.activity} onChange={e => set('activity', e.target.value)}>
            {ACTIVITY_LEVELS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>

          <div style={{ height: 8 }} />
          <label className="muted">Goal</label>
          <select value={form.goal} onChange={e => set('goal', e.target.value)}>
            <option value="maintain">Maintain weight</option>
            <option value="lose">Lose weight (~1 lb/week)</option>
            <option value="gain">Gain weight (lean)</option>
          </select>

          <div style={{ height: 12 }} />
          <div className="card" style={{ background: 'var(--surface-2)', marginBottom: 0 }}>
            <div className="spread">
              <div>
                <div className="muted">Suggested daily calories</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                  {suggested ?? '—'} <span className="muted" style={{ fontSize: '0.9rem' }}>kcal</span>
                </div>
              </div>
              <label className="row" style={{ gap: '0.4rem' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={form.overrideGoal} onChange={e => set('overrideGoal', e.target.checked)} />
                <span className="muted">Override</span>
              </label>
            </div>
            {form.overrideGoal && (
              <>
                <div style={{ height: 8 }} />
                <input type="number" min="500" max="10000" placeholder="Your goal" value={form.calorieGoal} onChange={e => set('calorieGoal', e.target.value)} />
              </>
            )}
          </div>

          {err && <div className="error">{err}</div>}
          <div style={{ height: 12 }} />
          <button type="submit" disabled={loading}>{loading ? 'Creating…' : `Sign up — ${effectiveGoal} kcal/day`}</button>
        </form>
        <p className="muted" style={{ marginTop: '1rem' }}>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  )
}
