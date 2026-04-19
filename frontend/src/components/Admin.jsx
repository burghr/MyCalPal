import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { apiFetch } from '../api'
import { useAuth } from '../auth.jsx'

function fmtDate(s) {
  if (!s) return 'never'
  const d = new Date(s)
  return d.toLocaleString()
}

export default function Admin() {
  const { token, user } = useAuth()
  const [users, setUsers] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [resetFor, setResetFor] = useState(null)
  const [newPw, setNewPw] = useState('')

  const load = async () => {
    try { setUsers(await apiFetch('/admin/users', { token })) }
    catch (e) { setErr(e.message) }
  }

  useEffect(() => { load() }, [token])

  if (!user?.is_admin) return <Navigate to="/" replace />

  const doDelete = async (u) => {
    if (!confirm(`Delete ${u.email}? This removes their logs and cannot be undone.`)) return
    setErr(''); setMsg('')
    try {
      await apiFetch(`/admin/users/${u.id}`, { method: 'DELETE', token })
      setMsg(`Deleted ${u.email}`)
      await load()
    } catch (e) { setErr(e.message) }
  }

  const doReset = async () => {
    if (!newPw || newPw.length < 8) { setErr('New password must be 8+ chars'); return }
    setErr(''); setMsg('')
    try {
      await apiFetch(`/admin/users/${resetFor.id}/reset-password`, {
        method: 'POST', token, body: { new_password: newPw },
      })
      setMsg(`Password reset for ${resetFor.email}`)
      setResetFor(null); setNewPw('')
    } catch (e) { setErr(e.message) }
  }

  return (
    <div className="container">
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Admin — Users</h3>
        {users.map(u => (
          <div key={u.id} style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--border)' }}>
            <div className="spread">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {u.display_name} {u.is_admin && <span className="muted" style={{ fontSize: '0.8rem' }}>(admin)</span>}
                </div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>{u.email}</div>
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Last login: {fmtDate(u.last_login_at)} · Joined: {fmtDate(u.created_at)}
                </div>
              </div>
              <div className="row" style={{ gap: '0.4rem' }}>
                <button className="secondary" onClick={() => { setResetFor(u); setNewPw('') }}>Reset PW</button>
                {!u.is_admin && <button className="secondary" onClick={() => doDelete(u)}>Delete</button>}
              </div>
            </div>
          </div>
        ))}

        {resetFor && (
          <div className="card" style={{ background: 'var(--surface-2)', marginTop: '1rem' }}>
            <h4 style={{ marginTop: 0 }}>Reset password for {resetFor.email}</h4>
            <input
              type="password"
              placeholder="New password (min 8)"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
            />
            <div style={{ height: 8 }} />
            <div className="row">
              <button className="secondary" onClick={() => { setResetFor(null); setNewPw('') }}>Cancel</button>
              <button onClick={doReset} style={{ flex: 1 }}>Set password</button>
            </div>
          </div>
        )}

        {err && <div className="error">{err}</div>}
        {msg && <div className="muted" style={{ marginTop: '0.5rem' }}>{msg}</div>}
      </div>
    </div>
  )
}
