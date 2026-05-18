import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { sb } from '../lib/supabase'

export default function NotAuthorized() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const moduleName = params.get('from') || 'this module'
  const [user, setUser] = useState({ name: '', role: '' })

  useEffect(() => {
    (async () => {
      const { data: { session } } = await sb.auth.getSession()
      if (!session) { navigate('/login'); return }
      const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
      setUser({ name: profile?.name || '', role: profile?.role || '' })
    })()
  }, [])

  return (
    <Layout>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', padding: '24px' }}>
        <div style={{
          maxWidth: 480, width: '100%', textAlign: 'center',
          padding: '40px 32px', borderRadius: 16,
          background: 'var(--card-bg, #fff)',
          border: '1px solid var(--border, #e5e7eb)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: '#FEF3C7', color: '#92400E',
            margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 8px', color: 'var(--text, #111827)' }}>
            You don't have access to {moduleName}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted, #6b7280)', lineHeight: 1.6, margin: '0 0 24px' }}>
            Your current role <strong>{user.role || '—'}</strong> isn't permitted to view this module.
            Please contact your administrator if you believe you should have access.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={() => navigate('/dashboard')}
              style={{
                padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 500,
                background: 'var(--accent, #111827)', color: '#fff', border: 'none', cursor: 'pointer',
              }}>
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    </Layout>
  )
}
