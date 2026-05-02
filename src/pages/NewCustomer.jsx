import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'
import { friendlyError } from '../lib/errorMsg'

const INDUSTRIES = [
  'Textile','Pharma','Elevator','EV','Solar','Plastic','Packaging','Metal',
  'Water','Refrigeration','Machine Tool','Crane','Infrastructure','FMCG',
  'Energy','Automobile','Power Electronics','Datacenters','Road Construction',
  'Cement','Tyre','Petroleum','Chemical',
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
    credit_terms: 'Against PI', account_status: 'Active',
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
    if (!['sales','ops','admin','management'].includes(profile?.role)) { navigate('/dashboard'); return }
    setOwnerName(profile?.name || session.user.email.split('@')[0])
    setUserRole(profile?.role || 'sales')
  }

  function set(key, val) { setForm(p => ({ ...p, [key]: val })) }

  function validateFile(file, field) {
    if (!file) return null
    if (!file.name.toLowerCase().endsWith('.pdf')) return 'Only PDF files are allowed'
    if (file.size > 600 * 1024) return `File must be under 600KB (current: ${Math.round(file.size/1024)}KB)`
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
    // Business Info
    if (!form.customer_name.trim())  newErrors.customer_name   = 'Required'
    if (!form.customer_type)         newErrors.customer_type   = 'Required'
    if (!form.industry)              newErrors.industry        = 'Required'
    if (!form.year_established)      newErrors.year_established= 'Required'
    if (!form.premises)              newErrors.premises        = 'Required'
    if (!form.turnover.trim())       newErrors.turnover        = 'Required'
    // Tax & Compliance
    if (!form.gst.trim())            newErrors.gst             = 'Required'
    else if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i.test(form.gst.trim())) newErrors.gst = 'Invalid GST format (e.g. 24ABCDE1234F1Z5)'
    if (!gstCertFile)                newErrors.gst_cert        = 'GST Certificate is required'
    if (fileErrors.gst_cert)         newErrors.gst_cert        = fileErrors.gst_cert
    if (fileErrors.msme_cert)        newErrors.msme_cert       = fileErrors.msme_cert
    if (!form.pan_card_no.trim())    newErrors.pan_card_no     = 'Required'
    else if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(form.pan_card_no.trim())) newErrors.pan_card_no = 'Invalid PAN format (e.g. ABCDE1234F)'
    // Addresses
    if (!form.billing_address.trim())  newErrors.billing_address  = 'Required'
    if (!form.shipping_address.trim()) newErrors.shipping_address = 'Required'
    // Contacts
    if (!form.poc_name.trim())       newErrors.poc_name        = 'Required'
    if (!form.poc_no.trim())         newErrors.poc_no          = 'Required'
    else if (!/^[6-9][0-9]{9}$/.test(form.poc_no.trim())) newErrors.poc_no = 'Invalid mobile number (10 digits, starts with 6-9)'
    if (!form.poc_email.trim())      newErrors.poc_email       = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.poc_email.trim())) newErrors.poc_email = 'Invalid email format'
    if (!form.director_name.trim())  newErrors.director_name   = 'Required'
    if (!form.director_no.trim())    newErrors.director_no     = 'Required'
    else if (!/^[6-9][0-9]{9}$/.test(form.director_no.trim())) newErrors.director_no = 'Invalid mobile number (10 digits, starts with 6-9)'
    if (!form.director_email.trim()) newErrors.director_email  = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.director_email.trim())) newErrors.director_email = 'Invalid email format'
    // Credit
    if (!form.credit_terms)          newErrors.credit_terms    = 'Required'
    // Visual Inspection
    if (!form.vi_shopfloor.trim())        newErrors.vi_shopfloor        = 'Required'
    if (!form.vi_payment.trim())          newErrors.vi_payment          = 'Required'
    if (!form.vi_expected_business.trim()) newErrors.vi_expected_business = 'Required'

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    // Check if GST already exists — prevent duplicates
    const { data: existingCust } = await sb.from('customers').select('id,customer_name').eq('gst', form.gst.trim()).maybeSingle()
    if (existingCust) {
      toast(`Customer with this GST already exists: ${existingCust.customer_name}`)
      setErrors({ gst: 'This GST is already registered' })
      return
    }

    setSaving(true)
    try {
      // Generate customer_id server-side (SECURITY DEFINER bypasses RLS)
      const { data: generatedId, error: rpcErr } = await sb.rpc('generate_customer_id')
      if (rpcErr) { toast(friendlyError(rpcErr, "Generating customer ID failed. Please try again.")); setSaving(false); return }
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
        approved_by:      userRole === 'admin' ? ownerName : null,
        approved_at:      userRole === 'admin' ? new Date().toISOString() : null,
        vi_shopfloor:     form.vi_shopfloor || null,
        vi_payment:       form.vi_payment || null,
        vi_expected_business: form.vi_expected_business || null,
      }).select('id').single()

      if (insertErr) { toast(friendlyError(insertErr, "Creating customer failed. Please try again.")); setSaving(false); return }
      const newId = inserted.id

      // Upload GST cert — delete inserted row on failure to avoid orphan
      let gstUrl
      try {
        gstUrl = await uploadDoc(gstCertFile, `gst/${newId}/${Date.now()}.pdf`)
      } catch (uploadErr) {
        await sb.from('customers').delete().eq('id', newId)
        toast(friendlyError(uploadErr, "GST certificate upload failed — customer not saved. Please try again."))
        setSaving(false); return
      }

      // Upload MSME cert (optional)
      let msmeUrl = null
      if (msmeCertFile) {
        try {
          msmeUrl = await uploadDoc(msmeCertFile, `msme/${newId}/${Date.now()}.pdf`)
        } catch (uploadErr) {
          await sb.from('customers').delete().eq('id', newId)
          toast(friendlyError(uploadErr, "MSME certificate upload failed — customer not saved. Please try again."))
          setSaving(false); return
        }
      }

      // Update with file URLs
      await sb.from('customers').update({ gst_cert_url: gstUrl, msme_cert_url: msmeUrl }).eq('id', newId)

      // Notify vatsal.maniar + mayank.maniar on every new customer onboarding
      const { data: recipients } = await sb.from('profiles').select('id,name').in('username', ['vatsal.maniar', 'mayank.maniar'])
      if (recipients?.length) {
        await sb.from('notifications').insert(recipients.map(a => ({
          user_id: a.id, user_name: a.name,
          message: `New customer "${form.customer_name}" onboarded by ${ownerName}${userRole !== 'admin' ? ' — pending approval' : ''}`,
          order_id: null, order_number: '', from_name: ownerName,
          email_type: 'new_customer_approval',
        })))
      }

      toast('Customer created — ' + finalCustId, 'success')
      if (userRole === 'admin') {
        navigate('/customers/' + newId)
      } else {
        navigate('/customers', { state: { submitted: true, custId: finalCustId } })
      }
    } catch (err) {
      toast(friendlyError(err))
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
                  <Field label="Customer Type" required>
                    <select style={inputStyle('customer_type')} value={form.customer_type} onChange={e => set('customer_type', e.target.value)}>
                      <option value="">— Select —</option>
                      {CUSTOMER_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                    {errors.customer_type && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.customer_type}</div>}
                  </Field>
                  <Field label="Industry" required>
                    <select style={inputStyle('industry')} value={form.industry} onChange={e => set('industry', e.target.value)}>
                      <option value="">— Select —</option>
                      {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
                    </select>
                    {errors.industry && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.industry}</div>}
                  </Field>
                  <Field label="Year of Establishment" required>
                    <input style={inputStyle('year_established')} type="number" value={form.year_established} onChange={e => set('year_established', e.target.value)} placeholder="e.g. 2005" min="1900" max="2026" />
                    {errors.year_established && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.year_established}</div>}
                  </Field>
                  <Field label="Premises" required>
                    <select style={inputStyle('premises')} value={form.premises} onChange={e => set('premises', e.target.value)}>
                      <option value="">— Select —</option>
                      <option>Owned</option>
                      <option>Rented</option>
                      <option>Leased</option>
                    </select>
                    {errors.premises && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.premises}</div>}
                  </Field>
                  <Field label="Annual Turnover" required>
                    <input style={inputStyle('turnover')} value={form.turnover} onChange={e => set('turnover', e.target.value)} placeholder="e.g. 2 Cr, 50L" />
                    {errors.turnover && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.turnover}</div>}
                  </Field>
                </div>
              </div>
            </div>

            {/* Tax & Compliance */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Tax & Compliance</div></div>
              <div className="od-card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Field label="GST Number" required>
                    <input style={inputStyle('gst')} value={form.gst} onChange={e => set('gst', e.target.value)} placeholder="e.g. 24ABCDE1234F1Z5" />
                    {errors.gst && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.gst}</div>}
                  </Field>
                  <FileUploadField
                    label="GST Certificate" required
                    accept=".pdf" maxKB={100}
                    value={gstCertFile}
                    onChange={handleGstCert}
                    error={errors.gst_cert || fileErrors.gst_cert}
                  />
                  <Field label="PAN Card No." required>
                    <input style={inputStyle('pan_card_no')} value={form.pan_card_no} onChange={e => set('pan_card_no', e.target.value)} placeholder="e.g. ABCDE1234F" />
                    {errors.pan_card_no && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.pan_card_no}</div>}
                  </Field>
                  <Field label="MSME No.">
                    <input style={FIELD_STYLE} value={form.msme_no} onChange={e => set('msme_no', e.target.value)} placeholder="MSME registration number (optional)" />
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
                  <Field label="Billing Address" required>
                    <textarea style={{ ...inputStyle('billing_address'), minHeight:72, resize:'vertical' }} value={form.billing_address} onChange={e => set('billing_address', e.target.value)} placeholder="Full billing address" />
                    {errors.billing_address && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.billing_address}</div>}
                  </Field>
                  <Field label="Shipping Address" required>
                    <textarea style={{ ...inputStyle('shipping_address'), minHeight:72, resize:'vertical' }} value={form.shipping_address} onChange={e => set('shipping_address', e.target.value)} placeholder="Full shipping address" />
                    {errors.shipping_address && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.shipping_address}</div>}
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
                  <Field label="Name" required>
                    <input style={inputStyle('poc_name')} value={form.poc_name} onChange={e => set('poc_name', e.target.value)} placeholder="Contact person name" />
                    {errors.poc_name && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.poc_name}</div>}
                  </Field>
                  <Field label="Phone" required>
                    <input style={inputStyle('poc_no')} value={form.poc_no} onChange={e => set('poc_no', e.target.value)} placeholder="Mobile / office number" />
                    {errors.poc_no && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.poc_no}</div>}
                  </Field>
                  <div style={{ gridColumn:'span 2' }}>
                    <Field label="Email" required>
                      <input style={inputStyle('poc_email')} type="email" value={form.poc_email} onChange={e => set('poc_email', e.target.value)} placeholder="contact@company.com" />
                      {errors.poc_email && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.poc_email}</div>}
                    </Field>
                  </div>
                </div>
                <div style={SECTION_STYLE}>Director / Decision Maker</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Field label="Name" required>
                    <input style={inputStyle('director_name')} value={form.director_name} onChange={e => set('director_name', e.target.value)} placeholder="Director / owner name" />
                    {errors.director_name && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.director_name}</div>}
                  </Field>
                  <Field label="Phone" required>
                    <input style={inputStyle('director_no')} value={form.director_no} onChange={e => set('director_no', e.target.value)} placeholder="Director contact number" />
                    {errors.director_no && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.director_no}</div>}
                  </Field>
                  <div style={{ gridColumn:'span 2' }}>
                    <Field label="Email" required>
                      <input style={inputStyle('director_email')} type="email" value={form.director_email} onChange={e => set('director_email', e.target.value)} placeholder="director@company.com" />
                      {errors.director_email && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.director_email}</div>}
                    </Field>
                  </div>
                </div>
              </div>
            </div>

            {/* Credit */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Credit</div></div>
              <div className="od-card-body">
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <Field label="Credit Terms" required>
                    {userRole === 'admin' ? (
                      <select style={inputStyle('credit_terms')} value={form.credit_terms} onChange={e => set('credit_terms', e.target.value)}>
                        <option value="">— Select —</option>
                        {CREDIT_TERMS.map(t => <option key={t}>{t}</option>)}
                      </select>
                    ) : (
                      <div style={{ ...FIELD_STYLE, background:'var(--gray-50)', color:'var(--gray-700)', cursor:'default' }}>
                        Against PI <span style={{ fontSize:11, color:'var(--gray-400)', marginLeft:6 }}>(set by admin)</span>
                      </div>
                    )}
                    {errors.credit_terms && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.credit_terms}</div>}
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
                  <Field label="Shopfloor Observation" required>
                    <textarea style={{ ...FIELD_STYLE, minHeight:72, resize:'vertical', borderColor: errors.vi_shopfloor ? '#e11d48' : '#fde68a' }}
                      value={form.vi_shopfloor} onChange={e => set('vi_shopfloor', e.target.value)}
                      placeholder="e.g. Shop floor filled with machines, active production, 3 CNC machines visible, ~20 workers on shift…" />
                    {errors.vi_shopfloor && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.vi_shopfloor}</div>}
                  </Field>
                  <Field label="Payment Assessment" required>
                    <textarea style={{ ...FIELD_STYLE, minHeight:72, resize:'vertical', borderColor: errors.vi_payment ? '#e11d48' : '#fde68a' }}
                      value={form.vi_payment} onChange={e => set('vi_payment', e.target.value)}
                      placeholder="e.g. Ideal payment cycle 60 days, payment appears safe, no red flags, accounts dept present…" />
                    {errors.vi_payment && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.vi_payment}</div>}
                  </Field>
                  <Field label="Expected Business" required>
                    <textarea style={{ ...FIELD_STYLE, minHeight:72, resize:'vertical', borderColor: errors.vi_expected_business ? '#e11d48' : '#fde68a' }}
                      value={form.vi_expected_business} onChange={e => set('vi_expected_business', e.target.value)}
                      placeholder="e.g. Annual potential ₹8–10L, primarily Mitsubishi PLCs, quarterly reorders expected…" />
                    {errors.vi_expected_business && <div style={{ fontSize:11, color:'#e11d48', marginTop:3 }}>{errors.vi_expected_business}</div>}
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
