// Special Price Agreements — the list and the drawer, shared by Item 360,
// Customer 360 and Vendor 360 so there is one implementation, not three.
//
// The LIST shows one line per DOCUMENT, the way the Orders list shows one line
// per order. A 23-item agreement is one row, not 23 — the detail belongs in the
// drawer, which is what you open when you actually want it.
//
// `side` decides which leg is shown and is the whole point of the component:
//   'purchase'  Vendor 360   — what WE pay. A vendor must never be shown what
//                             the customer pays, and margin is nobody's business
//                             but ours.
//   'sales'     Customer 360 — what THEY pay. No purchase price, no margin: the
//                             page is used by sales in front of the customer.
//   'both'      Item 360     — buy, sell and margin together. That tab is
//                             RLS-gated to admin/management/ops/accounts.

import { useState, useEffect } from 'react'
import { sb } from '../lib/supabase'
import { fmtMoneyFull } from '../lib/fmt'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import Loading from '../components/Loading'
import '../styles/drawer.css'
import '../styles/orders-redesign.css'

const COLS = 'minmax(0,1.5fr) minmax(0,1.1fr) 150px 90px 130px'

function statusPill(s) {
  if (s === 'approved')   return { label: 'Approved',   color: '#166534' }
  if (s === 'draft')      return { label: 'Draft',      color: '#b45309' }
  if (s === 'superseded') return { label: 'Superseded', color: '#94A3B8' }
  if (s === 'cancelled')  return { label: 'Cancelled',  color: '#b91c1c' }
  return { label: s || '—', color: '#94A3B8' }
}

/** One row per agreement. Click opens the drawer. */
export function SpaList({ agreements, side, onOpen, emptyText }) {
  if (!agreements.length) {
    return <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>{emptyText}</div>
  }
  return (
    // .ol-* rows live under .orders-app, which also carries page chrome —
    // background and padding are neutralised so only the row styling applies.
    <div className="orders-app" style={{ background: 'transparent', padding: 0 }}>
      <div className="ol-wrap" style={{ marginTop: 0 }}>
        <div className="ol-row ol-head" style={{ gridTemplateColumns: COLS }}>
          <div>Agreement</div>
          <div>Title</div>
          <div>Valid</div>
          <div className="num">Items</div>
          <div>Status</div>
        </div>
        <div className="ol-table">
          {agreements.map(a => {
            const st = statusPill(a.status)
            return (
              <div key={a.id} className="ol-row ol-data" style={{ gridTemplateColumns: COLS }}
                   onClick={() => onOpen(a)}>
                <div className="ol-cell">
                  <div className="ol-num" style={{ fontFamily: 'var(--mono)' }}>{a.spa_no}</div>
                  {a.reference && <div style={{ fontSize: 10.5, color: 'var(--o-muted-2)' }}>{a.reference}</div>}
                </div>
                <div className="ol-cell ol-cust">{a.title}</div>
                <div className="ol-cell" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {a.valid_from} → {a.valid_to || 'open'}
                </div>
                <div className="ol-cell num" style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>
                  {a.rate_count ?? '—'}
                </div>
                <div className="ol-cell ol-status-cell">
                  <span className="ol-status-pill" style={{ '--stage-color': st.color }}>
                    <span className="ol-status-dot"/>{st.label}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * The agreement itself: its terms, every rate on it, and every purchase order
 * that priced from it. `highlightItem` bolds one row — used from Item 360 so you
 * can see this item's rate in the context of the whole deal.
 */
export function SpaDrawer({ spa, side = 'both', highlightItem, customerId, onApproved, onClose }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  const [approving, setApproving] = useState(false)
  const [role, setRole] = useState('')

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data: { user } } = await sb.auth.getUser()
      if (!user || !live) return
      const { data } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle()
      if (live) setRole(data?.role || '')
    })()
    return () => { live = false }
  }, [])

  // Approving a price agreement commits what we pay, or charge, across every
  // rate on it. Same authority as approving a purchase order.
  const canApprove = ['admin', 'management'].includes(role)

  async function doApprove() {
    if (approving) return
    setApproving(true)
    const { error } = await sb.rpc('approve_spa', { p_spa_id: spa.id })
    setApproving(false)
    if (error) { toast(friendlyError(error, 'Could not approve this agreement.')); return }
    toast(`${spa.spa_no} approved — its rates are now live`, 'success')
    onApproved?.()
    onClose?.()
  }

  useEffect(() => {
    if (!spa?.id) return
    let live = true
    setLoading(true); setDetail(null)
    ;(async () => {
      // Opened from a customer's page, show that customer's rates only. One
      // vendor agreement can hold rates for dozens of customers, and listing
      // all 143 of them under Milacron answers a question nobody asked.
      let rateQ = sb.from('item_prices')
        .select('item_code,price_type,amount,min_qty,valid_from,valid_to,price_status,customer_id,customers(customer_name)')
        .eq('spa_id', spa.id).order('item_code')
      if (customerId) rateQ = rateQ.eq('customer_id', customerId)
      const [ratesRes, poRes] = await Promise.all([
        rateQ,
        // Where it has actually been used. Read from po_items.spa_no, which is
        // STAMPED at pricing time, so a superseded agreement still shows the
        // documents it priced.
        sb.from('po_items')
          .select('item_code,qty,unit_price,po_id,purchase_orders(po_number,po_date,status)')
          .eq('spa_no', spa.spa_no).limit(200),
      ])
      if (!live) return
      // Keyed on item + CUSTOMER + quantity break, not on item alone. Keying on
      // the item made every rate after the first for that item overwrite the one
      // before it: SSC/SPA0004 holds 143 rates over 129 items, so 14 were
      // silently invisible. ACTUATOR AZM 17/170-B5 showed Perfect Engineering's
      // Rs 100 while Milacron's Rs 70 was hidden underneath it — a buyer reading
      // the agreement would have seen a rate that was not the one they'd get.
      const byRate = new Map()
      for (const r of (ratesRes.data || [])) {
        const k = `${r.item_code}|${r.customer_id || ''}|${r.min_qty || 1}`
        if (!byRate.has(k)) byRate.set(k, {
          item_code: r.item_code,
          customer_name: r.customers?.customer_name || null,
          min_qty: r.min_qty || 1,
        })
        byRate.get(k)[r.price_type === 'PURCHASE' ? 'buy' : 'sell'] = r
      }
      const items = [...byRate.values()].sort((a, b) =>
        a.item_code.localeCompare(b.item_code) ||
        (a.customer_name || '').localeCompare(b.customer_name || ''))
      setDetail({ items, usedOn: poRes.data || [] })
      setLoading(false)
    })()
    return () => { live = false }
  }, [spa?.id, spa?.spa_no, customerId])

  if (!spa) return null
  const st = statusPill(spa.status)
  const showBuy  = side === 'both' || side === 'purchase'
  const showSell = side === 'both' || side === 'sales'
  const showMargin = side === 'both'
  // Only worth a column when the agreement actually varies by customer, and
  // never on a customer's own page where every row is theirs by definition.
  const showCustomer = !customerId && (detail?.items || []).some(r => r.customer_name)

  return (
    <div className="od-drawer-scrim" onClick={onClose}>
      <div className="od-drawer" onClick={e => e.stopPropagation()}>
        <div className="od-drawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="od-drawer-eyebrow">Special Price Agreement</div>
            <div className="od-drawer-title" style={{ fontFamily: 'var(--mono)' }}>{spa.spa_no}</div>
            <div className="od-drawer-sub">{spa.title}</div>
          </div>
          <button className="od-drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="od-drawer-body">
          <div style={{ display: 'grid', gridTemplateColumns: '128px 1fr', rowGap: 9, columnGap: 12, fontSize: 12.5 }}>
            <span style={{ color: 'var(--gray-500)' }}>Agreement with</span>
            <span>{spa.counterparty_type === 'CUSTOMER' ? 'Customer' : 'Vendor'}</span>
            <span style={{ color: 'var(--gray-500)' }}>Status</span>
            <span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                background: spa.status === 'approved' ? '#f0fdf4' : '#fffbeb', color: st.color }}>
                {st.label}
              </span>
              {spa.status !== 'approved' && (
                <span style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--gray-500)' }}>
                  rates are not applied until the agreement is approved
                </span>
              )}
              {/* Until now nothing in the app could approve an agreement — it
                  had to be done from the database, which left approved_by empty
                  on the earlier ones. approve_spa() flips the agreement and every
                  pending rate on it in one transaction, and records who did it. */}
              {spa.status === 'draft' && canApprove && (
                <button onClick={doApprove} disabled={approving}
                  style={{ marginLeft: 10, fontSize: 11.5, fontWeight: 600, padding: '4px 12px',
                           borderRadius: 6, border: '1px solid #16a34a', background: approving ? '#f1f5f9' : '#16a34a',
                           color: approving ? 'var(--gray-500)' : '#fff', cursor: approving ? 'default' : 'pointer' }}>
                  {approving ? 'Approving…' : 'Approve agreement'}
                </button>
              )}
            </span>
            <span style={{ color: 'var(--gray-500)' }}>Valid</span>
            <span>{spa.valid_from} → {spa.valid_to || 'open'}</span>
            {spa.reference && (<><span style={{ color: 'var(--gray-500)' }}>Reference</span><span>{spa.reference}</span></>)}
            {spa.source_file && (<><span style={{ color: 'var(--gray-500)' }}>Source</span><span style={{ wordBreak: 'break-all' }}>{spa.source_file}</span></>)}
          </div>

          {spa.notes && side === 'both' && (
            <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--gray-500)', lineHeight: 1.55,
                          background: 'var(--gray-50)', padding: 10, borderRadius: 8 }}>
              {spa.notes}
            </div>
          )}

          {loading ? <div style={{ marginTop: 18 }}><Loading /></div> : detail && (
            <>
              <div style={{ marginTop: 22, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                            textTransform: 'uppercase', color: 'var(--gray-500)' }}>
                Items covered ({detail.items.length})
              </div>
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table className="od-items-table">
                  <thead><tr>
                    <th>Item</th>
                    {/* A rate negotiated FOR a named end customer is meaningless
                        without saying who: the same part is Rs 70 for one and
                        Rs 100 for another. Hidden when no rate on the agreement
                        is customer-scoped, and when the drawer is already
                        filtered to one customer's page. */}
                    {showCustomer && <th>Customer</th>}
                    <th style={{ textAlign: 'right' }}>From qty</th>
                    {showBuy  && <th style={{ textAlign: 'right' }}>We buy at</th>}
                    {showSell && <th style={{ textAlign: 'right' }}>{side === 'sales' ? 'Your price' : 'We sell at'}</th>}
                    {showMargin && <th style={{ textAlign: 'right' }}>Margin</th>}
                  </tr></thead>
                  <tbody>
                    {detail.items.map(r => {
                      const m = (r.buy && r.sell)
                        ? Math.round((1 - Number(r.buy.amount) / Number(r.sell.amount)) * 1000) / 10 : null
                      const here = r.item_code === highlightItem
                      return (
                        <tr key={`${r.item_code}|${r.customer_name || ''}|${r.min_qty}`}
                            style={here ? { background: '#eff6ff' } : undefined}>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: here ? 600 : 400 }}>{r.item_code}</td>
                          {showCustomer && <td style={{ fontSize: 11.5, maxWidth: 190 }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                 title={r.customer_name || ''}>
                              {r.customer_name || <span style={{ color: 'var(--gray-400)' }}>any customer</span>}
                            </div>
                          </td>}
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                            {r.min_qty}
                          </td>
                          {showBuy && <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                            {r.buy ? fmtMoneyFull(r.buy.amount) : '—'}</td>}
                          {showSell && <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                            {r.sell ? fmtMoneyFull(r.sell.amount) : '—'}</td>}
                          {showMargin && <td style={{ textAlign: 'right', fontWeight: 600,
                            color: m == null ? 'var(--gray-300)' : m < 0 ? '#b91c1c' : '#166534' }}>
                            {m == null ? '—' : m + '%'}</td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Only meaningful where we are the buyer. A customer's agreement
                  is not "used on" a purchase order. */}
              {side !== 'sales' && (
                <>
                  <div style={{ marginTop: 22, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                                textTransform: 'uppercase', color: 'var(--gray-500)' }}>
                    Used on ({detail.usedOn.length})
                  </div>
                  {!detail.usedOn.length ? (
                    <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 8, fontStyle: 'italic' }}>
                      No purchase order has priced from this agreement yet.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto', marginTop: 8 }}>
                      <table className="od-items-table">
                        <thead><tr>
                          <th>PO</th><th>Date</th><th>Item</th>
                          <th style={{ textAlign: 'right' }}>Qty</th>
                          <th style={{ textAlign: 'right' }}>Rate</th>
                        </tr></thead>
                        <tbody>
                          {detail.usedOn.map((u, i) => (
                            <tr key={i}>
                              <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: '#1a73e8' }}>{u.purchase_orders?.po_number || '—'}</td>
                              <td style={{ fontSize: 11.5 }}>{u.purchase_orders?.po_date || '—'}</td>
                              <td style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{u.item_code}</td>
                              <td style={{ textAlign: 'right' }}>{u.qty}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11.5 }}>{fmtMoneyFull(u.unit_price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Agreements for one counterparty, newest first, with their rate counts. */
export async function fetchAgreements({ customerId, vendorId }) {
  let q = sb.from('special_price_agreements')
    .select('id,spa_no,title,counterparty_type,reference,valid_from,valid_to,status,source_file,notes,item_prices(count)')
    .order('valid_from', { ascending: false })

  if (customerId) {
    // Which customer a RATE belongs to lives on the price row, not on the
    // agreement header. A vendor agreement can carry rates negotiated for
    // several named customers — SSC/SPA0004 holds 143 Schmersal rates across
    // 36 of them — and filtering on the header's customer_id made every one of
    // those invisible on Customer 360 even though the rates were right there.
    const { data: rows } = await sb.from('item_prices')
      .select('spa_id').eq('customer_id', customerId).not('spa_id', 'is', null)
    const viaRates = [...new Set((rows || []).map(r => r.spa_id))]
    q = viaRates.length
      ? q.or(`customer_id.eq.${customerId},id.in.(${viaRates.join(',')})`)
      : q.eq('customer_id', customerId)
  } else {
    q = q.eq('vendor_id', vendorId)
  }

  const { data, error } = await q
  if (error) { console.error('fetchAgreements:', error); return [] }
  return (data || []).map(a => ({ ...a, rate_count: a.item_prices?.[0]?.count ?? null }))
}
