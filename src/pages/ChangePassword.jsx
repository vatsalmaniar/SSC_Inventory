import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import '../styles/login.css'

const RULES = [
  { id: 'len',   label: 'At least 12 characters',           test: p => p.length >= 12 },
  { id: 'lower', label: 'Contains a lowercase letter',      test: p => /[a-z]/.test(p) },
  { id: 'upper', label: 'Contains an uppercase letter',     test: p => /[A-Z]/.test(p) },
  { id: 'digit', label: 'Contains a number',                test: p => /\d/.test(p) },
  { id: 'sym',   label: 'Contains a symbol (e.g. !@#$%^&)', test: p => /[^A-Za-z0-9]/.test(p) },
]

export default function ChangePassword() {
  const navigate = useNavigate()
  const [session, setSession]               = useState(null)
  const [profile, setProfile]               = useState(null)
  const [newPwd, setNewPwd]                 = useState('')
  const [confirmPwd, setConfirmPwd]         = useState('')
  const [showNew, setShowNew]               = useState(false)
  const [error, setError]                   = useState('')
  const [submitting, setSubmitting]         = useState(false)
  const submittingRef = useRef(false)

  useEffect(() => {
    sb.auth.getSession().then(async ({ data }) => {
      if (!data?.session) { navigate('/login'); return }
      setSession(data.session)
      const { data: p } = await sb.from('profiles')
        .select('id, name, role, username, must_change_password').eq('id', data.session.user.id).single()
      if (!p) { await sb.auth.signOut(); navigate('/login'); return }
      setProfile(p)
    })
  }, [])

  const ruleResults = RULES.map(r => ({ ...r, ok: r.test(newPwd) }))
  const allRulesPass = ruleResults.every(r => r.ok)
  const passwordsMatch = newPwd.length > 0 && newPwd === confirmPwd
  const canSubmit = allRulesPass && passwordsMatch && !submitting

  async function handleSubmit() {
    if (submittingRef.current) return
    if (!canSubmit) return
    submittingRef.current = true
    setSubmitting(true)
    setError('')

    await sb.auth.refreshSession()
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') {
      setError('Your MFA session has expired. Please log out and log in again.')
      setSubmitting(false)
      submittingRef.current = false
      return
    }
    const { error: updateErr } = await sb.auth.updateUser({ password: newPwd })
    if (updateErr) {
      const msg = updateErr.message || 'Failed to update password.'
      if (/re-?authentication|reauth|aal/i.test(msg)) {
        await sb.auth.signOut()
        navigate('/login', { state: { notice: 'Please log in again to change your password.' } })
        return
      }
      if (/leaked|breach|pwned/i.test(msg)) {
        setError('This password has appeared in a known data breach. Please choose another.')
      } else if (/weak|requirements/i.test(msg)) {
        setError('Password does not meet the strength requirements.')
      } else {
        setError(msg)
      }
      setSubmitting(false)
      submittingRef.current = false
      return
    }

    const { error: profileErr } = await sb.rpc('mark_password_changed')

    if (profileErr) {
      setError('Password changed, but failed to update profile. Please contact admin.')
      setSubmitting(false)
      submittingRef.current = false
      return
    }

    if (profile.role === 'fc_kaveri' || profile.role === 'fc_godawari') navigate('/fc')
    else if (profile.role === 'accounts') navigate('/billing')
    else navigate('/dashboard')
  }

  if (!session || !profile) {
    return (
      <div className="split-wrap">
        <div className="split-right" style={{ display:'flex', alignItems:'center', justifyContent:'center', width:'100%' }}>
          <div className="spinner" />
        </div>
      </div>
    )
  }

  const forced = profile.must_change_password

  return (
    <div className="split-wrap">
      <div className="split-left">
        <div className="left-orb-top" />
        <div className="left-orb-bottom" />
        <div className="left-content">
          <div><img src="/ssc-logo.svg" alt="SSC Control Pvt. Ltd." style={{height:50,objectFit:'contain',filter:'brightness(0) invert(1)'}}/></div>
          <div className="left-divider" />
          <div className="left-headline">Set a new<br/>secure password</div>
          <div className="left-sub">Strong, unique passwords protect<br/>your account and our data</div>
          <div className="left-badge">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            12+ chars · mixed case · digit · symbol
          </div>
          <div className="left-tagline">your link to excellence</div>
        </div>
      </div>

      <div className="split-right">
        <div className="right-inner">
          <div className="right-eyebrow">{forced ? 'Action required' : 'Account security'}</div>
          <div className="right-title">{forced ? 'Update your password' : 'Change password'}</div>
          <div className="right-sub">
            {forced
              ? 'For security, please set a new password before continuing.'
              : 'Choose a strong new password. You will be returned to the dashboard.'}
          </div>

          {error && (
            <div className="error-msg show">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              <span>{error}</span>
            </div>
          )}

          <div className="field">
            <label className="field-label">New password</label>
            <div className="input-wrap">
              <span className="input-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
              </span>
              <input type={showNew ? 'text' : 'password'} value={newPwd}
                onChange={e => { setNewPwd(e.target.value); setError('') }}
                placeholder="Enter a new strong password" autoComplete="new-password" />
              <button className="eye-btn" type="button" onClick={() => setShowNew(v => !v)}>
                {showNew
                  ? <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
              </button>
            </div>
          </div>

          <div style={{ margin:'4px 0 16px', display:'grid', gap:6 }}>
            {ruleResults.map(r => (
              <div key={r.id} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color: r.ok ? '#16a34a' : '#94a3b8' }}>
                <span style={{ width:14, height:14, borderRadius:'50%', display:'inline-flex', alignItems:'center', justifyContent:'center',
                                background: r.ok ? '#16a34a' : 'transparent', border: r.ok ? 'none' : '1.5px solid #cbd5e1', flexShrink:0 }}>
                  {r.ok && <svg width="9" height="9" fill="none" stroke="white" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>}
                </span>
                {r.label}
              </div>
            ))}
          </div>

          <div className="field">
            <label className="field-label">Confirm new password</label>
            <div className="input-wrap">
              <span className="input-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
              </span>
              <input type={showNew ? 'text' : 'password'} value={confirmPwd}
                onChange={e => { setConfirmPwd(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && canSubmit && handleSubmit()}
                placeholder="Re-enter new password" autoComplete="new-password" />
            </div>
            {confirmPwd.length > 0 && !passwordsMatch && (
              <div style={{ fontSize:12, color:'#dc2626', marginTop:6 }}>Passwords do not match.</div>
            )}
          </div>

          <button className="submit-btn" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <><div className="spinner"/><span>Updating...</span></> : <span>Update password</span>}
          </button>

          {!forced && (
            <button style={{marginTop:12,width:'100%',background:'none',border:'none',color:'var(--gray-400)',fontSize:13,cursor:'pointer'}}
              onClick={() => navigate(-1)}>← Back</button>
          )}

          <div className="right-footer">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            <span><strong style={{color:'var(--gray-600)'}}>SSC Control Pvt. Ltd.</strong> · Passwords are checked against known breaches.</span>
          </div>
        </div>
      </div>
    </div>
  )
}
