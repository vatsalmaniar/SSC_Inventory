import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'

export default function ProcurementForecastConfig() {
  const navigate = useNavigate()
  const [userRole, setUserRole] = useState('')
  const [brands, setBrands]     = useState([])
  const [configs, setConfigs]   = useState({}) // { brand: row }
  const [edits, setEdits]       = useState({}) // { brand: { lead_time_days, transit_days, processing_days, inventory_days } }
  const [saving, setSaving]     = useState(null) // brand being saved
  const [loading, setLoading]   = useState(true)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    const role = profile?.role || ''
    if (!['ops', 'admin', 'management'].includes(role)) { navigate('/dashboard'); return }
    setUserRole(role)

    const [brandsRes, configRes] = await Promise.all([
      sb.from('items').select('brand').not('brand', 'is', null).neq('brand', '').order('brand'),
      sb.from('procurement_forecast_config').select('*'),
    ])

    const uniqueBrands = [...new Set((brandsRes.data || []).map(r => r.brand).filter(Boolean))].sort()
    const configMap = {}
    ;(configRes.data || []).forEach(r => { configMap[r.brand] = r })
    setBrands(uniqueBrands)
    setConfigs(configMap)

    const editMap = {}
    uniqueBrands.forEach(b => {
      editMap[b] = configMap[b]
        ? { lead_time_days: configMap[b].lead_time_days, transit_days: configMap[b].transit_days, processing_days: configMap[b].processing_days, inventory_days: configMap[b].inventory_days }
        : { lead_time_days: 0, transit_days: 0, processing_days: 0, inventory_days: 45 }
    })
    setEdits(editMap)
    setLoading(false)
  }

  function setField(brand, field, val) {
    setEdits(prev => ({ ...prev, [brand]: { ...prev[brand], [field]: val === '' ? '' : parseInt(val) || 0 } }))
  }

  async function saveRow(brand) {
    setSaving(brand)
    const row = edits[brand]
    const reorderDays = (row.lead_time_days || 0) + (row.transit_days || 0) + (row.processing_days || 0)
    const { error } = await sb.from('procurement_forecast_config').upsert({
      brand,
      lead_time_days: row.lead_time_days || 0,
      transit_days: row.transit_days || 0,
      processing_days: row.processing_days || 0,
      inventory_days: row.inventory_days || 45,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'brand' })
    if (error) { toast('Failed to save: ' + error.message); setSaving(null); return }
    setConfigs(prev => ({ ...prev, [brand]: { ...prev[brand], ...row, brand } }))
    toast(`${brand} config saved`, 'success')
    setSaving(null)
  }

  const INP = { width: 72, padding: '6px 8px', border: '1.5px solid var(--gray-200)', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 13, textAlign: 'right', outline: 'none', background: 'var(--gray-50)' }
  const TH = { padding: '10px 14px', fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)', whiteSpace: 'nowrap' }
  const TD = { padding: '12px 14px', fontSize: 13, borderBottom: '1px solid var(--gray-50)', verticalAlign: 'middle' }

  return (
    <Layout>
      <div style={{ padding: '28px 32px', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button onClick={() => navigate('/procurement/forecast')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Forecast
          </button>
          <span style={{ color: 'var(--gray-300)' }}>/</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--gray-900)' }}>Lead Time Configuration</span>
        </div>

        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: '#1d4ed8' }}>
          Set supplier lead time, transportation, and processing days per brand. Reorder Level = Lead Time + Transit + Processing. Replenishment Level = Reorder Level + Inventory Days.
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--gray-400)' }}>Loading…</div>
        ) : (
          <div style={{ background: 'white', border: '1px solid var(--gray-100)', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...TH, textAlign: 'left' }}>Brand</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Lead Time (days)</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Transit (days)</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Processing (days)</th>
                  <th style={{ ...TH, textAlign: 'right', color: '#1d4ed8' }}>Reorder Level</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Inventory Days</th>
                  <th style={{ ...TH, textAlign: 'right', color: '#15803d' }}>Replenishment Level</th>
                  <th style={{ ...TH }}></th>
                </tr>
              </thead>
              <tbody>
                {brands.map(brand => {
                  const row = edits[brand] || { lead_time_days: 0, transit_days: 0, processing_days: 0, inventory_days: 45 }
                  const reorderDays = (row.lead_time_days || 0) + (row.transit_days || 0) + (row.processing_days || 0)
                  const replenishDays = reorderDays + (row.inventory_days || 45)
                  const isSaving = saving === brand
                  const isDirty = JSON.stringify(row) !== JSON.stringify(
                    configs[brand]
                      ? { lead_time_days: configs[brand].lead_time_days, transit_days: configs[brand].transit_days, processing_days: configs[brand].processing_days, inventory_days: configs[brand].inventory_days }
                      : { lead_time_days: 0, transit_days: 0, processing_days: 0, inventory_days: 45 }
                  )
                  return (
                    <tr key={brand} style={{ background: isDirty ? '#fffbeb' : 'white' }}>
                      <td style={{ ...TD, fontWeight: 600, color: 'var(--gray-900)' }}>{brand}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <input style={INP} type="number" min="0" value={row.lead_time_days} onChange={e => setField(brand, 'lead_time_days', e.target.value)} />
                      </td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <input style={INP} type="number" min="0" value={row.transit_days} onChange={e => setField(brand, 'transit_days', e.target.value)} />
                      </td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <input style={INP} type="number" min="0" value={row.processing_days} onChange={e => setField(brand, 'processing_days', e.target.value)} />
                      </td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: '#1d4ed8', fontFamily: 'var(--mono)' }}>{reorderDays}d</td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <input style={INP} type="number" min="1" value={row.inventory_days} onChange={e => setField(brand, 'inventory_days', e.target.value)} />
                      </td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: '#15803d', fontFamily: 'var(--mono)' }}>{replenishDays}d</td>
                      <td style={{ ...TD }}>
                        {isDirty && (
                          <button onClick={() => saveRow(brand)} disabled={isSaving}
                            style={{ padding: '6px 14px', background: 'var(--blue-700)', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: isSaving ? 0.7 : 1 }}>
                            {isSaving ? 'Saving…' : 'Save'}
                          </button>
                        )}
                        {!isDirty && configs[brand] && (
                          <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>Saved</span>
                        )}
                        {!isDirty && !configs[brand] && (
                          <span style={{ fontSize: 11, color: 'var(--gray-300)' }}>Not set</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  )
}
