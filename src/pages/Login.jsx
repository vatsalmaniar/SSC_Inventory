import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { sb, stampLoginNow } from '../lib/supabase'
import { toast } from '../lib/toast'
import '../styles/login.css'

const HCAPTCHA_SITE_KEY = '3eb698c2-27c4-46b8-bc52-6aa0e778a0cc'

export default function Login() {
  const navigate = useNavigate()
  const [username, setUsername]     = useState('')
  const [password, setPassword]     = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [showPwd, setShowPwd]       = useState(false)
  // Caps Lock indicator. Reads ONLY the modifier state of a keydown the browser already
  // delivered — no keystroke is captured, stored or transmitted, it never touches the
  // password value, and it changes nothing about the auth call.
  const [capsOn, setCapsOn]         = useState(false)
  const [view, setView]             = useState('login') // 'login' | 'totp' | 'enroll' | 'selector'

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
  const captchaRef  = useRef(null)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaFailed, setCaptchaFailed] = useState(false)

  // Login page has its own dual-tone design; dark theme would render the
  // white right-panel inputs unreadably. Force light while on /login,
  // restore the saved preference on unmount.
  useEffect(() => {
    const saved = document.documentElement.getAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme')
    return () => { if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark') }
  }, [])

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      if (data?.session) handleSession(data.session)
    })
    usernameRef.current?.focus()
  }, [])

  async function handleSession(session) {
    const { data: profile } = await sb
      .from('profiles').select('id, name, role, username, must_change_password, password_changed_at').eq('id', session.user.id).single()
    const name = profile?.name || session.user.email.split('@')[0]
    const role = profile?.role || 'sales'

    // Conservative: if profile fetch came back partial / RLS race / network glitch,
    // we don't have a reliable password_changed_at — treat it as "unknown, don't force".
    // Otherwise a flaky load bounces the user to /change-password on a normal refresh.
    const ageMs = profile?.password_changed_at ? (Date.now() - new Date(profile.password_changed_at).getTime()) : null
    const expiredByAge = ageMs !== null && ageMs > 90 * 24 * 60 * 60 * 1000
    const needsPwdChange = (profile?.must_change_password === true) || expiredByAge

    if (needsPwdChange) {
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') {
        setPendingSession(session)
        setPendingProfile(profile)
        await checkAdminMFA()
        return
      }
      navigate('/change-password')
      return
    }

    // Landing (decision 2026-09-09): the fulfilment roles and warehouse/back-office
    // 'staff' open on People — People 360 is the whole of their day. Everyone else
    // opens on the dashboard, which carries the company overview.
    //
    // 'demo' stays on /dashboard regardless: it appears in NO nav item's roles, so
    // Layout's accessDenied would hard-block it on /people.
    if (['fc_kaveri', 'fc_godawari', 'staff'].includes(role)) {
      // Toast, not a full-screen interstitial. toast() appends to document.body,
      // outside the React tree, so it survives the navigate and lands with the user
      // on People rather than holding them on a "Welcome" screen for 1.6 seconds.
      toast('Welcome, ' + name, 'success')
      navigate('/people')
      return
    }

    toast('Welcome, ' + name, 'success')
    navigate('/dashboard')
  }

  async function doLogin() {
    const u = username.trim().toLowerCase()
    const p = password
    if (!u) { setError('Please enter your username.'); return }
    if (!p) { setError('Please enter your password.'); return }

    setLoading(true)
    setError('')

    const email = u + '@ssccontrol.com'
    const { data, error: authErr } = await sb.auth.signInWithPassword({
      email,
      password: p,
      options: captchaToken ? { captchaToken } : undefined,
    })
    captchaRef.current?.resetCaptcha()
    setCaptchaToken('')

    if (authErr) {
      sb.from('login_audit').insert({
        user_id: null, user_name: null,
        email: email, event_type: 'login_failed',
        user_agent: navigator.userAgent,
      }).then(() => {}).catch(() => {})
      setLoading(false)
      // Don't blame the password for a failure that never reached the password.
      // A captcha rejection means the request was refused before any credential
      // check, and telling the user "wrong password" sends them off resetting it.
      setError(/captcha/i.test(authErr.message || '')
        ? 'Security check failed. Please complete the CAPTCHA and try again.'
        : 'Invalid username or password.')
      setPassword('')
      return
    }

    // Fresh credential login succeeded — stamp the re-login clock (LOGIN_MAX_AGE_MS, 7 days).
    // (Stamping here instead of onAuthStateChange so cached-session restores
    // don't reset the clock — see src/lib/supabase.js for context.)
    stampLoginNow()

    const { data: profile, error: profileErr } = await sb
      .from('profiles').select('id, name, role, username').eq('id', data.session.user.id).single()

    if (profileErr || !profile) {
      await sb.auth.signOut()
      setLoading(false)
      setError('Account is misconfigured. Please contact admin.')
      setPassword('')
      return
    }

    if (profile.role === 'demo') {
      await handleSession(data.session)
      setLoading(false)
      return
    }

    setPendingSession(data.session)
    setPendingProfile(profile)
    await checkAdminMFA()
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
      // Unenroll any stuck unverified factors first
      for (const f of (factors?.totp || [])) {
        if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id })
      }
      // Enroll fresh
      const { data: enroll, error: enrollErr } = await sb.auth.mfa.enroll({ factorType: 'totp' })

      if (enrollErr) { setError('MFA setup failed: ' + enrollErr.message); return }
      if (!enroll?.totp?.qr_code) { setError('MFA setup failed: no QR code returned. Check Supabase MFA settings.'); return }
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
    // Log successful login (fire-and-forget to not block navigation)
    sb.from('login_audit').insert({
      user_id: pendingProfile.id, user_name: pendingProfile.name,
      email: pendingProfile.username ? pendingProfile.username + '@ssccontrol.com' : '',
      event_type: 'login_success', user_agent: navigator.userAgent,
    }).then(() => {}).catch(() => {})
    setMfaLoading(false)
    await handleSession(pendingSession)
  }

  async function submitEnroll() {
    if (totpCode.length !== 6) { setMfaError('Enter the 6-digit code from your authenticator app.'); return }
    setMfaLoading(true)
    setMfaError('')
    const { error: verErr } = await sb.auth.mfa.challengeAndVerify({ factorId: enrollData.id, code: totpCode })
    if (verErr) { setMfaError('Invalid code. Make sure you scanned the QR code correctly.'); setTotpCode(''); setMfaLoading(false); totpRef.current?.focus(); return }
    // Log successful login (fire-and-forget to not block navigation)
    sb.from('login_audit').insert({
      user_id: pendingProfile.id, user_name: pendingProfile.name,
      email: pendingProfile.username ? pendingProfile.username + '@ssccontrol.com' : '',
      event_type: 'login_success', user_agent: navigator.userAgent,
    }).then(() => {}).catch(() => {})
    setMfaLoading(false)
    await handleSession(pendingSession)
  }

  function goTo(path) {
    navigate(path)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') doLogin()
  }

  const hasError = error.length > 0

  return (
    <div className="split-wrap">
      {/* Centred single-card layout. The old split had a 38-44% brand panel that carried
          a headline, a sub, a badge and a tagline — four pieces of copy nobody reads on
          the way to typing a password. The brand now appears once, as the mark above the
          card, and the ambient wash behind it carries the colour.
          Nothing about authentication changed with the layout. */}
      <div className="lg-ambient" aria-hidden="true">
        <span className="lg-blob lg-blob-a" />
        <span className="lg-blob lg-blob-b" />
      </div>

      <div className="split-right">

        {/* Login form */}
        {view === 'login' && (
          <div className="right-inner">
            <div className="lg-mark"><img src="/ssc-logo.svg" alt="SSC Control Pvt. Ltd." /></div>
            <div className="right-title">Welcome back</div>
            <div className="right-sub">Sign in to your SSC Control account</div>

            {hasError && (
              <div className="error-msg show">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  {/* The dot was `M12 16h.01` — a ZERO-LENGTH line, which renders as
                      nothing unless stroke-linecap is round, and this svg sets none.
                      So the "!" had a stem and no dot. A real circle instead. */}
                  <circle cx="12" cy="12" r="9"/>
                  <path d="M12 7.5v5" strokeLinecap="round"/>
                  <circle cx="12" cy="16.2" r="0.9" fill="currentColor" stroke="none"/>
                </svg>
                <span>{error}</span>
              </div>
            )}

            <div className="field">
              <label className="field-label">Username</label>
              <div className="input-wrap">
                <span className="input-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                </span>
                <input ref={usernameRef} type="text" value={username}
                  onChange={e => { setUsername(e.target.value); setError('') }}
                  onKeyDown={onKeyDown} placeholder="Enter your username"
                  autoComplete="off" autoCapitalize="none"
                  className={hasError ? 'error' : ''} />
              </div>
            </div>

            <div className="field">
              <div className="field-labelrow">
                <label className="field-label">Password</label>
                {capsOn && (
                  <span className="caps-hint">
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4l8 8h-5v5H9v-5H4z"/></svg>
                    Caps Lock is on
                  </span>
                )}
              </div>
              <div className="input-wrap">
                <span className="input-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                  </svg>
                </span>
                <input type={showPwd ? 'text' : 'password'} value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                  onKeyDown={e => { setCapsOn(e.getModifierState && e.getModifierState('CapsLock')); onKeyDown(e) }}
                  onBlur={() => setCapsOn(false)}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className={hasError ? 'error' : ''} />
                <button className="eye-btn" type="button" onClick={() => setShowPwd(v => !v)}>
                  {showPwd ? (
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Rendered on localhost too. Supabase Auth enforces captcha SERVER-side,
                so skipping the widget locally doesn't skip the check — it just sends
                no token and gets "captcha protection: request disallowed", which read
                to the user as a wrong password. Local testing was impossible. */}
            <div className="captcha-wrap">
                <HCaptcha
                  ref={captchaRef}
                  sitekey={HCAPTCHA_SITE_KEY}
                  onVerify={t => { setCaptchaToken(t); setCaptchaFailed(false) }}
                  onExpire={() => setCaptchaToken('')}
                  onError={() => { setCaptchaFailed(true); setCaptchaToken('') }}
                  onChalExpired={() => setCaptchaToken('')}
                  size="normal"
                />
            </div>

            {captchaFailed && (
              <div className="captcha-warn">
                CAPTCHA service unavailable — you can still sign in. If problems persist, contact admin.
              </div>
            )}

            <button className="submit-btn" onClick={doLogin} disabled={loading || (!captchaToken && !captchaFailed)}>
              {loading ? <><div className="spinner"/><span>Signing in...</span></> : <span>Sign in</span>}
            </button>

            <div className="right-footer">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              <span><strong>SSC Control Pvt. Ltd.</strong> · Access limited to authorised team members only.</span>
            </div>
          </div>
        )}

        {/* MFA — Verify TOTP */}
        {view === 'totp' && (
          <div className="right-inner">
            <div className="mfa-eyebrow">Two-factor authentication</div>
            <div className="mfa-title">Enter your code</div>
            <div className="mfa-sub">Open your authenticator app and enter the 6-digit code</div>
            {mfaError && (
              <div className="error-msg show">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  {/* The dot was `M12 16h.01` — a ZERO-LENGTH line, which renders as
                      nothing unless stroke-linecap is round, and this svg sets none.
                      So the "!" had a stem and no dot. A real circle instead. */}
                  <circle cx="12" cy="12" r="9"/>
                  <path d="M12 7.5v5" strokeLinecap="round"/>
                  <circle cx="12" cy="16.2" r="0.9" fill="currentColor" stroke="none"/>
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
                <input ref={totpRef} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                  value={totpCode} onChange={e => { setTotpCode(e.target.value.replace(/\D/g, '')); setMfaError('') }}
                  onKeyDown={e => e.key === 'Enter' && submitTOTP()} placeholder="000000"
                  className="totp-input" />
              </div>
            </div>
            <button className="submit-btn" onClick={submitTOTP} disabled={mfaLoading}>
              {mfaLoading ? <><div className="spinner"/><span>Verifying...</span></> : <span>Verify</span>}
            </button>
            <button className="link-btn"
              onClick={() => { setView('login'); setTotpCode(''); setMfaError('') }}>← Back to login</button>
          </div>
        )}

        {/* MFA — First time enroll */}
        {view === 'enroll' && enrollData && (
          <div className="right-inner">
            <div className="mfa-eyebrow">Security setup</div>
            <div className="mfa-title">Set up 2-factor auth</div>
            <div className="mfa-sub">Scan with Google Authenticator or any TOTP app</div>
            {mfaError && (
              <div className="error-msg show">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  {/* The dot was `M12 16h.01` — a ZERO-LENGTH line, which renders as
                      nothing unless stroke-linecap is round, and this svg sets none.
                      So the "!" had a stem and no dot. A real circle instead. */}
                  <circle cx="12" cy="12" r="9"/>
                  <path d="M12 7.5v5" strokeLinecap="round"/>
                  <circle cx="12" cy="16.2" r="0.9" fill="currentColor" stroke="none"/>
                </svg>
                <span>{mfaError}</span>
              </div>
            )}
            <div className="enroll-qr">
              {/* dangerouslySetInnerHTML is UNCHANGED — it renders the QR svg Supabase
                  returns from mfa.enroll(). Only the wrapper styling moved to a class. */}
              <div className="enroll-qr-box" dangerouslySetInnerHTML={{ __html: enrollData.qr_code }} />
              <div className="enroll-manual">
                Can't scan? Enter manually:<br/>
                <span className="enroll-secret">{enrollData.secret}</span>
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
                <input ref={totpRef} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                  value={totpCode} onChange={e => { setTotpCode(e.target.value.replace(/\D/g, '')); setMfaError('') }}
                  onKeyDown={e => e.key === 'Enter' && submitEnroll()} placeholder="000000"
                  className="totp-input" />
              </div>
            </div>
            <button className="submit-btn" onClick={submitEnroll} disabled={mfaLoading}>
              {mfaLoading ? <><div className="spinner"/><span>Activating...</span></> : <span>Activate 2FA</span>}
            </button>
            <button className="link-btn"
              onClick={() => { setView('login'); setTotpCode(''); setMfaError('') }}>← Back to login</button>
          </div>
        )}

        {/* Admin Selector */}
        {view === 'selector' && (
          <div className="right-inner">
            <div className="selector-eyebrow">Signed in as admin</div>
            <div className="selector-title" id="selector-name">Welcome!</div>
            <button className="view-btn" onClick={() => goTo('/dashboard')}>
              <div className="view-btn-icon sales">
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <path d="M21 21H3M21 21V3M9 21V9m4 12V5m4 16v-6"/>
                </svg>
              </div>
              <div>
                <div className="view-btn-title">Sales View</div>
                <div className="view-btn-sub">Search product codes, check stock</div>
              </div>
              <div className="view-btn-arrow"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></div>
            </button>
            <button className="view-btn" onClick={() => goTo('/billing')}>
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
              <div className="view-btn-arrow"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></div>
            </button>
          </div>
        )}

      </div>{/* end split-right */}

      {/* Success Overlay */}
    </div>
  )
}
