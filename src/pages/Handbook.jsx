import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import { HB_META, HB_PARTS, HB_SECTIONS, HB_CONTACTS } from '../lib/handbookData'
import '../styles/people.css'

const LANGS = [ ['en','EN'], ['hi','हिंदी'], ['gu','ગુજરાતી'] ]
const L = (v, lang) => v == null ? '' : (typeof v === 'string' ? v : (v[lang] || v.en || ''))

const INK = '#0B1B30', MUTED = '#5B6878', MUTED2 = '#94A3B8', LINE = '#E8EBF0', ACCENT = '#1a73e8', BG = '#F8F9FA'

function Para({ children }) {
  return <p style={{ fontSize:14, lineHeight:1.68, color:'#374151', margin:'0 0 12px', whiteSpace:'pre-line' }}>{children}</p>
}
function Sub({ children }) {
  return <div style={{ fontSize:12, fontWeight:600, letterSpacing:'0.04em', textTransform:'uppercase', color:ACCENT, margin:'18px 0 8px' }}>{children}</div>
}

function Block({ b, lang }) {
  if (b.t === 'p') return <Para>{L(b.text, lang)}</Para>
  if (b.t === 'h') return <Sub>{L(b.text, lang)}</Sub>
  if (b.t === 'ul') return (
    <ul style={{ margin:'0 0 12px', padding:0, listStyle:'none' }}>
      {b.items.map((it,i) => (
        <li key={i} style={{ position:'relative', paddingLeft:18, fontSize:14, lineHeight:1.62, color:'#374151', marginBottom:7 }}>
          <span style={{ position:'absolute', left:2, top:9, width:5, height:5, borderRadius:'50%', background:ACCENT }} />
          {L(it, lang)}
        </li>
      ))}
    </ul>
  )
  if (b.t === 'table') return (
    <div style={{ overflowX:'auto', margin:'6px 0 14px' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
        <thead><tr>{b.head.map((h,i) => <th key={i} style={{ textAlign:'left', background:INK, color:'#fff', fontWeight:600, padding:'9px 12px', fontSize:12 }}>{h}</th>)}</tr></thead>
        <tbody>{b.rows.map((r,ri) => (
          <tr key={ri} style={{ background: ri%2 ? '#F8FAFC' : '#fff' }}>
            {r.map((c,ci) => <td key={ci} style={{ padding:'8px 12px', borderTop:`1px solid ${LINE}`, color:'#374151', lineHeight:1.5, verticalAlign:'top', fontWeight: ci===0 ? 600 : 400, whiteSpace: ci===0 ? 'nowrap' : 'normal' }}>{L(c, lang)}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
  if (b.t === 'kv') return (
    <div style={{ border:`1px solid ${LINE}`, borderRadius:10, overflow:'hidden', margin:'6px 0 14px' }}>
      {b.rows.map((r,i) => (
        <div key={i} style={{ display:'grid', gridTemplateColumns:'170px 1fr', borderTop: i ? `1px solid ${LINE}` : 'none' }}>
          <div style={{ padding:'11px 14px', background:BG, fontSize:12.5, fontWeight:600, color:INK }}>{L(r[0], lang)}</div>
          <div style={{ padding:'11px 14px', fontSize:13, lineHeight:1.55, color:'#374151' }}>{L(r[1], lang)}</div>
        </div>
      ))}
    </div>
  )
  if (b.t === 'stats') return (
    <div style={{ display:'grid', gridTemplateColumns:`repeat(${b.items.length}, 1fr)`, gap:1, background:LINE, border:`1px solid ${LINE}`, borderRadius:12, overflow:'hidden', margin:'8px 0 14px' }}>
      {b.items.map((s,i) => (
        <div key={i} style={{ background:'#fff', padding:'16px 12px', textAlign:'center' }}>
          <div style={{ fontSize:26, fontWeight:700, color:INK, fontFamily:"'Geist Mono',monospace" }}>{s[0]}</div>
          <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase', color:MUTED, marginTop:3 }}>{s[1]}</div>
        </div>
      ))}
    </div>
  )
  if (b.t === 'dodont') return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, margin:'8px 0 14px' }}>
      <div style={{ border:'1px solid #cdeede', background:'#f2fbf6', borderRadius:10, padding:'12px 14px' }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.06em', color:'#0E7C4A', marginBottom:6 }}>DO</div>
        {b.do.map((d,i) => <div key={i} style={{ fontSize:12.5, color:'#276749', lineHeight:1.5, marginBottom:4 }}>✓ {d}</div>)}
      </div>
      <div style={{ border:'1px solid #f3d2d2', background:'#fdf4f4', borderRadius:10, padding:'12px 14px' }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.06em', color:'#B42318', marginBottom:6 }}>DON'T</div>
        {b.dont.map((d,i) => <div key={i} style={{ fontSize:12.5, color:'#9B2C2C', lineHeight:1.5, marginBottom:4 }}>✕ {d}</div>)}
      </div>
    </div>
  )
  if (b.t === 'callout') {
    if (b.kind === 'faq') return (
      <div style={{ border:`1px solid ${LINE}`, background:'#F5F8FE', borderRadius:12, padding:'14px 16px', margin:'10px 0 14px' }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.06em', color:ACCENT, marginBottom:8 }}>❓ QUICK FAQ</div>
        {b.items.map((qa,i) => (
          <div key={i} style={{ marginBottom: i < b.items.length-1 ? 10 : 0 }}>
            <div style={{ fontSize:13, fontWeight:600, color:INK, marginBottom:2 }}>Q: {L(qa.q, lang)}</div>
            <div style={{ fontSize:13, color:MUTED, lineHeight:1.55 }}>A: {L(qa.a, lang)}</div>
          </div>
        ))}
      </div>
    )
    const warn = b.kind === 'warn'
    return (
      <div style={{ borderLeft:`3px solid ${warn ? '#C25A00' : ACCENT}`, background: warn ? '#FEF6EE' : '#F5F8FE', borderRadius:8, padding:'12px 16px', margin:'10px 0 14px' }}>
        {b.title && <div style={{ fontSize:12.5, fontWeight:700, color: warn ? '#8A3D00' : ACCENT, marginBottom:6 }}>{L(b.title, lang)}</div>}
        {b.text && <div style={{ fontSize:13, color:'#4B5563', lineHeight:1.6 }}>{L(b.text, lang)}</div>}
        {b.items && b.items.map((it,i) => <div key={i} style={{ fontSize:13, color:'#4B5563', lineHeight:1.55, position:'relative', paddingLeft:16, marginBottom:4 }}><span style={{ position:'absolute', left:2, top:8, width:5, height:5, borderRadius:'50%', background: warn ? '#C25A00' : ACCENT }} />{L(it, lang)}</div>)}
        {b.foot && <div style={{ fontSize:12, color:MUTED2, lineHeight:1.55, marginTop:8 }}>{L(b.foot, lang)}</div>}
      </div>
    )
  }
  return null
}

export default function Handbook() {
  const navigate = useNavigate()
  const [lang, setLang] = useState('en')
  const [ready, setReady] = useState(false)
  const [active, setActive] = useState(1)   // active section n, or 'contacts'

  useEffect(() => { (async () => {
    let { data:{ session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    setReady(true)
  })() }, [])

  if (!ready) return <Layout pageKey="people" pageTitle="Handbook"><div className="people-app" /></Layout>

  return (
    <Layout pageKey="people" pageTitle="Handbook">
      <div className="people-app" style={{ background:BG }}>
        {/* cover */}
        <div style={{ background:`linear-gradient(135deg, ${INK} 0%, #12305a 100%)`, borderRadius:16, padding:'30px 32px', color:'#fff', marginBottom:16 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, flexWrap:'wrap' }}>
            <div>
              <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', color:'#9DB8E8' }}>{HB_META.company.toUpperCase()} · VERSION {HB_META.version}</div>
              <h1 style={{ fontSize:32, fontWeight:700, margin:'6px 0 8px', letterSpacing:'-0.02em' }}>{L(HB_META.title, lang)}</h1>
              <div style={{ fontSize:13.5, color:'#C7D6F0', lineHeight:1.55, maxWidth:520 }}>{L(HB_META.tagline, lang)}</div>
            </div>
            <div style={{ display:'inline-flex', gap:3, padding:4, background:'rgba(255,255,255,0.12)', borderRadius:10 }}>
              {LANGS.map(([k,l]) => (
                <button key={k} onClick={()=>setLang(k)} style={{ border:0, cursor:'pointer', borderRadius:7, padding:'7px 14px', fontSize:12.5, fontWeight:600, fontFamily:'inherit', color: lang===k ? INK : '#fff', background: lang===k ? '#fff' : 'transparent' }}>{l}</button>
              ))}
            </div>
          </div>
          <div style={{ fontSize:11.5, color:'#8FA9D6', marginTop:14 }}>Issued · {L(HB_META.issued, lang)} · {L(HB_META.note, lang)}</div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'240px 1fr', gap:16, alignItems:'start' }} className="hb-grid">
          {/* TOC */}
          <div className="acard hb-toc" style={{ padding:'14px 8px', position:'sticky', top:12, maxHeight:'calc(100vh - 90px)', overflowY:'auto' }}>
            {HB_PARTS.map(p => (
              <div key={p.id} style={{ marginBottom:8 }}>
                <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase', color:MUTED2, padding:'6px 10px' }}>{p.id} · {L(p.title, lang)}</div>
                {HB_SECTIONS.filter(s => s.part === p.id).map(s => (
                  <button key={s.n} onClick={()=>setActive(s.n)} style={{ display:'block', width:'100%', textAlign:'left', border:0, cursor:'pointer', fontSize:12.5, color: active===s.n ? ACCENT : '#374151', fontWeight: active===s.n ? 600 : 400, background: active===s.n ? '#EAF2FE' : 'none', padding:'6px 10px', borderRadius:7, lineHeight:1.35, fontFamily:'inherit' }}>
                    <b style={{ color:ACCENT, marginRight:5 }}>{s.n}</b>{L(s.title, lang)}
                  </button>
                ))}
              </div>
            ))}
            <button onClick={()=>setActive('contacts')} style={{ display:'block', width:'100%', textAlign:'left', border:0, cursor:'pointer', fontSize:12.5, fontWeight:600, color: active==='contacts' ? ACCENT : INK, background: active==='contacts' ? '#EAF2FE' : 'none', padding:'8px 10px', borderRadius:7, fontFamily:'inherit' }}>Important Contacts</button>
          </div>

          {/* content — only the active section */}
          <div style={{ minWidth:0 }}>
            {active === 'contacts' ? (
              <div className="acard" style={{ padding:'22px 26px' }}>
                <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:12, borderBottom:`2px solid ${ACCENT}`, paddingBottom:12 }}>
                  <h2 style={{ fontSize:19, fontWeight:600, color:INK, margin:0 }}>Important Contacts</h2>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }} className="hb-contacts">
                  {HB_CONTACTS.map((c,i) => (
                    <div key={i} style={{ border:`1px solid ${LINE}`, borderRadius:10, overflow:'hidden' }}>
                      <div style={{ background:INK, color:'#fff', padding:'8px 13px', fontSize:12.5, fontWeight:600 }}>{c.name}</div>
                      <div style={{ padding:'11px 13px', fontSize:12.5, color:MUTED, lineHeight:1.55 }}>{c.desc}{c.detail && <div style={{ color:ACCENT, fontWeight:600, marginTop:5 }}>{c.detail}</div>}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize:11.5, color:MUTED2, marginTop:14, textAlign:'center' }}>SSC Control Pvt. Ltd. · Employee Guide · Version {HB_META.version} · {L(HB_META.issued, lang)} · 1966 — 2026 · 60 Years</div>
              </div>
            ) : (() => {
              const s = HB_SECTIONS.find(x => x.n === active) || HB_SECTIONS[0]
              const part = HB_PARTS.find(p => p.id === s.part)
              const idx = HB_SECTIONS.findIndex(x => x.n === s.n)
              const prev = HB_SECTIONS[idx-1], next = HB_SECTIONS[idx+1]
              return (
                <>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.08em', color:MUTED2, marginBottom:8, textTransform:'uppercase' }}>PART {part?.id} · {L(part?.title, lang)}</div>
                  <div className="acard" style={{ padding:'22px 26px' }}>
                    <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:12, borderBottom:`2px solid ${ACCENT}`, paddingBottom:12 }}>
                      <span style={{ fontSize:24, fontWeight:700, color:ACCENT }}>{s.n}</span>
                      <h2 style={{ fontSize:19, fontWeight:600, color:INK, margin:0 }}>{L(s.title, lang)}</h2>
                    </div>
                    {s.body.map((b,i) => <Block key={i} b={b} lang={lang} />)}
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', gap:10, marginTop:14 }}>
                    {prev ? <button onClick={()=>setActive(prev.n)} className="btn btn-neutral btn-sm" style={{ maxWidth:'48%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>← {prev.n}. {L(prev.title, lang)}</button> : <span />}
                    {next ? <button onClick={()=>setActive(next.n)} className="btn btn-neutral btn-sm" style={{ maxWidth:'48%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{next.n}. {L(next.title, lang)} →</button> : <span />}
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      </div>
      <style>{`@media (max-width:860px){ .hb-grid{ grid-template-columns:1fr !important; } .hb-toc{ display:none !important; } .hb-contacts{ grid-template-columns:1fr !important; } }`}</style>
    </Layout>
  )
}
