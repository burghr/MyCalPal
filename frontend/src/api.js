// If VITE_API_URL isn't set, derive the API host from the current page so the
// app works from phones on the LAN (not just localhost). Assumes API on :8000.
const API_URL = import.meta.env.VITE_API_URL
  || `${window.location.protocol}//${window.location.hostname}:8000`

export async function apiFetch(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    let msg
    if (typeof err.detail === 'string') {
      msg = err.detail
    } else if (Array.isArray(err.detail)) {
      // FastAPI validation errors: [{loc, msg, type}, ...]
      msg = err.detail.map(e => `${(e.loc || []).slice(1).join('.')}: ${e.msg}`).join('; ')
    } else {
      msg = JSON.stringify(err.detail || err)
    }
    throw new Error(msg || 'Request failed')
  }
  if (res.status === 204) return null
  return res.json()
}
