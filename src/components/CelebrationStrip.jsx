import { useState, useEffect } from 'react'
import { sb } from '../lib/supabase'

// Global celebration bar — fixed across the FULL viewport width (over the sidebar too).
// When present it adds `.has-celebration` on <html>; layout.css offsets sidebar/topbar/main.
// Data via celebrations_today() RPC — names + dates only, no salary. Whole team sees it.
export default function CelebrationStrip() {
  const [items, setItems] = useState([])

  useEffect(() => { load() }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('has-celebration', items.length > 0)
    return () => document.documentElement.classList.remove('has-celebration')
  }, [items])

  async function load() {
    const { data, error } = await sb.rpc('celebrations_today')
    if (error) { console.warn('CelebrationStrip:', error.message); return }
    setItems(data || [])
    // Fire bell notifications + emails once per day (server-deduped via celebration_log).
    // Piggyback on app load; guard per browser session to avoid redundant calls.
    if ((data || []).length && !sessionStorage.getItem('cel_dispatched')) {
      sessionStorage.setItem('cel_dispatched', '1')
      sb.rpc('celebrations_dispatch').catch(() => {})
    }
  }

  if (items.length === 0) return null

  const hasBirthday = items.some(i => i.kind === 'birthday')

  return (
    <div className="cel-strip" style={{
      position:'sticky', top:0, zIndex:300, flexShrink:0, width:'100%',
      height:'var(--cel-h)', display:'flex', alignItems:'center', justifyContent:'center', gap:22,
      padding:'0 20px', overflow:'hidden', whiteSpace:'nowrap',
      background: hasBirthday
        ? 'linear-gradient(90deg, #ec4899 0%, #f97316 55%, #f59e0b 100%)'
        : 'linear-gradient(90deg, #2563eb 0%, #4f46e5 55%, #7c3aed 100%)',
      color:'#fff', fontSize:14, fontWeight:600, letterSpacing:0.1,
    }}>
      {items.map((it, i) => (
        <span key={it.employee_id + it.kind + i} style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:17 }}>{it.kind === 'birthday' ? '🎂' : '🎉'}</span>
          {it.kind === 'birthday'
            ? <span>Happy Birthday, <strong>{it.full_name}</strong>! Wishing you a wonderful year ahead 🥳 — with love, Team SSC</span>
            : <span>Congratulations <strong>{it.full_name}</strong> on <strong>{it.years} year{it.years>1?'s':''}</strong> with SSC! Thank you for all you do 🙌 — Team SSC</span>}
        </span>
      ))}
    </div>
  )
}
