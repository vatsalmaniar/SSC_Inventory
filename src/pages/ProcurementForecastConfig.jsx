import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'

export default function ProcurementForecastConfig() {
  const navigate = useNavigate()
  const [brands, setBrands]       = useState([])
  const [selectedBrand, setSelectedBrand] = useState('')
  const [configs, setConfigs]     = useState({})
  const [row, setRow]             = useState({ lead_time_days: 0, transit_days: 0, processing_days: 0, inventory_days: 45 })
  const [saved, setSaved]         = useState(null) // last saved values for dirty check
  const [saving, setSaving]       = useState(false)
  const [loading, setLoading]     = useState(true)
  const saveGuard = { current: false }

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (!['ops','admin','management'].includes(profile?.role)) { navigate('/dashboard'); return }

    const [brandsRes, configRes] = await Promise.all([
      sb.rpc('get_distinct_brands'),
      sb.from('procurement_forecast_config').select('*'),
    ])
    const uniqueBrands = (brandsRes.data || []).map(r => r.brand).filter(Boolean)
    const configMap = {}
    ;(configRes.data || []).forEach(r => { configMap[r.brand] = r })
    setBrands(uniqueBrands)
    setConfigs(configMap)
    setLoading(false)
  }

  function selectBrand(brand) {
    setSelectedBrand(brand)
    const cfg = configs[brand]
    const vals = cfg
      ? { lead_time_days: cfg.lead_time_days, transit_days: cfg.transit_days, processing_days: cfg.processing_days, inventory_days: cfg.inventory_days }
      : { lead_time_days: 0, transit_days: 0, processing_days: 0, inventory_days: 45 }
    setRow(vals)
    setSaved(cfg ? { ...vals } : null)
  }

  function setField(field, val) {
    setRow(prev => ({ ...prev, [field]: parseInt(val) || 0 }))
  }

  const reorderDays = (row.lead_time_days || 0) + (row.transit_days || 0) + (row.processing_days || 0)
  const replenishDays = reorderDays + (row.inventory_days || 45)
  const isDirty = !saved || JSON.stringify(row) !== JSON.stringify(saved)

  async function saveConfig() {
    if (saveGuard.current || !selectedBrand) return
    saveGuard.current = true
    setSaving(true)
    const { error } = await sb.from('procurement_forecast_config').upsert({
      brand: selectedBrand,
      lead_time_days: row.lead_time_days,
      transit_days: row.transit_days,
      processing_days: row.processing_days,
      inventory_days: row.inventory_days,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'brand' })
    if (error) { toast('Failed to save: ' + error.message); saveGuard.current = false; setSaving(false); return }
    setConfigs(prev => ({ ...prev, [selectedBrand]: { ...prev[selectedBrand], ...row, brand: selectedBrand } }))
    setSaved({ ...row })
    toast(`${selectedBrand} saved`, 'success')
    saveGuard.current = false
    setSaving(false)
  }

  const SLIDER_STYLE = { width: '100%', accentColor: '#2550c0', height: 4, cursor: 'pointer' }

  function SliderRow({ label, field, max, color }) {
    const val = row[field] || 0
    return (
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--gray-700)' }}>{label}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'var(--mono)' }}>{val}</span>
            <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>days</span>
          </div>
        </div>
        <input type="range" min="0" max={max} value={val} onChange={e => setField(field, e.target.value)} style={SLIDER_STYLE} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--gray-300)', marginTop: 4 }}>
          <span>0</span><span>{max / 2}</span><span>{max}</span>
        </div>
      </div>
    )
  }

  return (
    <Layout>
      <div style={{ padding: '28px 32px', maxWidth: 720, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <button onClick={() => navigate('/procurement/forecast')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Forecast
          </button>
          <span style={{ color: 'var(--gray-300)' }}>/</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--gray-900)' }}>Lead Time Configuration</span>
        </div>

        {/* Brand selector */}
        <div style={{ marginBottom: 28 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Select Brand</label>
          <select value={selectedBrand} onChange={e => selectBrand(e.target.value)}
            style={{ width: '100%', padding: '11px 14px', border: '1.5px solid var(--gray-200)', borderRadius: 8, fontSize: 14, color: 'var(--gray-900)', background: 'white', outline: 'none', cursor: 'pointer' }}>
            <option value="">— Choose a brand —</option>
            {brands.map(b => <option key={b} value={b}>{b} {configs[b] ? '✓' : ''}</option>)}
          </select>
        </div>

        {!selectedBrand ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--gray-400)', fontSize: 14 }}>
            Select a brand above to configure its lead time
          </div>
        ) : (
          <div style={{ background: 'white', border: '1px solid var(--gray-100)', borderRadius: 12, padding: 28 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--gray-900)', marginBottom: 4 }}>{selectedBrand}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 28 }}>Drag sliders to set days. Changes are live — save when done.</div>

            <SliderRow label="Supplier Lead Time" field="lead_time_days" max={90} color="#1d4ed8" />
            <SliderRow label="Transportation Time" field="transit_days" max={30} color="#7c3aed" />
            <SliderRow label="Order Processing Time" field="processing_days" max={14} color="#0891b2" />

            {/* Divider */}
            <div style={{ borderTop: '1px dashed var(--gray-100)', margin: '8px 0 24px' }} />

            {/* Calculation summary */}
            <div style={{ background: 'var(--gray-50)', borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 16 }}>Calculated Levels</div>

              {/* Visual timeline bar */}
              <div style={{ position: 'relative', height: 36, borderRadius: 8, overflow: 'hidden', marginBottom: 16, background: 'var(--gray-200)' }}>
                {replenishDays > 0 && <>
                  <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${(row.lead_time_days / replenishDays) * 100}%`, background: '#1d4ed8', transition: 'width 0.3s' }} />
                  <div style={{ position: 'absolute', left: `${(row.lead_time_days / replenishDays) * 100}%`, top: 0, height: '100%', width: `${(row.transit_days / replenishDays) * 100}%`, background: '#7c3aed', transition: 'all 0.3s' }} />
                  <div style={{ position: 'absolute', left: `${((row.lead_time_days + row.transit_days) / replenishDays) * 100}%`, top: 0, height: '100%', width: `${(row.processing_days / replenishDays) * 100}%`, background: '#0891b2', transition: 'all 0.3s' }} />
                  <div style={{ position: 'absolute', left: `${(reorderDays / replenishDays) * 100}%`, top: 0, height: '100%', width: `${((row.inventory_days || 45) / replenishDays) * 100}%`, background: '#16a34a', opacity: 0.7, transition: 'all 0.3s' }} />
                </>}
              </div>

              {/* Legend */}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
                {[['#1d4ed8', 'Lead Time'], ['#7c3aed', 'Transit'], ['#0891b2', 'Processing'], ['#16a34a', 'Inventory Buffer']].map(([c, l]) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--gray-600)' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{l}
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: 'white', borderRadius: 8, padding: '14px 16px', border: '1px solid var(--gray-100)' }}>
                  <div style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>Reorder Level</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#1d4ed8', fontFamily: 'var(--mono)' }}>{reorderDays}<span style={{ fontSize: 14, fontWeight: 500, color: 'var(--gray-500)', marginLeft: 4 }}>days</span></div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>Lead + Transit + Processing</div>
                </div>
                <div style={{ background: 'white', borderRadius: 8, padding: '14px 16px', border: '1px solid var(--gray-100)' }}>
                  <div style={{ fontSize: 11, color: 'var(--gray-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>Replenishment Level</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#16a34a', fontFamily: 'var(--mono)' }}>{replenishDays}<span style={{ fontSize: 14, fontWeight: 500, color: 'var(--gray-500)', marginLeft: 4 }}>days</span></div>
                  <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>Reorder + {row.inventory_days || 45}d inventory</div>
                </div>
              </div>

              {/* Inventory days */}
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-700)' }}>Inventory Buffer Days</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: '#16a34a', fontFamily: 'var(--mono)' }}>{row.inventory_days || 45}</span>
                    <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>days</span>
                  </div>
                </div>
                <input type="range" min="1" max="90" value={row.inventory_days || 45} onChange={e => setField('inventory_days', e.target.value)} style={{ ...SLIDER_STYLE, accentColor: '#16a34a' }} />
              </div>
            </div>

            <button onClick={saveConfig} disabled={saving || !isDirty}
              style={{ width: '100%', padding: '13px', background: isDirty ? 'var(--blue-700)' : 'var(--gray-100)', color: isDirty ? 'white' : 'var(--gray-400)', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: isDirty ? 'pointer' : 'default', transition: 'all 0.15s' }}>
              {saving ? 'Saving…' : isDirty ? `Save ${selectedBrand} Configuration` : 'Saved ✓'}
            </button>
          </div>
        )}
      </div>
    </Layout>
  )
}
