import { createContext, useContext, useEffect, useState } from 'react'
import { apiFetch } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [mode, setMode] = useState(null)   // 'local' | 'sso' — null until /auth/config resolves
  const [ready, setReady] = useState(false)
  const [token, setToken] = useState(() => localStorage.getItem('token'))
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('user')
    return raw ? JSON.parse(raw) : null
  })

  useEffect(() => {
    if (token) localStorage.setItem('token', token)
    else localStorage.removeItem('token')
  }, [token])

  useEffect(() => {
    if (user) localStorage.setItem('user', JSON.stringify(user))
    else localStorage.removeItem('user')
  }, [user])

  // On mount: discover auth mode, and in SSO mode pull the user from forward-auth headers.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let resolvedMode = 'local'
      try {
        const cfg = await apiFetch('/auth/config')
        resolvedMode = cfg?.mode === 'sso' ? 'sso' : 'local'
      } catch {
        // Backend unreachable — fall back to local so the login form can still render.
      }
      if (cancelled) return
      setMode(resolvedMode)

      if (resolvedMode === 'sso') {
        try {
          const me = await apiFetch('/auth/me')
          if (!cancelled) setUser(me)
        } catch {
          // Not authenticated yet; the outpost will redirect to Authentik on next nav.
        }
      }
      if (!cancelled) setReady(true)
    })()
    return () => { cancelled = true }
  }, [])

  const login = async (email, password) => {
    const res = await apiFetch('/auth/login', { method: 'POST', body: { email, password } })
    setToken(res.access_token)
    setUser(res.user)
  }

  const signup = async (email, password, display_name, daily_calorie_goal, profile = {}) => {
    const res = await apiFetch('/auth/signup', {
      method: 'POST',
      body: { email, password, display_name, daily_calorie_goal, ...profile },
    })
    setToken(res.access_token)
    setUser(res.user)
  }

  const updateUser = (u) => setUser(u)

  const logout = () => {
    if (mode === 'sso') {
      // End the Authentik proxy session too, otherwise the next request silently re-auths.
      window.location.href = '/outpost.goauthentik.io/sign_out'
      return
    }
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ mode, ready, token, user, login, signup, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
