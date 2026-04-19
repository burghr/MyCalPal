import { createContext, useContext, useEffect, useState } from 'react'
import { apiFetch } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
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
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ token, user, login, signup, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
