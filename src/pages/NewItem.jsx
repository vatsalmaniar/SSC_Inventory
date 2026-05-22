import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'

const FIELD_STYLE = { padding:'8px 10px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, fontFamily:'var(--font)', background:'white', outline:'none', width:'100%', boxSizing:'border-box' }
const LABEL_STYLE = { fontSize:11, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:4, display:'block' }
const SECTION_STYLE = { fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'20px 0 10px' }

function Field({ label, required, children }) {
  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      <label style={LABEL_STYLE}>{label}{required && <span style={{ color:'#e11d48', marginLeft:2 }}>*</span>}</label>
      {children}
    </div>
  )
}

export default function NewItem() {
  const navigate = useNavigate()
  const [userRole, setUserRole] = useState('')
  const [saving, setSaving]     = useState(false)
  const [errors, setErrors]     = useState({})
  const submitGuard             = useRef(false)

  const [form, setForm] = useState({ item_code:'', brand:'', category:'', subcategory:'', type:'', series:'' })
  const [brands, setBrands]           = useState([])
  const [categories, setCategories]   = useState([])
  const [subcategories, setSubcats]   = useState([])

  // Live similar-items finder (dup prevention)
  const [similar, setSimilar]   = useState([])
  const simTimer                = useRef(null)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    if (!['admin','management'].includes(role)) { navigate('/items'); return }   // hard gate
    setUserRole(role)
    const [b, c, s] = await Promise.all([
      sb.rpc('get_all_brands'),
      sb.rpc('get_all_categories'),
      sb.rpc('get_all_subcategories'),
    ])
    setBrands((b.data || []).map(r => r.brand).filter(Boolean))
    setCategories((c.data || []).map(r => r.category).filter(Boolean))
    setSubcats((s.data || []).map(r => r.subcategory).filter(Boolean))
  }

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })) }

  // Debounced similar-items search whenever item_code changes
  function onItemCodeChange(v) {
    set('item_code', v)
    clearTimeout(simTimer.current)
    if (!v.trim() || v.trim().length < 2) { setSimilar([]); return }
    simTimer.current = setTimeout(async () => {
      const { data } = await sb.rpc('search_items_fuzzy', { p_query: v.trim(), p_limit: 6 })
      setSimilar(data || [])
    }, 250)
  }

  const inputStyle = (field) => ({ ...FIELD_STYLE, borderColor: errors[field] ? '#e11d48' : 'var(--gray-200)' })

  function validate() {
    const e = {}
    if (!form.item_code.trim()) e.item_code = 'Item code is required'
    if (!form.brand.trim())     e.brand     = 'Brand is required'
    if (!form.type.trim())      e.type      = 'Type is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave() {
    if (submitGuard.current) return
    if (!validate()) { window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    submitGuard.current = true
    setSaving(true)
    const { data, error } = await sb.rpc('create_item', {
      p_item_code:   form.item_code.trim(),
      p_brand:       form.brand.trim(),
      p_category:    form.category.trim() || null,
      p_subcategory: form.subcategory.trim() || null,
      p_type:        form.type,
      p_series:      form.series.trim() || null,
    })
    if (error) {
      // RPC raises clean messages (dup / role / required) — show them as-is
      toast(error.message || friendlyError(error, 'Could not create item'))
      submitGuard.current = false; setSaving(false)
      return
    }
    toast(`Item ${data.item_no} created`, 'success')
    submitGuard.current = false; setSaving(false)
    navigate('/items/' + data.id)
  }

  return (
    <Layout pageTitle="New Item" pageKey="item360">
      <div className="od-page">
        <div className="od-body" style={{ maxWidth: 620 }}>

          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">Item 360</div>
                <div className="od-header-title">New Item</div>
                <div className="od-header-num">Add a part to the item master</div>
              </div>
              <div className="od-header-actions">
                <button className="od-btn" onClick={() => navigate('/items')}>← Cancel</button>
                <button className="od-btn od-btn-approve" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Add Item'}
                </button>
              </div>
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:16, marginTop:20 }}>
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Item Details</div></div>
              <div className="od-card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>

                  {/* Item Code + live similar finder */}
                  <div style={{ gridColumn:'span 2' }}>
                    <Field label="Item Code" required>
                      <input style={inputStyle('item_code')} value={form.item_code}
                        onChange={e => onItemCodeChange(e.target.value)}
                        placeholder="e.g. 12A230HBAC-M" autoComplete="off" />
                      {errors.item_code && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.item_code}</div>}
                      {similar.length > 0 && (
                        <div style={{ marginTop:8, border:'1px solid #fde68a', background:'#fffbeb', borderRadius:8, padding:'8px 10px' }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'#92400e', marginBottom:6 }}>
                            ⚠ {similar.length} similar item{similar.length>1?'s':''} already exist — is it one of these?
                          </div>
                          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                            {similar.map(s => (
                              <div key={s.id}
                                onClick={() => navigate('/items/' + s.id)}
                                style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 8px', borderRadius:6, cursor:'pointer', background:'white', border:'1px solid var(--gray-100)' }}>
                                <span style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'var(--gray-400)' }}>{s.item_no}</span>
                                <span style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:600, color:'var(--gray-800)' }}>{s.item_code}</span>
                                <span style={{ fontSize:11, color:'var(--gray-400)' }}>· {[s.brand, s.category].filter(Boolean).join(' · ')}</span>
                                <span style={{ marginLeft:'auto', fontSize:11, color:'#1a4dab' }}>open →</span>
                              </div>
                            ))}
                          </div>
                          <div style={{ fontSize:10.5, color:'#92400e', marginTop:6 }}>If yours is genuinely a new part, continue. Exact/near-identical codes are blocked automatically.</div>
                        </div>
                      )}
                    </Field>
                  </div>

                  <Field label="Brand" required>
                    <input style={inputStyle('brand')} value={form.brand} list="item-brands"
                      onChange={e => set('brand', e.target.value)} placeholder="Pick or type a brand" autoComplete="off" />
                    <datalist id="item-brands">{brands.map(b => <option key={b} value={b} />)}</datalist>
                    {errors.brand && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.brand}</div>}
                  </Field>

                  <Field label="Type" required>
                    <select style={inputStyle('type')} value={form.type} onChange={e => set('type', e.target.value)}>
                      <option value="">— Select —</option>
                      <option value="SI">SI – Standard</option>
                      <option value="CI">CI – Customised</option>
                    </select>
                    {errors.type && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.type}</div>}
                  </Field>

                  <Field label="Category">
                    <input style={inputStyle('category')} value={form.category} list="item-categories"
                      onChange={e => set('category', e.target.value)} placeholder="Pick or type a category" autoComplete="off" />
                    <datalist id="item-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
                  </Field>

                  <Field label="Subcategory">
                    <input style={inputStyle('subcategory')} value={form.subcategory} list="item-subcats"
                      onChange={e => set('subcategory', e.target.value)} placeholder="Optional" autoComplete="off" />
                    <datalist id="item-subcats">{subcategories.map(s => <option key={s} value={s} />)}</datalist>
                  </Field>

                  <div style={{ gridColumn:'span 2' }}>
                    <Field label="Series">
                      <input style={inputStyle('series')} value={form.series} onChange={e => set('series', e.target.value)} placeholder="Optional" autoComplete="off" />
                    </Field>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button className="od-btn" onClick={() => navigate('/items')}>Cancel</button>
              <button className="od-btn od-btn-approve" onClick={handleSave} disabled={saving} style={{ minWidth:140 }}>
                {saving ? 'Saving…' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
