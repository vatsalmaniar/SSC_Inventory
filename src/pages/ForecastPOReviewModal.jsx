import { useState, useEffect } from 'react'

export default function ForecastPOReviewModal({ open, onClose, onNext, seedItems, brand, qLabel }) {
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (open && seedItems?.length) {
      setRows(seedItems.map(s => ({ ...s, pendingQty: s.pendingQty || 0, include: true })))
    }
  }, [open, seedItems])

  if (!open) return null

  function setPending(idx, val) {
    setRows(prev => prev.map((r, i) => i !== idx ? r : { ...r, pendingQty: Math.max(0, parseInt(val) || 0) }))
  }

  function toggleInclude(idx) {
    setRows(prev => prev.map((r, i) => i !== idx ? r : { ...r, include: !r.include }))
  }

  function toggleAll(checked) {
    setRows(prev => prev.map(r => ({ ...r, include: checked })))
  }

  const included    = rows.filter(r => r.include)
  const allChecked  = rows.length > 0 && rows.every(r => r.include)
  const someChecked = rows.some(r => r.include)

  function handleNext() {
    const items = included
      .map(r => ({ ...r, netQty: Math.max(0, r.poQty - r.pendingQty) }))
      .filter(r => r.netQty > 0)
    if (!items.length) return
    onNext(items)
  }

  const TH = { padding:'10px 14px', fontSize:11, fontWeight:600, color:'var(--gray-500)', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)', whiteSpace:'nowrap', textAlign:'right' }
  const TD = { padding:'10px 14px', fontSize:13, borderBottom:'1px solid var(--gray-100)', verticalAlign:'middle', textAlign:'right', fontFamily:'var(--mono)' }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:200, overflowY:'auto', padding:'32px 16px' }}>
      <div style={{ background:'white', width:'100%', maxWidth:760, margin:'0 auto', borderRadius:12, boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>

        {/* Header */}
        <div style={{ padding:'20px 24px 18px', borderBottom:'1px solid var(--gray-100)' }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontSize:16, fontWeight:700, color:'var(--gray-900)' }}>Review Before Creating PO</div>
              <div style={{ fontSize:12, color:'var(--gray-500)', marginTop:3 }}>
                <span style={{ fontWeight:600, color:'var(--gray-700)' }}>{brand}</span> · {qLabel} ·
                {' '}{rows.length} items below reorder level
              </div>
            </div>
            <button onClick={onClose} style={{ background:'none', border:'1px solid var(--gray-200)', borderRadius:7, padding:'6px 12px', cursor:'pointer', color:'var(--gray-500)', fontSize:12, fontWeight:500, flexShrink:0 }}>
              ✕ Cancel
            </button>
          </div>

          {/* Legend */}
          <div style={{ display:'flex', gap:20, marginTop:14 }}>
            {[
              ['var(--gray-700)', 'Formula Qty', 'Replenishment days × daily rate (from forecast)'],
              ['#b45309', 'Pending PO', 'Qty already on open POs — edit if needed'],
              ['#1d4ed8', 'Net Order Qty', 'Formula − Pending · this goes into the PO'],
            ].map(([color, label, desc]) => (
              <div key={label} style={{ display:'flex', alignItems:'flex-start', gap:6 }}>
                <div style={{ width:3, height:32, background:color, borderRadius:2, flexShrink:0, marginTop:2 }} />
                <div>
                  <div style={{ fontSize:11, fontWeight:600, color }}>{label}</div>
                  <div style={{ fontSize:10, color:'var(--gray-400)', marginTop:1, lineHeight:1.3 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...TH, textAlign:'center', width:40 }}>
                  <input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = !allChecked && someChecked }}
                    onChange={e => toggleAll(e.target.checked)}
                    style={{ width:14, height:14, cursor:'pointer' }} />
                </th>
                <th style={{ ...TH, textAlign:'left', minWidth:160 }}>Item</th>
                <th style={{ ...TH }}>Formula Qty</th>
                <th style={{ ...TH, color:'#b45309', background:'#fffbeb', minWidth:120 }}>
                  Pending PO
                  <div style={{ fontSize:9, fontWeight:400, color:'#d97706', textTransform:'none', letterSpacing:0, marginTop:1 }}>edit if needed</div>
                </th>
                <th style={{ ...TH, color:'#1d4ed8', background:'#eff6ff', minWidth:110 }}>Net Order Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const net = Math.max(0, row.poQty - row.pendingQty)
                const rowBg = !row.include ? '#fafafa' : net === 0 ? '#fff8f8' : 'white'
                return (
                  <tr key={row.item_code} style={{ background:rowBg, opacity: row.include ? 1 : 0.45 }}>
                    <td style={{ ...TD, textAlign:'center', fontFamily:'inherit' }}>
                      <input type="checkbox" checked={row.include} onChange={() => toggleInclude(idx)}
                        style={{ width:14, height:14, cursor:'pointer' }} />
                    </td>
                    <td style={{ ...TD, textAlign:'left', fontFamily:'inherit' }}>
                      {row.itemNo && (
                        <span style={{ display:'inline-block', background:'#ede9fe', color:'#5b21b6', fontSize:10, fontWeight:600, padding:'1px 6px', borderRadius:4, marginBottom:3, fontFamily:'var(--mono)' }}>
                          {row.itemNo}
                        </span>
                      )}
                      <div style={{ fontSize:13, fontWeight:600, color:'var(--gray-900)', fontFamily:'var(--mono)' }}>{row.item_code}</div>
                    </td>
                    <td style={{ ...TD, color:'var(--gray-600)' }}>{row.poQty}</td>
                    <td style={{ ...TD, padding:'8px 14px', background: row.include ? (row.pendingQty > 0 ? '#fffbeb' : 'transparent') : 'transparent' }}>
                      <input
                        type="number" min="0" value={row.pendingQty}
                        onChange={e => setPending(idx, e.target.value)}
                        disabled={!row.include}
                        style={{
                          width:80, padding:'5px 8px', textAlign:'right',
                          border: row.pendingQty > 0 ? '1.5px solid #f59e0b' : '1.5px solid var(--gray-200)',
                          borderRadius:6, fontFamily:'var(--mono)', fontSize:13,
                          background: row.pendingQty > 0 ? '#fffbeb' : 'white',
                          color: row.pendingQty > 0 ? '#92400e' : 'var(--gray-700)',
                          fontWeight: row.pendingQty > 0 ? 600 : 400,
                          outline:'none', cursor: row.include ? 'text' : 'default',
                        }}
                      />
                    </td>
                    <td style={{ ...TD, background: row.include ? '#eff6ff' : 'transparent' }}>
                      {net > 0
                        ? <span style={{ fontSize:15, fontWeight:700, color:'#1d4ed8' }}>{net}</span>
                        : <span style={{ fontSize:12, color:'#dc2626', fontWeight:500 }}>0 — fully covered</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding:'16px 24px 20px', borderTop:'1px solid var(--gray-100)', display:'flex', alignItems:'center', gap:16 }}>
          {/* Summary */}
          <div style={{ flex:1, display:'flex', gap:24 }}>
            <div style={{ fontSize:12, color:'var(--gray-500)' }}>
              <span style={{ fontWeight:600, color:'var(--gray-800)' }}>{included.length}</span> of {rows.length} items selected
            </div>
            <div style={{ fontSize:12, color:'var(--gray-500)' }}>
              Net total: <span style={{ fontWeight:700, color:'#1d4ed8', fontFamily:'var(--mono)' }}>
                {included.reduce((s, r) => s + Math.max(0, r.poQty - r.pendingQty), 0)} units
              </span>
            </div>
            {included.some(r => Math.max(0, r.poQty - r.pendingQty) === 0) && (
              <div style={{ fontSize:11, color:'#b45309', background:'#fffbeb', padding:'3px 10px', borderRadius:6, border:'1px solid #fde68a' }}>
                Some items are fully covered — they will be skipped
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ padding:'9px 18px', border:'1.5px solid var(--gray-200)', borderRadius:7, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', color:'var(--gray-600)' }}>
            Cancel
          </button>
          <button
            onClick={handleNext}
            disabled={!included.some(r => Math.max(0, r.poQty - r.pendingQty) > 0)}
            style={{
              padding:'9px 20px', background:'var(--blue-700)', color:'white', border:'none', borderRadius:7,
              fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:8,
              opacity: included.some(r => Math.max(0, r.poQty - r.pendingQty) > 0) ? 1 : 0.4,
            }}>
            Next: Create PO
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </div>
      </div>
    </div>
  )
}
