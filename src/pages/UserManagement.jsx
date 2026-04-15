import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import { toast } from '../lib/toast'
import '../styles/orderdetail.css'

const ROLE_LABELS = {
  admin: 'Admin', sales: 'Sales', ops: 'Ops', accounts: 'Accounts',
  fc_kaveri: 'FC Kaveri', fc_godawari: 'FC Godawari',
}
const ROLE_COLORS = {
  admin: { bg:'#fef2f2', color:'#dc2626' },
  sales: { bg:'#eff6ff', color:'#1d4ed8' },
  ops: { bg:'#f0fdf4', color:'#15803d' },
  accounts: { bg:'#faf5ff', color:'#7e22ce' },
  fc_kaveri: { bg:'#fff7ed', color:'#c2410c' },
  fc_godawari: { bg:'#fff7ed', color:'#c2410c' },
}

const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(name) { let h=0; for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }

export default function UserManagement() {
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editEmail, setEditEmail] = useState('')
  const [saving, setSaving] = useState(false)

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
    const { data } = await sb.from('profiles').select('id,name,username,role,email').order('name')
    setUsers(data || [])
  }

  function startEdit(u) {
    setEditingId(u.id)
    setEditEmail(u.email || '')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditEmail('')
  }

  async function saveEmail(userId) {
    setSaving(true)
    const val = editEmail.trim() || null
    const { error } = await sb.from('profiles').update({ email: val }).eq('id', userId)
    setSaving(false)
    if (error) { toast.error('Failed to update email'); return }
    toast.success('Email updated')
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, email: val } : u))
    setEditingId(null)
    setEditEmail('')
  }

  if (loading) return <Layout><div style={{ padding:32, textAlign:'center', color:'var(--gray-400)' }}>Loading...</div></Layout>

  return (
    <Layout>
      <div className="od-container" style={{ maxWidth:900 }}>
        <div className="od-header" style={{ marginBottom:20 }}>
          <div>
            <div className="od-header-title">User Management</div>
            <div className="od-header-subtitle">{users.length} users — manage email addresses for notifications</div>
          </div>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {users.map(u => {
            const ini = u.name ? u.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2) : '??'
            const defaultEmail = u.username + '@ssccontrol.com'
            const rc = ROLE_COLORS[u.role] || { bg:'#f1f5f9', color:'#475569' }
            const isEditing = editingId === u.id

            return (
              <div key={u.id} className="od-card" style={{ padding:'14px 18px', margin:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                  {/* Avatar */}
                  <div style={{ width:36, height:36, borderRadius:'50%', background:ownerColor(u.name || ''), color:'white', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{ini}</div>

                  {/* Name + Role */}
                  <div style={{ flex:'1 1 140px', minWidth:0 }}>
                    <div style={{ fontWeight:600, fontSize:13, color:'var(--gray-900)' }}>{u.name}</div>
                    <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:2 }}>
                      {u.username}
                      <span style={{ display:'inline-block', padding:'1px 6px', borderRadius:5, fontSize:10, fontWeight:600, background:rc.bg, color:rc.color, marginLeft:8 }}>
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </div>
                  </div>

                  {/* Email */}
                  <div style={{ flex:'2 1 220px', minWidth:0 }}>
                    {isEditing ? (
                      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                        <input
                          type="email"
                          value={editEmail}
                          onChange={e => setEditEmail(e.target.value)}
                          placeholder={defaultEmail}
                          onKeyDown={e => { if (e.key === 'Enter') saveEmail(u.id); if (e.key === 'Escape') cancelEdit() }}
                          autoFocus
                          style={{ flex:1, padding:'6px 10px', fontSize:13, border:'1.5px solid #1a4dab', borderRadius:8, outline:'none', fontFamily:'inherit' }}
                        />
                        <button onClick={() => saveEmail(u.id)} disabled={saving} style={{ padding:'6px 14px', fontSize:12, fontWeight:600, background:'#1a4dab', color:'white', border:'none', borderRadius:8, cursor:'pointer', whiteSpace:'nowrap' }}>
                          {saving ? '...' : 'Save'}
                        </button>
                        <button onClick={cancelEdit} style={{ padding:'6px 12px', fontSize:12, fontWeight:500, background:'var(--gray-100)', color:'var(--gray-600)', border:'none', borderRadius:8, cursor:'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ fontSize:13, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {u.email ? (
                            <span style={{ color:'var(--gray-800)' }}>{u.email}</span>
                          ) : (
                            <span style={{ color:'var(--gray-400)' }}>{defaultEmail} <span style={{ fontSize:10 }}>(default)</span></span>
                          )}
                        </div>
                        <button onClick={() => startEdit(u)} style={{ padding:'5px 12px', fontSize:12, fontWeight:500, background:'var(--gray-50)', color:'var(--gray-600)', border:'1px solid var(--gray-200)', borderRadius:8, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop:16, padding:12, background:'#fffbeb', borderRadius:8, border:'1px solid #fde68a', fontSize:12, color:'#92400e', lineHeight:1.5 }}>
          <strong>How email works:</strong> If an email is set, notifications go to that address. If blank, the default <code>username@ssccontrol.com</code> is used. Users sharing the same email (e.g. accounts team) will receive only one copy per notification.
        </div>
      </div>
    </Layout>
  )
}
