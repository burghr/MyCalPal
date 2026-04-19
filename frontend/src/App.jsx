import { Navigate, Route, Routes, Link, useNavigate } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import Login from './components/Login.jsx'
import Signup from './components/Signup.jsx'
import Dashboard from './components/Dashboard.jsx'
import AddFood from './components/AddFood.jsx'
import EditLog from './components/EditLog.jsx'
import Report from './components/Report.jsx'
import Profile from './components/Profile.jsx'
import Admin from './components/Admin.jsx'

function Protected({ children }) {
  const { token } = useAuth()
  return token ? children : <Navigate to="/login" replace />
}

function Nav() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  if (!user) return null
  return (
    <div className="nav">
      <Link to="/"><h1>MyCalPal</h1></Link>
      <div className="row" style={{ gap: '0.5rem' }}>
        <Link to="/" className="muted" style={{ textDecoration: 'none' }}>Diary</Link>
        <Link to="/report" className="muted" style={{ textDecoration: 'none' }}>Report</Link>
        {user.is_admin && <Link to="/admin" className="muted" style={{ textDecoration: 'none' }}>Admin</Link>}
        <Link to="/profile" className="muted" style={{ textDecoration: 'none' }}>{user.display_name}</Link>
        <button className="secondary" onClick={() => { logout(); nav('/login') }}>
          Logout
        </button>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/" element={<Protected><Dashboard /></Protected>} />
        <Route path="/add" element={<Protected><AddFood /></Protected>} />
        <Route path="/logs/:id" element={<Protected><EditLog /></Protected>} />
        <Route path="/report" element={<Protected><Report /></Protected>} />
        <Route path="/profile" element={<Protected><Profile /></Protected>} />
        <Route path="/admin" element={<Protected><Admin /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
