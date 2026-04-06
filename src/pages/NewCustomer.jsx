import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'

const INDUSTRIES = [
  'Automotive','Pharmaceuticals','Food & Beverage','Textile','Chemical',
  'Cement','Steel & Metal','Power & Energy','Oil & Gas','FMCG',
  'Engineering / Manufacturing','Panel Builder','OEM','Construction',
  'Infrastructure','Water Treatment','Mining','Other',
]
const CUSTOMER_TYPES = ['OEM','Panel Builder','End User','Trader']
const CREDIT_TERMS   = ['Against PI','Advance','7 Days','15 Days','30 Days','45 Days','60 Days','75 Days','90 Days','Against Delivery']

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

function FileUploadField({ label, required, accept, maxKB, value, onChange, error }) {
  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      <label style={LABEL_STYLE}>{label}{required && <span style={{ color:'#e11d48', marginLeft:2 }}>*</span>}</label>
      <label style={{
        display:'flex', alignItems:'center', gap:10, padding:'8px 12px',
        border: error ? '1px solid #e11d48' : '1px dashed var(--gray-300)',
        borderRadius:8, cursor:'pointer', background: value ? '#f0fdf4' : '#fafafa',
        fontSize:12, color: value ? '#15803d' : 'var(--gray-500)',
        transition:'all 0.15s',
      }}>
        <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:16, height:16, flexShrink:0 }}>
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        {value ? value.name : `Upload PDF (max ${maxKB}KB)`}
        <input type="file" accept={accept} style={{ display:'none' }} onChange={onChange} />
      </label>
      {error && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{error}</div>}
    </div>
  )
}

export default function NewCustomer() {
  const navigate = useNavigate()
  const [ownerName, setOwnerName] = useState('')
  const [userRole, setUserRole]   = useState('')
  const [saving, setSaving]       = useState(false)
  const [errors, setErrors]       = useState({})

  const [form, setForm] = useState({
    customer_name: '', customer_type: '', industry: '',
    year_established: '', premises: '', turnover: '',
    gst: '', pan_card_no: '', msme_no: '',
    billing_address: '', shipping_address: '',
    poc_name: '', poc_no: '', poc_email: '',
    director_name: '', director_no: '', director_email: '',
    credit_terms: '', account_status: 'Active',
    vi_shopfloor: '', vi_payment: '', vi_expected_business: '',
  })
  const [gstCertFile, setGstCertFile]   = useState(null)
  const [msmeCertFile, setMsmeCertFile] = useState(null)
  const [fileErrors, setFileErrors]     = useState({})

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    if (!['sales','ops','admin'].includes(profile?.role)) { navigate('/dashboard'); return }
    setOwnerName(profile?.name || session.user.email.split('@')[0])
    setUserRole(profile?.role || 'sales')
  }

  function set(key, val) { setForm(p => ({ ...p, [key]: val })) }

  function validateFile(file, field) {
    if (!file) return null
    if (!file.name.toLowerCase().endsWith('.pdf')) return 'Only PDF files are allowed'
    if (file.size > 100 * 1024) return `File must be under 100KB (current: ${Math.round(file.size/1024)}KB)`
    return null
  }

  function handleGstCert(e) {
    const file = e.target.files[0]
    if (!file) return
    const err = validateFile(file, 'gst_cert')
    setFileErrors(p => ({ ...p, gst_cert: err }))
    if (!err) setGstCertFile(file)
  }

  function handleMsmeCert(e) {
    const file = e.target.files[0]
    if (!file) return
    const err = validateFile(file, 'msme_cert')
    setFileErrors(p => ({ ...p, msme_cert: err }))
    if (!err) setMsmeCertFile(file)
  }

  async function uploadDoc(file, path) {
    const { error } = await sb.storage.from('customer-docs').upload(path, file, { upsert: true })
    if (error) throw error
    return sb.storage.from('customer-docs').getPublicUrl(path).data.publicUrl
  }

  async function handleSave() {
    const newErrors = {}
    if (!form.customer_name.trim()) newErrors.customer_name = 'Customer name is required'
    if (!gstCertFile) newErrors.gst_cert = 'GST Certificate is required'
    if (fileErrors.gst_cert) newErrors.gst_cert = fileErrors.gst_cert
    if (fileErrors.msme_cert) newErrors.msme_cert = fileErrors.msme_cert
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return }

    setSaving(true)
    try {
      // Generate customer_id server-side (SECURITY DEFINER bypasses RLS)
      const { data: generatedId, error: rpcErr } = await sb.rpc('generate_customer_id')
      if (rpcErr) { alert('Error generating customer ID: ' + rpcErr.message); setSaving(false); return }
      const finalCustId = generatedId

      const { data: inserted, error: insertErr } = await sb.from('customers').insert({
        customer_id:      finalCustId,
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

      if (insertErr) { alert('Error creating customer: ' + insertErr.message); setSaving(false); return }
      const newId = inserted.id

      // Upload GST cert — delete inserted row on failure to avoid orphan
      let gstUrl
      try {
        gstUrl = await uploadDoc(gstCertFile, `gst/${newId}/${Date.now()}.pdf`)
      } catch (uploadErr) {
        await sb.from('customers').delete().eq('id', newId)
        alert('GST certificate upload failed — customer not saved. Please try again.\n' + uploadErr.message)
        setSaving(false); return
      }

      // Upload MSME cert (optional)
      let msmeUrl = null
      if (msmeCertFile) {
        try {
          msmeUrl = await uploadDoc(msmeCertFile, `msme/${newId}/${Date.now()}.pdf`)
        } catch (uploadErr) {
          await sb.from('customers').delete().eq('id', newId)
          alert('MSME certificate upload failed — customer not saved. Please try again.\n' + uploadErr.message)
          setSaving(false); return
        }
      }

      // Update with file URLs
      await sb.from('customers').update({ gst_cert_url: gstUrl, msme_cert_url: msmeUrl }).eq('id', newId)

      if (userRole === 'admin') {
        navigate('/customers/' + newId)
      } else {
        navigate('/customers', { state: { submitted: true, custId: finalCustId } })
      }
    } catch (err) {
      alert('Error: ' + err.message)
      setSaving(false)
    }
  }

  const inputStyle = (field) => ({ ...FIELD_STYLE, borderColor: errors[field] ? '#e11d48' : 'var(--gray-200)' })

  return (
    <Layout pageTitle="New Customer" pageKey="customer360">
      <div className="od-page">
        <div className="od-body" style={{ maxWidth: 760 }}>

          {/* Header */}
          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">Customer 360</div>
                <div className="od-header-title">New Customer Onboarding</div>
                <div className="od-header-num">Fill in the details below to add a new account</div>
              </div>
              <div className="od-header-actions">
                <button className="od-btn" onClick={() => navigate('/customers')}>← Cancel</button>
                <button className="od-btn od-btn-approve" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Add Customer'}
                </button>
              </div>
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:16, marginTop:20 }}>

            {/* Business Info */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Business Info</div></div>
              <div className="od-card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <div style={{ gridColumn:'span 2' }}>
                    <Field label="Customer Name" required>
                      <input style={inputStyle('customer_name')} value={form.customer_name} onChange={e => set('customer_name', e.target.value)} placeholder="e.g. Acme Industries Pvt. Ltd." />
                      {errors.customer_name && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.customer_name}</div>}
                    </Field>
                  </div>
                  <Field label="Customer Type">
                    <select style={FIELD_STYLE} value={form.customer_type} onChange={e => set('customer_type', e.target.value)}>
                      <option value="">— Select —</option>
                      {CUSTOMER_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Industry">
                    <select style={FIELD_STYLE} value={form.industry} onChange={e => set('industry', e.target.value)}>
                      <option value="">— Select —</option>
                      {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
                    </select>
                  </Field>
                  <Field label="Year of Establishment">
                    <input style={FIELD_STYLE} type="number" value={form.year_established} onChange={e => set('year_established', e.target.value)} placeholder="e.g. 2005" min="1900" max="2026" />
                  </Field>
                  <Field label="Premises">
                    <select style={FIELD_STYLE} value={form.premises} onChange={e => set('premises', e.target.value)}>
                      <option value="">— Select —</option>
                      <option>Owned</option>
                      <option>Rented</option>
                      <option>Leased</option>
                    </select>
                  </Field>
                  <Field label="Annual Turnover">
                    <input style={FIELD_STYLE} value={form.turnover} onChange={e => set('turnover', e.target.value)} placeholder="e.g. 2 Cr, 50L" />
                  </Field>
                </div>
              </div>
            </div>

            {/* Tax & Compliance */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Tax & Compliance</div></div>
              <div className="od-card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Field label="GST Number">
                    <input style={FIELD_STYLE} value={form.gst} onChange={e => set('gst', e.target.value)} placeholder="e.g. 24ABCDE1234F1Z5" />
                  </Field>
                  <FileUploadField
                    label="GST Certificate" required
                    accept=".pdf" maxKB={100}
                    value={gstCertFile}
                    onChange={handleGstCert}
                    error={errors.gst_cert || fileErrors.gst_cert}
                  />
                  <Field label="PAN Card No.">
                    <input style={FIELD_STYLE} value={form.pan_card_no} onChange={e => set('pan_card_no', e.target.value)} placeholder="e.g. ABCDE1234F" />
                  </Field>
                  <Field label="MSME No.">
                    <input style={FIELD_STYLE} value={form.msme_no} onChange={e => set('msme_no', e.target.value)} placeholder="MSME registration number" />
                  </Field>
                  <div style={{ gridColumn:'span 2' }}>
                    <FileUploadField
                      label="MSME Certificate (optional)"
                      accept=".pdf" maxKB={100}
                      value={msmeCertFile}
                      onChange={handleMsmeCert}
                      error={fileErrors.msme_cert}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Addresses */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Addresses</div></div>
              <div className="od-card-body">
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <Field label="Billing Address">
                    <textarea style={{ ...FIELD_STYLE, minHeight:72, resize:'vertical' }} value={form.billing_address} onChange={e => set('billing_address', e.target.value)} placeholder="Full billing address" />
                  </Field>
                  <Field label="Shipping Address">
                    <textarea style={{ ...FIELD_STYLE, minHeight:72, resize:'vertical' }} value={form.shipping_address} onChange={e => set('shipping_address', e.target.value)} placeholder="Full shipping address (if different from billing)" />
                  </Field>
                </div>
              </div>
            </div>

            {/* Contact */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Contacts</div></div>
              <div className="od-card-body">
                <div style={SECTION_STYLE}>Point of Contact</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
                  <Field label="Name"><input style={FIELD_STYLE} value={form.poc_name} onChange={e => set('poc_name', e.target.value)} placeholder="Contact person name" /></Field>
                  <Field label="Phone"><input style={FIELD_STYLE} value={form.poc_no} onChange={e => set('poc_no', e.target.value)} placeholder="Mobile / office number" /></Field>
                  <div style={{ gridColumn:'span 2' }}>
                    <Field label="Email"><input style={FIELD_STYLE} type="email" value={form.poc_email} onChange={e => set('poc_email', e.target.value)} placeholder="contact@company.com" /></Field>
                  </div>
                </div>
                <div style={SECTION_STYLE}>Director / Decision Maker</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Field label="Name"><input style={FIELD_STYLE} value={form.director_name} onChange={e => set('director_name', e.target.value)} placeholder="Director / owner name" /></Field>
                  <Field label="Phone"><input style={FIELD_STYLE} value={form.director_no} onChange={e => set('director_no', e.target.value)} placeholder="Director contact number" /></Field>
                  <div style={{ gridColumn:'span 2' }}>
                    <Field label="Email"><input style={FIELD_STYLE} type="email" value={form.director_email} onChange={e => set('director_email', e.target.value)} placeholder="director@company.com" /></Field>
                  </div>
                </div>
              </div>
            </div>

            {/* Credit */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Credit</div></div>
              <div className="od-card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Field label="Credit Terms">
                    <select style={FIELD_STYLE} value={form.credit_terms} onChange={e => set('credit_terms', e.target.value)}>
                      <option value="">— Select —</option>
                      {CREDIT_TERMS.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Account Status">
                    <select style={FIELD_STYLE} value={form.account_status} onChange={e => set('account_status', e.target.value)}>
                      <option>Active</option>
                      <option>Dormant</option>
                    </select>
                  </Field>
                </div>
              </div>
            </div>

            {/* Visual Inspection */}
            <div className="od-card" style={{ border:'1px solid #fde68a', background:'#fffdf5' }}>
              <div className="od-card-header" style={{ background:'#fffbeb', borderBottom:'1px solid #fde68a' }}>
                <div className="od-card-title" style={{ color:'#92400e' }}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:15, height:15, display:'inline', marginRight:6, verticalAlign:'middle' }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  Visual Inspection Notes
                </div>
              </div>
              <div className="od-card-body">
                <p style={{ fontSize:12, color:'#92400e', background:'#fef3c7', borderRadius:6, padding:'8px 12px', marginBottom:16, lineHeight:1.5 }}>
                  Share your gut feeling after the visit. Be honest — these notes help the team understand this customer better.
                </p>
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <Field label="Shopfloor Observation">
                    <textarea style={{ ...FIELD_STYLE, minHeight:72, resize:'vertical', borderColor:'#fde68a' }}
                      value={form.vi_shopfloor} onChange={e => set('vi_shopfloor', e.target.value)}
                      placeholder="e.g. Shop floor filled with machines, active production, 3 CNC machines visible, ~20 workers on shift…" />
                  </Field>
                  <Field label="Payment Assessment">
                    <textarea style={{ ...FIELD_STYLE, minHeight:72, resize:'vertical', borderColor:'#fde68a' }}
                      value={form.vi_payment} onChange={e => set('vi_payment', e.target.value)}
                      placeholder="e.g. Ideal payment cycle 60 days, payment appears safe, no red flags, accounts dept present…" />
                  </Field>
                  <Field label="Expected Business">
                    <textarea style={{ ...FIELD_STYLE, minHeight:72, resize:'vertical', borderColor:'#fde68a' }}
                      value={form.vi_expected_business} onChange={e => set('vi_expected_business', e.target.value)}
                      placeholder="e.g. Annual potential ₹8–10L, primarily Mitsubishi PLCs, quarterly reorders expected…" />
                  </Field>
                </div>
              </div>
            </div>

            {/* Account Owner */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Account Owner</div></div>
              <div className="od-card-body">
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', background:'#1a4dab', color:'white', fontSize:13, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    {ownerName.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                  </div>
                  <div>
                    <div style={{ fontSize:14, fontWeight:600, color:'var(--gray-900)' }}>{ownerName}</div>
                    <div style={{ fontSize:11, color:'var(--gray-400)' }}>Auto-set to the person filling this form</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Save button at bottom */}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, paddingBottom:32 }}>
              <button className="od-btn" onClick={() => navigate('/customers')}>Cancel</button>
              <button className="od-btn od-btn-approve" onClick={handleSave} disabled={saving} style={{ minWidth:140 }}>
                {saving ? 'Saving…' : 'Add Customer'}
              </button>
            </div>

          </div>
        </div>
      </div>
    </Layout>
  )
}
