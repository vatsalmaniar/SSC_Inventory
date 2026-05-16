import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import { toast } from '../lib/toast'
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
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editEmail, setEditEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (profile?.role !== 'admin') { navigate('/dashboard'); return }
    await loadUsers()
    setLoading(false)
  }

  async function loadUsers() {
    const { data } = await sb.from('profiles').select('id,name,username,role,email,must_change_password').order('name')
    setUsers(data || [])
  }

  function startEdit(u) { setEditingId(u.id); setEditEmail(u.email || '') }
  function cancelEdit() { setEditingId(null); setEditEmail('') }

  async function saveEmail(userId) {
    setSaving(true)
    const val = editEmail.trim() || null
    const { error } = await sb.from('profiles').update({ email: val }).eq('id', userId)
    setSaving(false)
    if (error) { toast.error('Failed to update email'); return }
    toast.success('Email updated')
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, email: val } : u))
    setEditingId(null); setEditEmail('')
  }

  async function togglePasswordReset(u) {
    const turningOn = !u.must_change_password
    const msg = turningOn
      ? `Force ${u.name} to change password at next login?`
      : `Clear the force-password-change flag for ${u.name}?`
    if (!window.confirm(msg)) return
    const { error } = await sb.from('profiles').update({ must_change_password: turningOn }).eq('id', u.id)
    if (error) { toast.error('Failed to update'); return }
    toast.success(turningOn ? 'User will be forced to change password' : 'Flag cleared')
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, must_change_password: turningOn } : x))
  }

  const roles = useMemo(() => {
    const set = new Set(users.map(u => u.role).filter(Boolean))
    return ['all', ...Array.from(set).sort()]
  }, [users])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter(u => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (!q) return true
      return (u.name || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
    })
  }, [users, search, roleFilter])

  const pendingResets = useMemo(() => users.filter(u => u.must_change_password).length, [users])

  if (loading) return (
    <Layout pageTitle="User Management" pageKey="admin">
      <div className="orders-app"><div style={{ padding:60, textAlign:'center', color:'var(--o-muted)' }}>Loading users…</div></div>
    </Layout>
  )

  return (
    <Layout pageTitle="User Management" pageKey="admin">
      <div className="orders-app" style={{ padding:'20px 24px 40px' }}>
        {/* Page header */}
        <div className="page-head">
          <div>
            <h1 className="page-title">User Management</h1>
            <div className="page-sub">Manage email addresses for notifications and force password changes</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill"><span className="meta-label">USERS</span><span style={{ fontWeight:600 }}>{users.length}</span></div>
            {pendingResets > 0 && (
              <div className="meta-pill" style={{ background:'#fffbeb', borderColor:'#fde68a', color:'#92400e' }}>
                <span className="meta-label" style={{ color:'#92400e' }}>RESETS</span><span style={{ fontWeight:600 }}>{pendingResets}</span>
              </div>
            )}
          </div>
        </div>

        {/* Search + role filter */}
        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:14, flexWrap:'wrap' }}>
          <input
            type="text"
            placeholder="Search by name, username, or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex:'1 1 240px', maxWidth:360, padding:'8px 12px', fontSize:13, border:'1px solid var(--o-line)', borderRadius:9, outline:'none', background:'var(--o-surface)', fontFamily:'inherit' }}
          />
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {roles.map(r => (
              <button
                key={r}
                onClick={() => setRoleFilter(r)}
                style={{
                  padding:'6px 11px', fontSize:12, fontWeight:500, borderRadius:8, cursor:'pointer',
                  border: '1px solid ' + (roleFilter === r ? 'var(--ssc-deep)' : 'var(--o-line)'),
                  background: roleFilter === r ? 'var(--ssc-deep)' : 'var(--o-surface)',
                  color: roleFilter === r ? '#fff' : 'var(--o-ink)',
                  textTransform: r === 'all' ? 'none' : 'capitalize',
                }}
              >
                {r === 'all' ? 'All Roles' : (ROLE_LABELS[r] || r)}
              </button>
            ))}
          </div>
        </div>

        {/* User list */}
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.length === 0 && (
            <div className="card" style={{ textAlign:'center', padding:40, color:'var(--o-muted)' }}>
              No users match your filters.
            </div>
          )}
          {filtered.map(u => {
            const rc = ROLE_COLORS[u.role] || { bg:'#f1f5f9', color:'#475569', border:'#e2e8f0' }
            const defaultEmail = (u.username || '') + '@ssccontrol.com'
            const isEditing = editingId === u.id

            return (
              <div key={u.id} className="card" style={{ padding:'14px 18px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
                  {/* Avatar */}
                  <div style={{ width:40, height:40, borderRadius:'50%', background:ownerColor(u.name || ''), color:'white', fontSize:13, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    {initials(u.name) || '??'}
                  </div>

                  {/* Identity */}
                  <div style={{ flex:'1 1 180px', minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <div style={{ fontWeight:600, fontSize:14, color:'var(--o-ink)' }}>{u.name}</div>
                      <span style={{
                        padding:'2px 8px', borderRadius:6, fontSize:10.5, fontWeight:600,
                        background:rc.bg, color:rc.color, border:'1px solid ' + rc.border,
                      }}>
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                      {u.must_change_password && (
                        <span style={{
                          padding:'2px 8px', borderRadius:6, fontSize:10.5, fontWeight:600,
                          background:'#fef3c7', color:'#b45309', border:'1px solid #fcd34d',
                        }}>
                          ⚠ Must change password
                        </span>
                      )}
                    </div>
                    <div className="mono" style={{ fontSize:11.5, color:'var(--o-muted)', marginTop:3 }}>
                      {u.username}
                    </div>
                  </div>

                  {/* Email */}
                  <div style={{ flex:'2 1 260px', minWidth:0 }}>
                    {isEditing ? (
                      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                        <input
                          type="email"
                          value={editEmail}
                          onChange={e => setEditEmail(e.target.value)}
                          placeholder={defaultEmail}
                          onKeyDown={e => { if (e.key === 'Enter') saveEmail(u.id); if (e.key === 'Escape') cancelEdit() }}
                          autoFocus
                          style={{ flex:1, padding:'7px 11px', fontSize:13, border:'1.5px solid var(--ssc-deep)', borderRadius:8, outline:'none', fontFamily:'inherit' }}
                        />
                        <button onClick={() => saveEmail(u.id)} disabled={saving} className="btn-primary" style={{ padding:'7px 14px' }}>
                          {saving ? '…' : 'Save'}
                        </button>
                        <button onClick={cancelEdit} className="btn-ghost" style={{ padding:'7px 12px' }}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}>
                        <div style={{ fontSize:13, flex:'1 1 160px', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {u.email ? (
                            <span style={{ color:'var(--o-ink)' }}>{u.email}</span>
                          ) : (
                            <span style={{ color:'var(--o-muted)' }}>{defaultEmail} <span style={{ fontSize:10 }}>(default)</span></span>
                          )}
                        </div>
                        <button onClick={() => startEdit(u)} className="btn-ghost" style={{ padding:'6px 12px', fontSize:12 }}>
                          Edit Email
                        </button>
                        <button
                          onClick={() => togglePasswordReset(u)}
                          title={u.must_change_password ? 'Clear force-password-change flag' : 'Force password change at next login'}
                          style={{
                            padding:'6px 12px', fontSize:12, fontWeight:600, borderRadius:9, cursor:'pointer', whiteSpace:'nowrap',
                            background: u.must_change_password ? '#fef3c7' : 'var(--o-surface)',
                            color:    u.must_change_password ? '#b45309' : 'var(--o-ink)',
                            border:   '1px solid ' + (u.must_change_password ? '#fcd34d' : 'var(--o-line)'),
                          }}>
                          {u.must_change_password ? 'Clear Reset' : 'Force Password Change'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Help footer */}
        <div className="card" style={{ marginTop:16, padding:14, background:'#fffbeb', borderColor:'#fde68a' }}>
          <div style={{ fontSize:12, color:'#92400e', lineHeight:1.6 }}>
            <strong>How this works:</strong>
            <ul style={{ margin:'6px 0 0 18px', padding:0 }}>
              <li><strong>Email</strong> — if blank, notifications go to <code style={{ background:'#fef3c7', padding:'1px 5px', borderRadius:4 }}>username@ssccontrol.com</code>. Users sharing an email receive one copy per notification.</li>
              <li><strong>Force Password Change</strong> — flips the <code style={{ background:'#fef3c7', padding:'1px 5px', borderRadius:4 }}>must_change_password</code> flag. User stays logged out of all features and is redirected to <code style={{ background:'#fef3c7', padding:'1px 5px', borderRadius:4 }}>/change-password</code> on next login. They authenticate with their current password, then must set a new one.</li>
            </ul>
          </div>
        </div>
      </div>
    </Layout>
  )
}
