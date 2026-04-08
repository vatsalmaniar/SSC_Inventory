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
  const [view, setView]             = useState('login') // 'login' | 'totp' | 'enroll' | 'overlay'
  const [overlayMsg, setOverlayMsg] = useState({ text: '', sub: '' })

  // MFA state
  const [mfaFactorId, setMfaFactorId]   = useState(null)
  const [totpCode, setTotpCode]         = useState('')
  const [mfaError, setMfaError]         = useState('')
  const [mfaLoading, setMfaLoading]     = useState(false)
  const [enrollData, setEnrollData]     = useState(null) // { id, qr_code, secret }
  const [pendingSession, setPendingSession] = useState(null)
  const [pendingProfile, setPendingProfile] = useState(null)

  const usernameRef = useRef(null)
  const totpRef     = useRef(null)

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

    if (role === 'fc_kaveri' || role === 'fc_godawari') {
      setOverlayMsg({ text: 'Welcome, ' + name + '!', sub: 'Loading FC Module...' })
      setView('overlay')
      setTimeout(() => navigate('/fc'), 1600)
      return
    }

    if (role === 'accounts') {
      setOverlayMsg({ text: 'Welcome, ' + name + '!', sub: 'Loading Billing Module...' })
      setView('overlay')
      setTimeout(() => navigate('/billing'), 1600)
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

    // Admin requires MFA
    if (profile.role === 'admin') {
      setPendingSession(data.session)
      setPendingProfile(profile)
      await checkAdminMFA()
      setLoading(false)
      return
    }

    await handleSession(data.session)
    setLoading(false)
  }

  async function checkAdminMFA() {
    const { data: factors } = await sb.auth.mfa.listFactors()
    const verified = (factors?.totp || []).find(f => f.status === 'verified')
    if (verified) {
      // Already enrolled — show code prompt
      setMfaFactorId(verified.id)
      setView('totp')
      setTimeout(() => totpRef.current?.focus(), 100)
    } else {
      // First time — enroll
      const { data: enroll, error: enrollErr } = await sb.auth.mfa.enroll({ factorType: 'totp' })
      if (enrollErr) { setError('MFA setup failed: ' + enrollErr.message); return }
      setEnrollData({ id: enroll.id, qr_code: enroll.totp.qr_code, secret: enroll.totp.secret })
      setView('enroll')
      setTimeout(() => totpRef.current?.focus(), 100)
    }
  }

  async function submitTOTP() {
    if (totpCode.length !== 6) { setMfaError('Enter the 6-digit code from your authenticator app.'); return }
    setMfaLoading(true)
    setMfaError('')
    const { data: challenge, error: chalErr } = await sb.auth.mfa.challenge({ factorId: mfaFactorId })
    if (chalErr) { setMfaError(chalErr.message); setMfaLoading(false); return }
    const { error: verErr } = await sb.auth.mfa.verify({ factorId: mfaFactorId, challengeId: challenge.id, code: totpCode })
    if (verErr) { setMfaError('Invalid code. Try again.'); setTotpCode(''); setMfaLoading(false); totpRef.current?.focus(); return }
    setMfaLoading(false)
    await handleSession(pendingSession)
  }

  async function submitEnroll() {
    if (totpCode.length !== 6) { setMfaError('Enter the 6-digit code from your authenticator app.'); return }
    setMfaLoading(true)
    setMfaError('')
    const { error: verErr } = await sb.auth.mfa.challengeAndVerify({ factorId: enrollData.id, code: totpCode })
    if (verErr) { setMfaError('Invalid code. Make sure you scanned the QR code correctly.'); setTotpCode(''); setMfaLoading(false); totpRef.current?.focus(); return }
    setMfaLoading(false)
    await handleSession(pendingSession)
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

        {/* MFA — Verify TOTP */}
        {view === 'totp' && (
          <div className="card">
            <div className="card-band">
              <div className="band-eyebrow">Two-factor authentication</div>
              <div className="band-title">Enter your code</div>
              <div className="band-sub">Open your authenticator app and enter the 6-digit code</div>
            </div>
            <div className="card-body">
              {mfaError && (
                <div className="error-msg show">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
                  </svg>
                  <span>{mfaError}</span>
                </div>
              )}
              <div className="field">
                <label className="field-label">Authentication Code</label>
                <div className="input-wrap">
                  <span className="input-icon">
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                    </svg>
                  </span>
                  <input
                    ref={totpRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={totpCode}
                    onChange={e => { setTotpCode(e.target.value.replace(/\D/g, '')); setMfaError('') }}
                    onKeyDown={e => e.key === 'Enter' && submitTOTP()}
                    placeholder="000000"
                    style={{letterSpacing:'0.3em',fontSize:20,fontFamily:'var(--mono)',textAlign:'center'}}
                  />
                </div>
              </div>
              <button className="submit-btn" onClick={submitTOTP} disabled={mfaLoading}>
                {mfaLoading ? <><div className="spinner" /><span>Verifying...</span></> : <span>Verify</span>}
              </button>
              <button style={{marginTop:10,width:'100%',background:'none',border:'none',color:'var(--gray-400)',fontSize:13,cursor:'pointer'}} onClick={() => { setView('login'); setTotpCode(''); setMfaError('') }}>
                Back to login
              </button>
            </div>
          </div>
        )}

        {/* MFA — First time enroll */}
        {view === 'enroll' && enrollData && (
          <div className="card">
            <div className="card-band">
              <div className="band-eyebrow">Admin security setup</div>
              <div className="band-title">Set up 2-factor auth</div>
              <div className="band-sub">Scan with Google Authenticator or any TOTP app</div>
            </div>
            <div className="card-body">
              {mfaError && (
                <div className="error-msg show">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
                  </svg>
                  <span>{mfaError}</span>
                </div>
              )}
              <div style={{textAlign:'center',margin:'0 0 16px'}}>
                <div dangerouslySetInnerHTML={{ __html: enrollData.qr_code }} style={{display:'inline-block',background:'white',padding:12,borderRadius:8,border:'1px solid var(--gray-200)'}} />
                <div style={{marginTop:10,fontSize:11,color:'var(--gray-400)'}}>
                  Can't scan? Enter manually:<br/>
                  <span style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--gray-600)',letterSpacing:'0.1em',wordBreak:'break-all'}}>{enrollData.secret}</span>
                </div>
              </div>
              <div className="field">
                <label className="field-label">Confirm with 6-digit code</label>
                <div className="input-wrap">
                  <span className="input-icon">
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                    </svg>
                  </span>
                  <input
                    ref={totpRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={totpCode}
                    onChange={e => { setTotpCode(e.target.value.replace(/\D/g, '')); setMfaError('') }}
                    onKeyDown={e => e.key === 'Enter' && submitEnroll()}
                    placeholder="000000"
                    style={{letterSpacing:'0.3em',fontSize:20,fontFamily:'var(--mono)',textAlign:'center'}}
                  />
                </div>
              </div>
              <button className="submit-btn" onClick={submitEnroll} disabled={mfaLoading}>
                {mfaLoading ? <><div className="spinner" /><span>Activating...</span></> : <span>Activate 2FA</span>}
              </button>
              <button style={{marginTop:10,width:'100%',background:'none',border:'none',color:'var(--gray-400)',fontSize:13,cursor:'pointer'}} onClick={() => { setView('login'); setTotpCode(''); setMfaError('') }}>
                Back to login
              </button>
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
