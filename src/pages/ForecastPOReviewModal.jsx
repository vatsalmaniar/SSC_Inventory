import { useState, useEffect } from 'react'

export default function ForecastPOReviewModal({ open, onClose, onNext, seedItems, brand, qLabel }) {
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (open && seedItems?.length)
      setRows(seedItems.map(s => ({ ...s, pendingQty: s.pendingQty || 0, include: true })))
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

  const included   = rows.filter(r => r.include)
  const allChecked = rows.length > 0 && rows.every(r => r.include)
  const someChecked = rows.some(r => r.include)
  const canNext    = included.some(r => Math.max(0, r.poQty - r.pendingQty) > 0)

  function handleNext() {
    const items = included
      .map(r => ({ ...r, netQty: Math.max(0, r.poQty - r.pendingQty) }))
      .filter(r => r.netQty > 0)
    if (items.length) onNext(items)
  }

  const TH = { padding:'10px 14px', fontSize:11, fontWeight:600, color:'var(--gray-500)', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)', whiteSpace:'nowrap', textAlign:'right' }
  const TD = { padding:'11px 14px', fontSize:13, borderBottom:'1px solid var(--gray-100)', verticalAlign:'middle', textAlign:'right', fontFamily:'var(--mono)' }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:200, overflowY:'auto', padding:'40px 16px' }}>
      <div style={{ background:'white', width:'100%', maxWidth:680, margin:'0 auto', borderRadius:12, boxShadow:'0 16px 48px rgba(0,0,0,0.18)' }}>

        {/* Header */}
        <div style={{ padding:'20px 24px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'var(--gray-900)' }}>{brand} — PO Review</div>
            <div style={{ fontSize:12, color:'var(--gray-400)', marginTop:2 }}>{qLabel} · {rows.length} items need reorder</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--gray-400)', fontSize:18, lineHeight:1, padding:'4px 8px' }}>✕</button>
        </div>

        {/* Table */}
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign:'center', width:44 }}>
                <input type="checkbox" checked={allChecked}
                  ref={el => { if (el) el.indeterminate = !allChecked && someChecked }}
                  onChange={e => toggleAll(e.target.checked)}
                  style={{ width:14, height:14, cursor:'pointer' }} />
              </th>
              <th style={{ ...TH, textAlign:'left' }}>Item Code</th>
              <th style={{ ...TH }}>Formula Qty</th>
              <th style={{ ...TH }}>Pending PO</th>
              <th style={{ ...TH, color:'var(--gray-700)' }}>Order Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const net = Math.max(0, row.poQty - row.pendingQty)
              return (
                <tr key={row.item_code} style={{ opacity: row.include ? 1 : 0.4 }}>
                  <td style={{ ...TD, textAlign:'center', fontFamily:'inherit' }}>
                    <input type="checkbox" checked={row.include} onChange={() => toggleInclude(idx)}
                      style={{ width:14, height:14, cursor:'pointer' }} />
                  </td>
                  <td style={{ ...TD, textAlign:'left', fontFamily:'inherit' }}>
                    {row.itemNo && (
                      <div style={{ fontSize:10, color:'var(--gray-400)', fontFamily:'var(--mono)', marginBottom:1 }}>{row.itemNo}</div>
                    )}
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--gray-900)', fontFamily:'var(--mono)' }}>{row.item_code}</div>
                  </td>
                  <td style={{ ...TD, color:'var(--gray-400)' }}>{row.poQty}</td>
                  <td style={{ ...TD, padding:'8px 14px' }}>
                    <input
                      type="number" min="0" value={row.pendingQty}
                      onChange={e => setPending(idx, e.target.value)}
                      disabled={!row.include}
                      style={{
                        width:72, padding:'5px 8px', textAlign:'right',
                        border:'1.5px solid var(--gray-200)', borderRadius:6,
                        fontFamily:'var(--mono)', fontSize:13, outline:'none',
                        background: row.pendingQty > 0 ? '#fffbeb' : 'white',
                        color: row.pendingQty > 0 ? '#92400e' : 'var(--gray-700)',
                        cursor: row.include ? 'text' : 'default',
                      }}
                    />
                  </td>
                  <td style={{ ...TD }}>
                    {net > 0
                      ? <span style={{ fontWeight:700, color:'var(--gray-900)' }}>{net}</span>
                      : <span style={{ color:'var(--gray-300)' }}>—</span>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Footer */}
        <div style={{ padding:'14px 24px 18px', borderTop:'1px solid var(--gray-100)', display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ flex:1, fontSize:12, color:'var(--gray-400)' }}>
            {included.length} of {rows.length} selected &nbsp;·&nbsp;
            <span style={{ fontFamily:'var(--mono)', color:'var(--gray-600)', fontWeight:600 }}>
              {included.reduce((s, r) => s + Math.max(0, r.poQty - r.pendingQty), 0)} units
            </span> net total
          </div>
          <button onClick={onClose} style={{ padding:'8px 16px', border:'1.5px solid var(--gray-200)', borderRadius:7, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', color:'var(--gray-600)' }}>
            Cancel
          </button>
          <button onClick={handleNext} disabled={!canNext}
            style={{ padding:'8px 18px', background: canNext ? 'var(--blue-700)' : 'var(--gray-200)', color: canNext ? 'white' : 'var(--gray-400)', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor: canNext ? 'pointer' : 'default', display:'flex', alignItems:'center', gap:7 }}>
            Next: Create PO
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </div>
      </div>
    </div>
  )
}
