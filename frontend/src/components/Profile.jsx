import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../api'
import { useAuth } from '../auth.jsx'
import {
  ACTIVITY_LEVELS, suggestCalorieGoal,
  lbToKg, kgToLb, inToCm, cmToIn,
} from '../calorie'
import { getWeightUnit, setWeightUnit, kgToDisplay, displayToKg } from '../units'

function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function Profile() {
  const { token, user, updateUser } = useAuth()
  const nav = useNavigate()
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const [wUnit, setWUnit] = useState(getWeightUnit())
  const [hUnit, setHUnit] = useState(wUnit === 'kg' ? 'cm' : 'ftin')

  const [displayName, setDisplayName] = useState(user?.display_name || '')
  const [age, setAge] = useState(user?.age ?? '')
  const [sex, setSex] = useState(user?.sex || 'female')
  const [activity, setActivity] = useState(user?.activity_level || 'moderate')
  const [goalType, setGoalType] = useState(user?.goal_type || 'maintain')
  const [calorieGoal, setCalorieGoal] = useState(user?.daily_calorie_goal ?? 2000)

  // Height state (imperial vs metric)
  const userHeightIn = user?.height_cm ? cmToIn(user.height_cm) : null
  const [heightFt, setHeightFt] = useState(userHeightIn ? String(Math.floor(userHeightIn / 12)) : '')
  const [heightIn, setHeightIn] = useState(userHeightIn ? String(Math.round(userHeightIn % 12)) : '')
  const [heightCm, setHeightCm] = useState(user?.height_cm ? String(Math.round(user.height_cm)) : '')

  // Weight state (for profile weight_kg + quick weight log today)
  const [weight, setWeight] = useState(
    user?.weight_kg != null ? kgToDisplay(user.weight_kg, wUnit).toFixed(1) : ''
  )
  const [logDate, setLogDate] = useState(todayISO())
  const [todayWeight, setTodayWeight] = useState('')
  const [weightSaved, setWeightSaved] = useState(false)

  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')

  useEffect(() => {
    let alive = true
    apiFetch(`/weights/today?date=${logDate}`, { token })
      .then(w => alive && setTodayWeight(w ? kgToDisplay(w.weight_kg, wUnit).toFixed(1) : ''))
      .catch(() => {})
    return () => { alive = false }
  }, [token, logDate, wUnit])

  const computedHeightCm = hUnit === 'cm'
    ? (parseFloat(heightCm) || null)
    : (heightFt || heightIn)
      ? inToCm((parseFloat(heightFt) || 0) * 12 + (parseFloat(heightIn) || 0))
      : null

  const computedWeightKg = displayToKg(weight, wUnit)

  const suggested = useMemo(() => suggestCalorieGoal({
    weight_kg: computedWeightKg,
    height_cm: computedHeightCm,
    age: parseInt(age, 10) || null,
    sex,
    activity_level: activity,
    goal_type: goalType,
  }), [computedWeightKg, computedHeightCm, age, sex, activity, goalType])

  const recalc = () => {
    if (suggested) setCalorieGoal(suggested)
  }

  const save = async () => {
    setErr(''); setMsg(''); setSaving(true)
    try {
      const updated = await apiFetch('/auth/me', {
        method: 'PATCH', token,
        body: {
          display_name: displayName,
          daily_calorie_goal: parseInt(calorieGoal, 10) || 2000,
          height_cm: computedHeightCm,
          weight_kg: computedWeightKg,
          age: parseInt(age, 10) || null,
          sex,
          activity_level: activity,
          goal_type: goalType,
        },
      })
      updateUser(updated)
      setMsg('Saved ✓')
      setTimeout(() => setMsg(''), 1500)
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const changePassword = async () => {
    setPwErr(''); setPwMsg('')
    if (newPw.length < 8) { setPwErr('New password must be 8+ chars'); return }
    try {
      await apiFetch('/auth/me/password', {
        method: 'POST', token,
        body: { current_password: curPw, new_password: newPw },
      })
      setPwMsg('Password changed ✓')
      setCurPw(''); setNewPw('')
      setTimeout(() => setPwMsg(''), 2000)
    } catch (e) { setPwErr(e.message) }
  }

  const logWeight = async () => {
    const kg = displayToKg(todayWeight, wUnit)
    if (!kg || kg <= 0) return
    setErr('')
    try {
      await apiFetch('/weights', {
        method: 'POST', token,
        body: { log_date: logDate, weight_kg: kg },
      })
      setWeightSaved(true)
      setTimeout(() => setWeightSaved(false), 1500)
    } catch (e) { setErr(e.message) }
  }

  return (
    <div className="container">
      <div className="card">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Log weight</h3>
          <div className="row" style={{ gap: '0.5rem' }}>
            {weightSaved && <span className="muted">Saved ✓</span>}
            <select
              value={wUnit}
              onChange={e => { setWeightUnit(e.target.value); setWUnit(e.target.value) }}
            >
              <option value="lb">lb</option>
              <option value="kg">kg</option>
            </select>
          </div>
        </div>
        <div style={{ height: 8 }} />
        <div className="row">
          <div>
            <label className="muted">Date</label>
            <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="muted">Weight ({wUnit})</label>
            <input
              type="number" step="0.1" inputMode="decimal" placeholder={wUnit}
              value={todayWeight} onChange={e => setTodayWeight(e.target.value)}
            />
          </div>
        </div>
        <div style={{ height: 8 }} />
        <button onClick={logWeight}>Save weight</button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Account</h3>

        <label className="muted">Display name</label>
        <input value={displayName} onChange={e => setDisplayName(e.target.value)} />

        <div style={{ height: 8 }} />
        <div className="row">
          <div>
            <label className="muted">Age</label>
            <input type="number" min="10" max="120" value={age} onChange={e => setAge(e.target.value)} />
          </div>
          <div>
            <label className="muted">Sex</label>
            <select value={sex} onChange={e => setSex(e.target.value)}>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
        </div>

        <div style={{ height: 8 }} />
        <div className="row">
          <button type="button" className={hUnit === 'ftin' ? '' : 'secondary'} onClick={() => setHUnit('ftin')}>ft/in</button>
          <button type="button" className={hUnit === 'cm' ? '' : 'secondary'} onClick={() => setHUnit('cm')}>cm</button>
        </div>

        <div style={{ height: 8 }} />
        {hUnit === 'ftin' ? (
          <div className="row">
            <div>
              <label className="muted">Height (ft)</label>
              <input type="number" min="3" max="8" value={heightFt} onChange={e => setHeightFt(e.target.value)} />
            </div>
            <div>
              <label className="muted">Height (in)</label>
              <input type="number" min="0" max="11" value={heightIn} onChange={e => setHeightIn(e.target.value)} />
            </div>
          </div>
        ) : (
          <div>
            <label className="muted">Height (cm)</label>
            <input type="number" min="100" max="250" value={heightCm} onChange={e => setHeightCm(e.target.value)} />
          </div>
        )}

        <div style={{ height: 8 }} />
        <label className="muted">Current weight ({wUnit}) — used for goal calc</label>
        <input
          type="number" step="0.1" inputMode="decimal"
          value={weight} onChange={e => setWeight(e.target.value)}
        />

        <div style={{ height: 8 }} />
        <label className="muted">Activity level</label>
        <select value={activity} onChange={e => setActivity(e.target.value)}>
          {ACTIVITY_LEVELS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>

        <div style={{ height: 8 }} />
        <label className="muted">Goal</label>
        <select value={goalType} onChange={e => setGoalType(e.target.value)}>
          <option value="maintain">Maintain weight</option>
          <option value="lose">Lose weight (~1 lb/week)</option>
          <option value="gain">Gain weight (lean)</option>
        </select>

        <div style={{ height: 12 }} />
        <div className="card" style={{ background: 'var(--surface-2)', marginBottom: 0 }}>
          <div className="spread">
            <div>
              <div className="muted">Daily calorie goal</div>
              <input
                type="number" min="500" max="10000"
                value={calorieGoal} onChange={e => setCalorieGoal(e.target.value)}
                style={{ fontSize: '1.25rem', fontWeight: 'bold' }}
              />
            </div>
            <button type="button" className="secondary" onClick={recalc} disabled={!suggested}>
              Recalc{suggested ? ` → ${suggested}` : ''}
            </button>
          </div>
        </div>

        {err && <div className="error">{err}</div>}
        {msg && <div className="muted" style={{ marginTop: '0.5rem' }}>{msg}</div>}
        <div style={{ height: 12 }} />
        <div className="row">
          <button className="secondary" onClick={() => nav('/')}>Back</button>
          <button onClick={save} disabled={saving} style={{ flex: 1 }}>
            {saving ? 'Saving…' : 'Save account'}
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Change password</h3>
        <input
          type="password" placeholder="Current password"
          value={curPw} onChange={e => setCurPw(e.target.value)}
        />
        <div style={{ height: 8 }} />
        <input
          type="password" placeholder="New password (min 8)"
          value={newPw} onChange={e => setNewPw(e.target.value)}
        />
        <div style={{ height: 8 }} />
        <button onClick={changePassword} disabled={!curPw || !newPw}>Update password</button>
        {pwErr && <div className="error">{pwErr}</div>}
        {pwMsg && <div className="muted" style={{ marginTop: '0.5rem' }}>{pwMsg}</div>}
      </div>
    </div>
  )
}
