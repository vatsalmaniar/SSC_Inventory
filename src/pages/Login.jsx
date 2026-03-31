import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import '../styles/login.css'

export default function Login() {
  const navigate = useNavigate()
  const [username, setUsername]     = useState('')
  const [password, setPassword]     = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [showPwd, setShowPwd]       = useState(false)
  const [view, setView]             = useState('login') // 'login' | 'overlay'
  const [overlayMsg, setOverlayMsg] = useState({ text: '', sub: '' })
  const usernameRef = useRef(null)

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      if (data?.session) handleSession(data.session)
    })
    usernameRef.current?.focus()
  }, [])

  async function handleSession(session) {
    const { data: profile } = await sb
      .from('profiles').select('name, role').eq('id', session.user.id).single()
    const name = profile?.name || session.user.email.split('@')[0]
    const role = profile?.role || 'sales'

    if (role === 'accounts') {
      setOverlayMsg({ text: 'Welcome, ' + name + '!', sub: 'Loading upload dashboard...' })
      setView('overlay')
      setTimeout(() => navigate('/accounts'), 1600)
      return
    }

    setOverlayMsg({ text: 'Welcome, ' + name + '!', sub: 'Loading dashboard...' })
    setView('overlay')
    setTimeout(() => navigate('/dashboard'), 1600)
  }

  async function doLogin() {
    const u = username.trim().toLowerCase()
    const p = password
    if (!u) { setError('Please enter your username.'); return }
    if (!p) { setError('Please enter your password.'); return }

    setLoading(true)
    setError('')

    const { data: profile, error: profileErr } = await sb
      .from('profiles').select('id, name, role').eq('username', u).single()

    if (profileErr || !profile) {
      setLoading(false)
      setError('Username not found. Check and try again.')
      return
    }

    const email = u + '@ssccontrol.com'
    const { data, error: authErr } = await sb.auth.signInWithPassword({ email, password: p })

    if (authErr) {
      setLoading(false)
      setError('Incorrect password. Please try again.')
      setPassword('')
      return
    }

    await handleSession(data.session)
    setLoading(false)
  }

  function goTo(path) {
    setView('overlay')
    setTimeout(() => navigate(path), 800)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') doLogin()
  }

  const hasError = error.length > 0

  return (
    <div className="bg-wrap">
      <div className="dots-grid" />
      <div className="glow-orb glow-1" />
      <div className="glow-orb glow-2" />

      {/* Top strip */}
      <div className="top-strip">
        <img src="/ssc-logo.svg" alt="SSC Control" className="logo-img" />
      </div>

      <div className="main">
        {/* Login Card */}
        {view === 'login' && (
          <div className="card">
            <div className="card-band">
              <div className="band-eyebrow">Internal access only</div>
              <div className="band-title">Welcome back</div>
              <div className="band-sub">Sign in with your username and password</div>
            </div>

            <div className="card-body">
              {hasError && (
                <div className="error-msg show">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              <div className="field">
                <label className="field-label">Username</label>
                <div className="input-wrap">
                  <span className="input-icon">
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                  </span>
                  <input
                    ref={usernameRef}
                    type="text"
                    value={username}
                    onChange={e => { setUsername(e.target.value); setError('') }}
                    onKeyDown={onKeyDown}
                    placeholder="e.g. vatsal.maniar"
                    autoComplete="off"
                    autoCapitalize="none"
                    className={hasError ? 'error' : ''}
                  />
                </div>
              </div>

              <div className="field">
                <label className="field-label">Password</label>
                <div className="input-wrap">
                  <span className="input-icon">
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <rect x="3" y="11" width="18" height="11" rx="2"/>
                      <path d="M7 11V7a5 5 0 0110 0v4"/>
                    </svg>
                  </span>
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError('') }}
                    onKeyDown={onKeyDown}
                    placeholder="Enter your password"
                    className={hasError ? 'error' : ''}
                  />
                  <button className="eye-btn" type="button" onClick={() => setShowPwd(v => !v)}>
                    {showPwd ? (
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button className="submit-btn" onClick={doLogin} disabled={loading}>
                {loading ? (
                  <>
                    <div className="spinner" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <span>Sign in</span>
                )}
              </button>
            </div>

            <div className="card-footer">
              <div className="lock-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{color:'var(--blue-600)'}}>
                  <rect x="3" y="11" width="18" height="11" rx="2"/>
                  <path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
              </div>
              <div className="footer-text">
                <strong>Internal system — SSC Control Pvt. Ltd.</strong><br/>
                Authorised personnel only
              </div>
            </div>
          </div>
        )}

        {/* Admin Selector */}
        {view === 'selector' && (
          <div className="selector-card">
            <div className="selector-band">
              <div className="welcome">Signed in as admin</div>
              <h2>{selectorName}</h2>
              <p>Choose which view to open</p>
            </div>
            <div className="selector-body">
              <button className="view-btn" onClick={() => goTo('/sales')}>
                <div className="view-btn-icon sales">
                  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M21 21H3M21 21V3M9 21V9m4 12V5m4 16v-6"/>
                  </svg>
                </div>
                <div>
                  <div className="view-btn-title">Sales View</div>
                  <div className="view-btn-sub">Search product codes, check stock</div>
                </div>
                <div className="view-btn-arrow">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </div>
              </button>

              <button className="view-btn" onClick={() => goTo('/accounts')}>
                <div className="view-btn-icon accounts">
                  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <div>
                  <div className="view-btn-title">Accounts View</div>
                  <div className="view-btn-sub">Upload XLS, update live inventory</div>
                </div>
                <div className="view-btn-arrow">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </div>
              </button>
            </div>
          </div>
        )}

        <div className="tagline">
          your link to excellence · <strong>SSC Control Pvt. Ltd.</strong>
        </div>
      </div>

      {/* Success Overlay */}
      {view === 'overlay' && (
        <div className="success-overlay">
          <div className="success-circle">
            <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div className="success-text">{overlayMsg.text}</div>
          <div className="success-sub">{overlayMsg.sub}</div>
        </div>
      )}
    </div>
  )
}
