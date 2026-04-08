import { useState, useEffect } from 'react'
import { sb } from '../lib/supabase'

const INDUSTRIES = [
  'Automotive','Pharmaceuticals','Food & Beverage','Textile','Chemical',
  'Cement','Steel & Metal','Power & Energy','Oil & Gas','FMCG',
  'Engineering / Manufacturing','Panel Builder','OEM','Construction',
  'Infrastructure','Water Treatment','Mining','Other',
]
const CUSTOMER_TYPES = ['OEM','Panel Builder','End User','Trader']
const CREDIT_TERMS   = ['Against PI','Advance','7 Days','15 Days','30 Days','45 Days','60 Days','75 Days','90 Days','Against Delivery']

const FS = { padding:'8px 10px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, fontFamily:'var(--font)', background:'white', outline:'none', width:'100%', boxSizing:'border-box' }
const LBL = { fontSize:11, fontWeight:600, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:4, display:'block' }
const SEC = { fontSize:10, fontWeight:700, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.7px', margin:'16px 0 8px' }

function F({ label, required, err, children }) {
  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      <label style={LBL}>{label}{required && <span style={{ color:'#e11d48', marginLeft:2 }}>*</span>}</label>
      {children}
      {err && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{err}</div>}
    </div>
  )
}

function FileField({ label, required, accept, maxKB, value, onChange, err }) {
  return (
    <F label={label} required={required} err={err}>
      <label style={{
        display:'flex', alignItems:'center', gap:10, padding:'8px 12px',
        border: err ? '1px solid #e11d48' : '1px dashed var(--gray-300)',
        borderRadius:8, cursor:'pointer',
        background: value ? '#f0fdf4' : '#fafafa',
        fontSize:12, color: value ? '#15803d' : '#94a3b8',
      }}>
        <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:16, height:16, flexShrink:0 }}>
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        {value ? value.name : `Upload PDF (max ${maxKB}KB)`}
        <input type="file" accept={accept} style={{ display:'none' }} onChange={onChange} />
      </label>
    </F>
  )
}

function Card({ title, children, style }) {
  return (
    <div style={{ background:'white', border:'1px solid #e8edf2', borderRadius:10, overflow:'hidden', ...style }}>
      <div style={{ padding:'12px 16px', borderBottom:'1px solid #f1f5f9', fontWeight:700, fontSize:13, color:'#0f172a' }}>{title}</div>
      <div style={{ padding:16 }}>{children}</div>
    </div>
  )
}

// prop: prefill = { customer_name, gst, customer_type, account_owner }
// prop: onClose()
// prop: onCreated(customerId)
export default function NewCustomerModal({ prefill = {}, onClose, onCreated }) {
  const [ownerName, setOwnerName] = useState('')
  const [userRole, setUserRole]   = useState('sales')
  const [saving, setSaving]       = useState(false)
  const [errors, setErrors]       = useState({})
  const [fileErrors, setFileErrors] = useState({})
  const [gstCertFile, setGstCertFile]   = useState(null)
  const [msmeCertFile, setMsmeCertFile] = useState(null)

  const [form, setForm] = useState({
    customer_name:  prefill.customer_name || '',
    customer_type:  prefill.customer_type || '',
    industry:       '',
    year_established: '',
    premises:       '',
    turnover:       '',
    gst:            prefill.gst || '',
    pan_card_no:    '',
    msme_no:        '',
    billing_address: '',
    shipping_address: '',
    poc_name:       '',
    poc_no:         '',
    poc_email:      '',
    director_name:  '',
    director_no:    '',
    director_email: '',
    credit_terms:   'Against PI',
    account_status: 'Active',
    vi_shopfloor:   '',
    vi_payment:     '',
    vi_expected_business: '',
  })

  useEffect(() => {
    sb.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: p } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
      setOwnerName(p?.name || '')
      setUserRole(p?.role || 'sales')
      if (prefill.account_owner) setOwnerName(prefill.account_owner)
    })
  }, [])

  function set(key, val) { setForm(p => ({ ...p, [key]: val })) }

  function validateFile(file) {
    if (!file) return null
    if (!file.name.toLowerCase().endsWith('.pdf')) return 'Only PDF files allowed'
    if (file.size > 100 * 1024) return `Must be under 100KB (${Math.round(file.size/1024)}KB)`
    return null
  }

  function handleGstCert(e) {
    const file = e.target.files[0]; if (!file) return
    const err = validateFile(file)
    setFileErrors(p => ({ ...p, gst_cert: err }))
    if (!err) setGstCertFile(file)
  }
  function handleMsmeCert(e) {
    const file = e.target.files[0]; if (!file) return
    const err = validateFile(file)
    setFileErrors(p => ({ ...p, msme_cert: err }))
    if (!err) setMsmeCertFile(file)
  }

  async function uploadDoc(file, path) {
    const { error } = await sb.storage.from('customer-docs').upload(path, file, { upsert: true })
    if (error) throw error
    return sb.storage.from('customer-docs').getPublicUrl(path).data.publicUrl
  }

  async function handleSave() {
    const e = {}
    if (!form.customer_name.trim())       e.customer_name       = 'Required'
    if (!form.customer_type)              e.customer_type       = 'Required'
    if (!form.industry)                   e.industry            = 'Required'
    if (!form.year_established)           e.year_established    = 'Required'
    if (!form.premises)                   e.premises            = 'Required'
    if (!form.turnover.trim())            e.turnover            = 'Required'
    if (!form.gst.trim())                 e.gst                 = 'Required'
    if (!gstCertFile)                     e.gst_cert            = 'GST Certificate is required'
    if (fileErrors.gst_cert)              e.gst_cert            = fileErrors.gst_cert
    if (fileErrors.msme_cert)             e.msme_cert           = fileErrors.msme_cert
    if (!form.pan_card_no.trim())         e.pan_card_no         = 'Required'
    if (!form.billing_address.trim())     e.billing_address     = 'Required'
    if (!form.shipping_address.trim())    e.shipping_address    = 'Required'
    if (!form.poc_name.trim())            e.poc_name            = 'Required'
    if (!form.poc_no.trim())              e.poc_no              = 'Required'
    if (!form.poc_email.trim())           e.poc_email           = 'Required'
    if (!form.director_name.trim())       e.director_name       = 'Required'
    if (!form.director_no.trim())         e.director_no         = 'Required'
    if (!form.director_email.trim())      e.director_email      = 'Required'
    if (!form.vi_shopfloor.trim())        e.vi_shopfloor        = 'Required'
    if (!form.vi_payment.trim())          e.vi_payment          = 'Required'
    if (!form.vi_expected_business.trim()) e.vi_expected_business = 'Required'

    if (Object.keys(e).length > 0) { setErrors(e); return }
    setSaving(true)

    try {
      const { data: generatedId, error: rpcErr } = await sb.rpc('generate_customer_id')
      if (rpcErr) { alert('Error generating customer ID: ' + rpcErr.message); setSaving(false); return }

      const { data: inserted, error: insertErr } = await sb.from('customers').insert({
        customer_id:      generatedId,
        customer_name:    form.customer_name.trim(),
        customer_type:    form.customer_type || null,
        industry:         form.industry || null,
        year_established: form.year_established || null,
        premises:         form.premises || null,
        turnover:         form.turnover || null,
        gst:              form.gst || null,
        pan_card_no:      form.pan_card_no || null,
        msme_no:          form.msme_no || null,
        billing_address:  form.billing_address || null,
        shipping_address: form.shipping_address || null,
        poc_name:         form.poc_name || null,
        poc_no:           form.poc_no || null,
        poc_email:        form.poc_email || null,
        director_name:    form.director_name || null,
        director_no:      form.director_no || null,
        director_email:   form.director_email || null,
        credit_terms:     form.credit_terms || null,
        account_status:   form.account_status || 'Active',
        account_owner:    ownerName,
        approval_status:  userRole === 'admin' ? 'approved' : 'pending',
        vi_shopfloor:     form.vi_shopfloor || null,
        vi_payment:       form.vi_payment || null,
        vi_expected_business: form.vi_expected_business || null,
      }).select('id').single()

      if (insertErr) { alert('Error: ' + insertErr.message); setSaving(false); return }
      const newId = inserted.id

      let gstUrl
      try { gstUrl = await uploadDoc(gstCertFile, `gst/${newId}/${Date.now()}.pdf`) }
      catch (uploadErr) {
        await sb.from('customers').delete().eq('id', newId)
        alert('GST certificate upload failed: ' + uploadErr.message)
        setSaving(false); return
      }

      let msmeUrl = null
      if (msmeCertFile) {
        try { msmeUrl = await uploadDoc(msmeCertFile, `msme/${newId}/${Date.now()}.pdf`) }
        catch (uploadErr) {
          await sb.from('customers').delete().eq('id', newId)
          alert('MSME certificate upload failed: ' + uploadErr.message)
          setSaving(false); return
        }
      }

      await sb.from('customers').update({ gst_cert_url: gstUrl, msme_cert_url: msmeUrl }).eq('id', newId)
      onCreated(newId)
    } catch (err) {
      alert('Error: ' + err.message)
      setSaving(false)
    }
  }

  const inp = (f) => ({ ...FS, borderColor: errors[f] ? '#e11d48' : 'var(--gray-200)' })
  const g2 = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:9100, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#f8fafc', borderRadius:14, width:'100%', maxWidth:760, boxShadow:'0 24px 64px rgba(0,0,0,0.25)' }}>

        {/* Header */}
        <div style={{ padding:'18px 24px', background:'white', borderBottom:'1px solid #e8edf2', borderRadius:'14px 14px 0 0', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:'#0f172a' }}>New Customer Onboarding</div>
            <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>Pre-filled from opportunity — complete all required fields</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button onClick={onClose} style={{ padding:'8px 16px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving}
              style={{ padding:'8px 20px', border:'none', borderRadius:8, background:'#15803d', color:'white', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'var(--font)', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Add Customer'}
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14 }}>

          {/* Business Info */}
          <Card title="Business Info">
            <div style={g2}>
              <div style={{ gridColumn:'span 2' }}>
                <F label="Customer Name" required err={errors.customer_name}>
                  <input style={inp('customer_name')} value={form.customer_name} onChange={e => set('customer_name', e.target.value)} placeholder="e.g. Acme Industries Pvt. Ltd." />
                </F>
              </div>
              <F label="Customer Type" required err={errors.customer_type}>
                <select style={inp('customer_type')} value={form.customer_type} onChange={e => set('customer_type', e.target.value)}>
                  <option value="">— Select —</option>
                  {CUSTOMER_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </F>
              <F label="Industry" required err={errors.industry}>
                <select style={inp('industry')} value={form.industry} onChange={e => set('industry', e.target.value)}>
                  <option value="">— Select —</option>
                  {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
                </select>
              </F>
              <F label="Year of Establishment" required err={errors.year_established}>
                <input style={inp('year_established')} type="number" value={form.year_established} onChange={e => set('year_established', e.target.value)} placeholder="e.g. 2005" min="1900" max="2030" />
              </F>
              <F label="Premises" required err={errors.premises}>
                <select style={inp('premises')} value={form.premises} onChange={e => set('premises', e.target.value)}>
                  <option value="">— Select —</option>
                  <option>Owned</option><option>Rented</option><option>Leased</option>
                </select>
              </F>
              <F label="Annual Turnover" required err={errors.turnover}>
                <input style={inp('turnover')} value={form.turnover} onChange={e => set('turnover', e.target.value)} placeholder="e.g. 2 Cr, 50L" />
              </F>
            </div>
          </Card>

          {/* Tax & Compliance */}
          <Card title="Tax & Compliance">
            <div style={g2}>
              <F label="GST Number" required err={errors.gst}>
                <input style={inp('gst')} value={form.gst} onChange={e => set('gst', e.target.value)} placeholder="e.g. 24ABCDE1234F1Z5" />
              </F>
              <FileField label="GST Certificate" required accept=".pdf" maxKB={100} value={gstCertFile} onChange={handleGstCert} err={errors.gst_cert || fileErrors.gst_cert} />
              <F label="PAN Card No." required err={errors.pan_card_no}>
                <input style={inp('pan_card_no')} value={form.pan_card_no} onChange={e => set('pan_card_no', e.target.value)} placeholder="e.g. ABCDE1234F" />
              </F>
              <F label="MSME No." err={null}>
                <input style={FS} value={form.msme_no} onChange={e => set('msme_no', e.target.value)} placeholder="MSME registration number (optional)" />
              </F>
              <div style={{ gridColumn:'span 2' }}>
                <FileField label="MSME Certificate (optional)" accept=".pdf" maxKB={100} value={msmeCertFile} onChange={handleMsmeCert} err={fileErrors.msme_cert} />
              </div>
            </div>
          </Card>

          {/* Addresses */}
          <Card title="Addresses">
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <F label="Billing Address" required err={errors.billing_address}>
                <textarea style={{ ...inp('billing_address'), minHeight:72, resize:'vertical' }} value={form.billing_address} onChange={e => set('billing_address', e.target.value)} placeholder="Full billing address" />
              </F>
              <F label="Shipping Address" required err={errors.shipping_address}>
                <textarea style={{ ...inp('shipping_address'), minHeight:72, resize:'vertical' }} value={form.shipping_address} onChange={e => set('shipping_address', e.target.value)} placeholder="Full shipping address" />
              </F>
            </div>
          </Card>

          {/* Contacts */}
          <Card title="Contacts">
            <div style={SEC}>Point of Contact</div>
            <div style={{ ...g2, marginBottom:16 }}>
              <F label="Name" required err={errors.poc_name}>
                <input style={inp('poc_name')} value={form.poc_name} onChange={e => set('poc_name', e.target.value)} placeholder="Contact person name" />
              </F>
              <F label="Phone" required err={errors.poc_no}>
                <input style={inp('poc_no')} value={form.poc_no} onChange={e => set('poc_no', e.target.value)} placeholder="Mobile / office number" />
              </F>
              <div style={{ gridColumn:'span 2' }}>
                <F label="Email" required err={errors.poc_email}>
                  <input style={inp('poc_email')} type="email" value={form.poc_email} onChange={e => set('poc_email', e.target.value)} placeholder="contact@company.com" />
                </F>
              </div>
            </div>
            <div style={SEC}>Director / Decision Maker</div>
            <div style={g2}>
              <F label="Name" required err={errors.director_name}>
                <input style={inp('director_name')} value={form.director_name} onChange={e => set('director_name', e.target.value)} placeholder="Director / owner name" />
              </F>
              <F label="Phone" required err={errors.director_no}>
                <input style={inp('director_no')} value={form.director_no} onChange={e => set('director_no', e.target.value)} placeholder="Director contact number" />
              </F>
              <div style={{ gridColumn:'span 2' }}>
                <F label="Email" required err={errors.director_email}>
                  <input style={inp('director_email')} type="email" value={form.director_email} onChange={e => set('director_email', e.target.value)} placeholder="director@company.com" />
                </F>
              </div>
            </div>
          </Card>

          {/* Credit */}
          <Card title="Credit">
            <div style={g2}>
              <F label="Credit Terms" err={null}>
                <div style={{ ...FS, background:'#f8fafc', color:'#64748b' }}>
                  Against PI <span style={{ fontSize:11, color:'#94a3b8' }}>(can be updated by admin after onboarding)</span>
                </div>
              </F>
              <F label="Account Status" err={null}>
                <select style={FS} value={form.account_status} onChange={e => set('account_status', e.target.value)}>
                  <option>Active</option><option>Dormant</option>
                </select>
              </F>
            </div>
          </Card>

          {/* Visual Inspection */}
          <div style={{ background:'#fffdf5', border:'1px solid #fde68a', borderRadius:10, overflow:'hidden' }}>
            <div style={{ padding:'12px 16px', background:'#fffbeb', borderBottom:'1px solid #fde68a', fontWeight:700, fontSize:13, color:'#92400e', display:'flex', alignItems:'center', gap:6 }}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:15, height:15 }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Visual Inspection Notes
            </div>
            <div style={{ padding:16 }}>
              <p style={{ fontSize:12, color:'#92400e', background:'#fef3c7', borderRadius:6, padding:'8px 12px', marginBottom:14, lineHeight:1.5, margin:'0 0 14px' }}>
                Share your gut feeling after the visit. Be honest — these notes help the team understand this customer better.
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <F label="Shopfloor Observation" required err={errors.vi_shopfloor}>
                  <textarea style={{ ...FS, minHeight:72, resize:'vertical', borderColor: errors.vi_shopfloor ? '#e11d48' : '#fde68a' }}
                    value={form.vi_shopfloor} onChange={e => set('vi_shopfloor', e.target.value)}
                    placeholder="e.g. Shop floor filled with machines, active production, 3 CNC machines visible…" />
                </F>
                <F label="Payment Assessment" required err={errors.vi_payment}>
                  <textarea style={{ ...FS, minHeight:72, resize:'vertical', borderColor: errors.vi_payment ? '#e11d48' : '#fde68a' }}
                    value={form.vi_payment} onChange={e => set('vi_payment', e.target.value)}
                    placeholder="e.g. Ideal payment cycle 60 days, payment appears safe, no red flags…" />
                </F>
                <F label="Expected Business" required err={errors.vi_expected_business}>
                  <textarea style={{ ...FS, minHeight:72, resize:'vertical', borderColor: errors.vi_expected_business ? '#e11d48' : '#fde68a' }}
                    value={form.vi_expected_business} onChange={e => set('vi_expected_business', e.target.value)}
                    placeholder="e.g. Annual potential ₹8–10L, primarily Mitsubishi PLCs…" />
                </F>
              </div>
            </div>
          </div>

          {/* Account Owner */}
          <Card title="Account Owner">
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:36, height:36, borderRadius:'50%', background:'#1a4dab', color:'white', fontSize:13, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                {ownerName.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
              </div>
              <div>
                <div style={{ fontSize:14, fontWeight:600, color:'#0f172a' }}>{ownerName}</div>
                <div style={{ fontSize:11, color:'#94a3b8' }}>Auto-set to the person filling this form</div>
              </div>
            </div>
          </Card>

          {/* Footer save */}
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, paddingBottom:8 }}>
            <button onClick={onClose} style={{ padding:'9px 18px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving}
              style={{ padding:'9px 24px', border:'none', borderRadius:8, background:'#15803d', color:'white', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'var(--font)', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Add Customer'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
