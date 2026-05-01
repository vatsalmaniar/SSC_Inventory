import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import Typeahead from '../components/Typeahead'
import '../styles/neworder.css'
import { friendlyError } from '../lib/errorMsg'

const FC_OPTIONS = ['Kaveri', 'Godawari']

function emptyItem() { return { item_code: '', _itemText: '', _description: '', qty: '' } }

export default function NewStockTransfer() {
  const navigate = useNavigate()
  const saveGuard = useRef(false)

  const [userRole, setUserRole]   = useState('')
  const [userName, setUserName]   = useState('')
  const [userId, setUserId]       = useState('')
  const [saving, setSaving]       = useState(false)

  const [sourceFc, setSourceFc]           = useState('')
  const [destinationFc, setDestinationFc] = useState('')
  const [transferDate, setTransferDate]   = useState(new Date().toISOString().slice(0, 10))
  const [vehicleNo, setVehicleNo]         = useState('')
  const [transporter, setTransporter]     = useState('')
  const [notes, setNotes]                 = useState('')
  const [items, setItems]                 = useState([emptyItem()])

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    if (!['ops','admin','management','fc_kaveri','fc_godawari'].includes(role)) { navigate('/dashboard'); return }
    setUserRole(role); setUserName(profile?.name || ''); setUserId(session.user.id)
    if (role === 'fc_kaveri')   setSourceFc('Kaveri')
    if (role === 'fc_godawari') setSourceFc('Godawari')
  }

  async function fetchItems(q) {
    if (!q || q.length < 2) return []
    const { data } = await sb.from('items')
      .select('item_code,item_no,brand,category')
      .or(`item_code.ilike.%${q}%,item_no.ilike.%${q}%`)
      .eq('is_active', true)
      .limit(20)
    return data || []
  }

  function addRow()       { setItems(prev => [...prev, emptyItem()]) }
  function removeRow(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }
  function updateRow(idx, field, val) {
    setItems(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }
  function selectItem(idx, item) {
    const desc = [item.item_no, item.brand, item.category].filter(Boolean).join(' · ')
    setItems(prev => prev.map((r, i) => i === idx ? { ...r, item_code: item.item_code, _itemText: item.item_code, _description: desc } : r))
  }

  function validate() {
    if (!sourceFc) return 'Select source FC'
    if (!destinationFc) return 'Select destination FC'
    if (sourceFc === destinationFc) return 'Source and destination FC must differ'
    const validItems = items.filter(i => i.item_code && parseInt(i.qty) > 0)
    if (!validItems.length) return 'Add at least one item with qty > 0'
    return null
  }

  async function save() {
    if (saveGuard.current) return
    const err = validate()
    if (err) { toast(err); return }

    saveGuard.current = true; setSaving(true)
    const validItems = items.filter(i => i.item_code && parseInt(i.qty) > 0)

    const { data: transfer, error: tErr } = await sb.from('stock_transfers').insert({
      source_fc: sourceFc,
      destination_fc: destinationFc,
      status: 'draft',
      vehicle_no: vehicleNo || null,
      transporter: transporter || null,
      notes: notes || null,
      created_by: userId,
      created_by_name: userName,
    }).select().single()

    if (tErr || !transfer) {
      toast(friendlyError(tErr) || 'Failed to create transfer')
      saveGuard.current = false; setSaving(false); return
    }

    const { error: iErr } = await sb.from('stock_transfer_items').insert(
      validItems.map((it, idx) => ({
        transfer_id: transfer.id,
        sr_no: idx + 1,
        item_code: it.item_code,
        qty: parseInt(it.qty),
        received_qty: 0,
      }))
    )

    if (iErr) {
      toast(friendlyError(iErr) || 'Failed to save items')
      await sb.from('stock_transfers').delete().eq('id', transfer.id)
      saveGuard.current = false; setSaving(false); return
    }

    await sb.from('stock_transfer_activity').insert({
      transfer_id: transfer.id, action: 'created', actor_name: userName, actor_id: userId,
      note: `${sourceFc} → ${destinationFc} · ${validItems.length} item${validItems.length === 1 ? '' : 's'}`,
    })

    toast('Draft created · ' + transfer.transfer_number, 'success')
    navigate('/fc/transfers/' + transfer.id)
  }

  const fcLockedBySource = userRole === 'fc_kaveri' || userRole === 'fc_godawari'

  return (
    <Layout pageTitle="New Stock Transfer" pageKey="fc">
    <div className="no-page">
      <div className="no-body">
        <div className="no-page-title">New Stock Transfer</div>
        <div className="no-page-sub">Move stock between Kaveri & Godawari fulfilment centres.</div>

        {/* ── Transfer Details ── */}
        <div className="no-card">
          <div className="no-section-title">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <rect x="1" y="3" width="15" height="13" rx="1"/>
              <path d="M16 8h4l3 4v4h-7V8z"/>
              <circle cx="5.5" cy="18.5" r="1.5"/>
              <circle cx="18.5" cy="18.5" r="1.5"/>
            </svg>
            Transfer Details
          </div>
          <div className="no-row">
            <div className="no-field">
              <label>From FC <span className="req">*</span></label>
              <select value={sourceFc} onChange={e => setSourceFc(e.target.value)} disabled={fcLockedBySource}>
                <option value="">— Select —</option>
                {FC_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              {fcLockedBySource && (
                <div style={{ marginTop:6, padding:'6px 10px', background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:6, fontSize:11, color:'#0369a1' }}>
                  Auto-set to your fulfilment centre.
                </div>
              )}
            </div>
            <div className="no-field">
              <label>To FC <span className="req">*</span></label>
              <select value={destinationFc} onChange={e => setDestinationFc(e.target.value)}>
                <option value="">— Select —</option>
                {FC_OPTIONS.filter(f => f !== sourceFc).map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="no-field">
              <label>Transfer Date <span className="req">*</span></label>
              <input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} />
            </div>
          </div>
          <div className="no-row" style={{ marginTop: 8 }}>
            <div className="no-field">
              <label>Vehicle No</label>
              <input value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} placeholder="GJ-01-AB-1234" />
            </div>
            <div className="no-field">
              <label>Transporter</label>
              <input value={transporter} onChange={e => setTransporter(e.target.value)} placeholder="VRL Logistics" />
            </div>
            <div className="no-field"/>
          </div>
        </div>

        {/* ── Items ── */}
        <div className="no-card no-card-items">
          <div className="no-section-title">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
              <rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>
            </svg>
            Transfer Items
          </div>
          <div className="no-items-table-wrap">
            <table className="no-items-table">
              <thead>
                <tr>
                  <th className="col-sr">#</th>
                  <th style={{ minWidth: 240 }}>Item Code <span className="req">*</span></th>
                  <th>Description</th>
                  <th className="col-qty">Qty <span className="req">*</span></th>
                  <th className="col-del"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, idx) => (
                  <tr key={idx} className={row.item_code ? 'row-filled' : ''}>
                    <td className="col-sr">{idx + 1}</td>
                    <td>
                      <Typeahead
                        value={row._itemText}
                        onChange={v => { updateRow(idx, '_itemText', v); if (!v.trim()) { updateRow(idx, 'item_code', ''); updateRow(idx, '_description', '') } }}
                        onSelect={item => selectItem(idx, item)}
                        placeholder="Search item code..."
                        fetchFn={fetchItems}
                        strictSelect
                        renderItem={item => (
                          <div>
                            <span style={{ fontWeight: 600, fontFamily: 'var(--mono)', fontSize: 12 }}>{item.item_code}</span>
                            {item.item_no && <span style={{ color: 'var(--gray-400)', marginLeft: 8, fontSize: 11 }}>{item.item_no}</span>}
                            {item.brand && <span style={{ color: 'var(--gray-400)', marginLeft: 6, fontSize: 11 }}>· {item.brand}</span>}
                          </div>
                        )}
                      />
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>{row._description || '—'}</span>
                    </td>
                    <td className="col-qty">
                      <input type="number" value={row.qty} onChange={e => updateRow(idx, 'qty', e.target.value)} placeholder="0" min="1" />
                    </td>
                    <td className="col-del">
                      {items.length > 1 && (
                        <button className="del-row-btn" onClick={() => removeRow(idx)} title="Remove row">
                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="no-add-row-btn" onClick={addRow}>
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Row
          </button>
        </div>

        {/* ── Notes ── */}
        <div className="no-card">
          <div className="no-section-title">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Notes
          </div>
          <div className="no-row">
            <div className="no-field" style={{ flex: 1 }}>
              <label>Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about this transfer..." rows={3} style={{ resize: 'vertical' }} />
            </div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="no-card no-totals-card">
          <div className="no-totals-row" style={{ justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="no-cancel-btn" onClick={() => navigate('/fc/transfers')}>Cancel</button>
              <button className="no-submit-btn" onClick={save} disabled={saving}>
                {saving ? 'Saving...' : 'Create Transfer'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </Layout>
  )
}
