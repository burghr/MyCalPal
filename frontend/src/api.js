// If VITE_API_URL isn't set, derive the API host from the current page so the
// app works from phones on the LAN (not just localhost). Port comes from
// VITE_API_PORT (set via docker-compose) or defaults to 8000.
const API_PORT = import.meta.env.VITE_API_PORT || '8000'
const API_URL = import.meta.env.VITE_API_URL
  || `${window.location.protocol}//${window.location.hostname}:${API_PORT}`

export async function apiFetch(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    // Include cookies so the Authentik forward-auth session carries cross-subdomain
    // (app <-> api). Harmless in local auth mode — no cookies are set there.
    credentials: 'include',
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
