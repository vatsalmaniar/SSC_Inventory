import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import { toast } from '../lib/toast'
import { fmt } from '../lib/fmt'
import '../styles/orders-redesign.css'

const ROLE_LABELS = {
  admin: 'Admin', sales: 'Sales', ops: 'Ops', accounts: 'Accounts', management: 'Management',
  fc_kaveri: 'FC Kaveri', fc_godawari: 'FC Godawari', demo: 'Demo',
}
const ROLE_COLORS = {
  admin:       { bg:'#fef2f2', color:'#dc2626', border:'#fecaca' },
  sales:       { bg:'#eff6ff', color:'#1d4ed8', border:'#bfdbfe' },
  ops:         { bg:'#f0fdf4', color:'#15803d', border:'#bbf7d0' },
  accounts:    { bg:'#faf5ff', color:'#7e22ce', border:'#e9d5ff' },
  management:  { bg:'#fdf4ff', color:'#a21caf', border:'#f5d0fe' },
  fc_kaveri:   { bg:'#fff7ed', color:'#c2410c', border:'#fed7aa' },
  fc_godawari: { bg:'#fff7ed', color:'#c2410c', border:'#fed7aa' },
  demo:        { bg:'#f1f5f9', color:'#475569', border:'#e2e8f0' },
}

const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(name) { let h=0; for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }
function initials(name) { return (name||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) }

export default function UserManagement() {
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [currentUserId, setCurrentUserId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')   // 'all' | 'active' | 'suspended'
  const [editingId, setEditingId] = useState(null)
  const [editEmail, setEditEmail] = useState('')
  const [busyId, setBusyId] = useState(null)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (profile?.role !== 'admin') { navigate('/dashboard'); return }
    setCurrentUserId(session.user.id)
    await loadUsers()
    setLoading(false)
  }

  async function loadUsers() {
    const { data, error } = await sb.rpc('admin_list_users')
    if (error) { toast.error('Failed to load users'); return }
    setUsers(data || [])
  }

  function startEdit(u) { setEditingId(u.id); setEditEmail(u.email || '') }
  function cancelEdit() { setEditingId(null); setEditEmail('') }

  async function saveEmail(userId) {
    setBusyId(userId)
    const val = editEmail.trim() || null
    const { error } = await sb.from('profiles').update({ email: val }).eq('id', userId)
    setBusyId(null)
    if (error) { toast.error('Failed to update email'); return }
    toast.success('Email updated')
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, email: val } : u))
    setEditingId(null); setEditEmail('')
  }

  async function togglePasswordReset(u) {
    const turningOn = !u.must_change_password
    if (!window.confirm(turningOn
      ? `Force ${u.name} to change password at next login?`
      : `Clear force-password-change flag for ${u.name}?`)) return
    setBusyId(u.id)
    const { error } = await sb.from('profiles').update({ must_change_password: turningOn }).eq('id', u.id)
    setBusyId(null)
    if (error) { toast.error('Failed to update'); return }
    toast.success(turningOn ? 'User will be forced to change password' : 'Flag cleared')
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, must_change_password: turningOn } : x))
  }

  async function toggleSuspend(u) {
    if (u.id === currentUserId) { toast.error('Cannot suspend your own account'); return }
    const turningOn = !u.is_suspended
    if (!window.confirm(turningOn
      ? `Suspend ${u.name}? They will not be able to log in until reactivated.`
      : `Reactivate ${u.name}? They will be able to log in again.`)) return
    setBusyId(u.id)
    const { error } = await sb.rpc('admin_set_user_suspended', { p_user_id: u.id, p_suspend: turningOn })
    setBusyId(null)
    if (error) { toast.error(error.message || 'Failed'); return }
    toast.success(turningOn ? `${u.name} suspended` : `${u.name} reactivated`)
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_suspended: turningOn } : x))
  }

  async function resetAuthenticator(u) {
    if (!window.confirm(`Reset ${u.name}'s authenticator (2FA)?\n\nTheir current authenticator app will stop working. At next login they'll be shown a fresh QR code to set it up again. Their password is unchanged.`)) return
    setBusyId(u.id)
    const { data, error } = await sb.rpc('admin_reset_user_mfa', { p_user_id: u.id })
    setBusyId(null)
    if (error) { toast.error(error.message || 'Failed to reset authenticator'); return }
    toast.success(data > 0 ? `${u.name}'s authenticator reset — they set up a fresh one at next login` : `${u.name} had no authenticator enrolled`)
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, has_mfa: false } : x))
  }

  const roles = useMemo(() => {
    const set = new Set(users.map(u => u.role).filter(Boolean))
    return ['all', ...Array.from(set).sort()]
  }, [users])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter(u => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (statusFilter === 'active' && u.is_suspended) return false
      if (statusFilter === 'suspended' && !u.is_suspended) return false
      if (!q) return true
      return (u.name || '').toLowerCase().includes(q)
          || (u.username || '').toLowerCase().includes(q)
          || (u.email || '').toLowerCase().includes(q)
    })
  }, [users, search, roleFilter, statusFilter])

  const stats = useMemo(() => ({
    total:     users.length,
    active:    users.filter(u => !u.is_suspended).length,
    suspended: users.filter(u => u.is_suspended).length,
    pending:   users.filter(u => u.must_change_password).length,
  }), [users])

  if (loading) return (
    <Layout pageTitle="User Management">
      <div className="orders-app"><div style={{ padding:60, textAlign:'center', color:'var(--o-muted)' }}>Loading users…</div></div>
    </Layout>
  )

  return (
    <Layout pageTitle="User Management">
      <div className="orders-app" style={{ padding:'20px 24px 40px' }}>
        {/* Page header */}
        <div className="page-head">
          <div>
            <h1 className="page-title">User Management</h1>
            <div className="page-sub">Manage users — emails, password resets, and account suspension</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill"><span className="meta-label">USERS</span><span style={{ fontWeight:600 }}>{stats.total}</span></div>
            <div className="meta-pill" style={{ background:'rgba(16,185,129,0.08)', borderColor:'rgba(16,185,129,0.2)', color:'#047857' }}>
              <span className="meta-label" style={{ color:'#047857' }}>ACTIVE</span><span style={{ fontWeight:600 }}>{stats.active}</span>
            </div>
            {stats.suspended > 0 && (
              <div className="meta-pill" style={{ background:'#fef2f2', borderColor:'#fecaca', color:'#dc2626' }}>
                <span className="meta-label" style={{ color:'#dc2626' }}>SUSPENDED</span><span style={{ fontWeight:600 }}>{stats.suspended}</span>
              </div>
            )}
            {stats.pending > 0 && (
              <div className="meta-pill" style={{ background:'#fffbeb', borderColor:'#fde68a', color:'#92400e' }}>
                <span className="meta-label" style={{ color:'#92400e' }}>RESETS</span><span style={{ fontWeight:600 }}>{stats.pending}</span>
              </div>
            )}
          </div>
        </div>

        {/* Filters */}
        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:14, flexWrap:'wrap' }}>
          <input
            type="text"
            placeholder="Search by name, username, or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex:'1 1 240px', maxWidth:340, padding:'8px 12px', fontSize:13, border:'1px solid var(--o-line)', borderRadius:9, outline:'none', background:'var(--o-surface)', fontFamily:'inherit' }}
          />

          {/* Status filter */}
          <div style={{ display:'flex', gap:4, padding:3, background:'var(--o-bg-2)', borderRadius:9 }}>
            {['active','suspended','all'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                style={{
                  padding:'5px 12px', fontSize:12, fontWeight:600, borderRadius:7, cursor:'pointer',
                  border:'none',
                  background: statusFilter === s ? 'var(--o-surface)' : 'transparent',
                  color: statusFilter === s ? 'var(--o-ink)' : 'var(--o-muted)',
                  boxShadow: statusFilter === s ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  textTransform: 'capitalize',
                }}>
                {s}
              </button>
            ))}
          </div>

          {/* Role filter */}
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {roles.map(r => (
              <button key={r} onClick={() => setRoleFilter(r)}
                style={{
                  padding:'6px 11px', fontSize:12, fontWeight:500, borderRadius:8, cursor:'pointer',
                  border: '1px solid ' + (roleFilter === r ? 'var(--ssc-deep)' : 'var(--o-line)'),
                  background: roleFilter === r ? 'var(--ssc-deep)' : 'var(--o-surface)',
                  color: roleFilter === r ? '#fff' : 'var(--o-ink)',
                }}>
                {r === 'all' ? 'All Roles' : (ROLE_LABELS[r] || r)}
              </button>
            ))}
          </div>
        </div>

        {/* Tile grid */}
        {filtered.length === 0 ? (
          <div className="card" style={{ textAlign:'center', padding:50, color:'var(--o-muted)' }}>
            No users match your filters.
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:12 }}>
            {filtered.map(u => {
              const rc = ROLE_COLORS[u.role] || { bg:'#f1f5f9', color:'#475569', border:'#e2e8f0' }
              const defaultEmail = (u.username || '') + '@ssccontrol.com'
              const isEditing = editingId === u.id
              const busy = busyId === u.id
              const isSelf = u.id === currentUserId

              return (
                <div key={u.id} className="card" style={{
                  padding:0, display:'flex', flexDirection:'column',
                  opacity: u.is_suspended ? 0.78 : 1,
                  borderColor: u.is_suspended ? '#fecaca' : 'var(--o-line)',
                }}>
                  {/* Header strip with status dot */}
                  <div style={{
                    padding:'14px 16px', display:'flex', gap:12, alignItems:'center',
                    borderBottom:'1px solid var(--o-line)',
                    background: u.is_suspended ? 'linear-gradient(to right, #fef2f2 0%, transparent 60%)' : 'transparent',
                  }}>
                    <div style={{ position:'relative', flexShrink:0 }}>
                      <div style={{
                        width:46, height:46, borderRadius:'50%', background:ownerColor(u.name || ''),
                        color:'white', fontSize:14, fontWeight:700,
                        display:'flex', alignItems:'center', justifyContent:'center',
                        filter: u.is_suspended ? 'grayscale(0.6)' : 'none',
                      }}>{initials(u.name) || '??'}</div>
                      <span style={{
                        position:'absolute', bottom:0, right:0, width:13, height:13, borderRadius:'50%',
                        background: u.is_suspended ? '#dc2626' : '#10b981',
                        border:'2px solid var(--o-surface)',
                      }} title={u.is_suspended ? 'Suspended' : 'Active'} />
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                        <div style={{ fontWeight:600, fontSize:14.5, color:'var(--o-ink)' }}>{u.name}</div>
                        {isSelf && <span style={{ fontSize:10, fontWeight:600, color:'var(--o-muted)', background:'var(--o-bg-2)', padding:'1px 6px', borderRadius:4 }}>YOU</span>}
                      </div>
                      <div className="mono" style={{ fontSize:11.5, color:'var(--o-muted)', marginTop:2 }}>{u.username}</div>
                    </div>
                  </div>

                  {/* Body */}
                  <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:10, flex:1 }}>
                    {/* Badges */}
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      <span style={{
                        padding:'3px 8px', borderRadius:6, fontSize:10.5, fontWeight:600,
                        background:rc.bg, color:rc.color, border:'1px solid '+rc.border,
                      }}>
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                      <span style={{
                        padding:'3px 8px', borderRadius:6, fontSize:10.5, fontWeight:600,
                        background: u.is_suspended ? '#fef2f2' : '#f0fdf4',
                        color:      u.is_suspended ? '#dc2626' : '#15803d',
                        border:     '1px solid ' + (u.is_suspended ? '#fecaca' : '#bbf7d0'),
                      }}>
                        {u.is_suspended ? '● Suspended' : '● Active'}
                      </span>
                      {u.must_change_password && (
                        <span style={{
                          padding:'3px 8px', borderRadius:6, fontSize:10.5, fontWeight:600,
                          background:'#fef3c7', color:'#b45309', border:'1px solid #fcd34d',
                        }}>⚠ Reset pending</span>
                      )}
                      <span style={{
                        padding:'3px 8px', borderRadius:6, fontSize:10.5, fontWeight:600,
                        background: u.has_mfa ? '#eff6ff' : '#f1f5f9',
                        color:      u.has_mfa ? '#1d4ed8' : '#94a3b8',
                        border:     '1px solid ' + (u.has_mfa ? '#bfdbfe' : '#e2e8f0'),
                      }}>
                        {u.has_mfa ? '🔒 2FA on' : '2FA not set'}
                      </span>
                    </div>

                    {/* Email row */}
                    <div>
                      <div className="mono" style={{ fontSize:10, color:'var(--o-muted)', letterSpacing:'0.06em', marginBottom:4 }}>EMAIL</div>
                      {isEditing ? (
                        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                          <input
                            type="email"
                            value={editEmail}
                            onChange={e => setEditEmail(e.target.value)}
                            placeholder={defaultEmail}
                            onKeyDown={e => { if (e.key === 'Enter') saveEmail(u.id); if (e.key === 'Escape') cancelEdit() }}
                            autoFocus
                            style={{ flex:1, padding:'6px 10px', fontSize:12.5, border:'1.5px solid var(--ssc-deep)', borderRadius:7, outline:'none', fontFamily:'inherit', minWidth:0 }}
                          />
                          <button onClick={() => saveEmail(u.id)} disabled={busy} className="btn-primary" style={{ padding:'6px 11px', fontSize:12 }}>
                            {busy ? '…' : 'Save'}
                          </button>
                          <button onClick={cancelEdit} className="btn-ghost" style={{ padding:'6px 9px', fontSize:12 }}>×</button>
                        </div>
                      ) : (
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <div style={{ fontSize:12.5, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                            color: u.email ? 'var(--o-ink)' : 'var(--o-muted)' }}>
                            {u.email || `${defaultEmail} (default)`}
                          </div>
                          <button onClick={() => startEdit(u)} className="btn-ghost" style={{ padding:'4px 9px', fontSize:11 }}>Edit</button>
                        </div>
                      )}
                    </div>

                    {/* Last sign in */}
                    {u.last_sign_in_at && (
                      <div style={{ fontSize:11, color:'var(--o-muted)' }}>
                        Last login · {fmt(u.last_sign_in_at)}
                      </div>
                    )}
                  </div>

                  {/* Actions footer */}
                  <div style={{
                    padding:'10px 16px', borderTop:'1px solid var(--o-line)',
                    display:'flex', gap:6, background:'var(--o-bg-2)', borderRadius:'0 0 var(--o-radius) var(--o-radius)',
                  }}>
                    <button
                      onClick={() => togglePasswordReset(u)}
                      disabled={busy || u.is_suspended}
                      title={u.is_suspended ? 'Reactivate user first' : (u.must_change_password ? 'Clear force-password-change flag' : 'Force password change at next login')}
                      style={{
                        flex:1, padding:'7px 10px', fontSize:11.5, fontWeight:600, borderRadius:7,
                        cursor: (busy || u.is_suspended) ? 'not-allowed' : 'pointer',
                        background: u.must_change_password ? '#fef3c7' : 'var(--o-surface)',
                        color:      u.must_change_password ? '#b45309' : 'var(--o-ink)',
                        border:     '1px solid ' + (u.must_change_password ? '#fcd34d' : 'var(--o-line)'),
                        opacity: u.is_suspended ? 0.5 : 1,
                      }}>
                      {u.must_change_password ? 'Clear Reset' : 'Force Password Change'}
                    </button>
                    <button
                      onClick={() => toggleSuspend(u)}
                      disabled={busy || isSelf}
                      title={isSelf ? 'Cannot suspend your own account' : (u.is_suspended ? 'Reactivate this user' : 'Suspend — blocks login')}
                      style={{
                        padding:'7px 12px', fontSize:11.5, fontWeight:600, borderRadius:7,
                        cursor: (busy || isSelf) ? 'not-allowed' : 'pointer',
                        background: u.is_suspended ? '#dcfce7' : '#fef2f2',
                        color:      u.is_suspended ? '#15803d' : '#dc2626',
                        border:     '1px solid ' + (u.is_suspended ? '#bbf7d0' : '#fecaca'),
                        opacity: isSelf ? 0.4 : 1,
                      }}>
                      {u.is_suspended ? 'Reactivate' : 'Suspend'}
                    </button>
                    <button
                      onClick={() => resetAuthenticator(u)}
                      disabled={busy}
                      title={u.has_mfa ? 'Reset authenticator — user re-enrolls 2FA at next login' : 'No authenticator enrolled'}
                      style={{
                        padding:'7px 12px', fontSize:11.5, fontWeight:600, borderRadius:7,
                        cursor: busy ? 'not-allowed' : 'pointer',
                        background: '#eff6ff', color:'#1d4ed8', border:'1px solid #bfdbfe',
                      }}>
                      Reset 2FA
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Help footer */}
        <div className="card" style={{ marginTop:16, padding:14, background:'#fffbeb', borderColor:'#fde68a' }}>
          <div style={{ fontSize:12, color:'#92400e', lineHeight:1.6 }}>
            <strong>How this works:</strong>
            <ul style={{ margin:'6px 0 0 18px', padding:0 }}>
              <li><strong>Email</strong> — if blank, notifications go to <code style={{ background:'#fef3c7', padding:'1px 5px', borderRadius:4 }}>username@ssccontrol.com</code>.</li>
              <li><strong>Force Password Change</strong> — user is redirected to <code style={{ background:'#fef3c7', padding:'1px 5px', borderRadius:4 }}>/change-password</code> on next login.</li>
              <li><strong>Suspend</strong> — instantly blocks the user from logging in. Existing sessions remain valid until they next refresh; click again to reactivate.</li>
            </ul>
          </div>
        </div>
      </div>
    </Layout>
  )
}
