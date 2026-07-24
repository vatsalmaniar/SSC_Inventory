import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { distanceM } from '../lib/attendance'

// Compact attendance punch for the top header: selfie + location, feeds attendance_punches.
export default function PunchButton() {
  const [me, setMe] = useState(null)
  const [offices, setOffices] = useState([])
  const [nextDir, setNextDir] = useState('in')
  const [camOpen, setCamOpen] = useState(false)
  const [camErr, setCamErr] = useState('')
  const [punching, setPunching] = useState(false)
  const guard = useRef(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const geoRef = useRef(null)
  const [geoState, setGeoState] = useState('idle')  // idle | pending | ok | denied | unavailable | error

  useEffect(() => { load(); return () => streamRef.current?.getTracks().forEach(t=>t.stop()) }, [])

  async function load() {
    const { data: { session } } = await sb.auth.getSession()
    if (!session) return
    const { data: emp } = await sb.from('employees').select('id').eq('profile_id', session.user.id).maybeSingle()
    if (!emp) return
    setMe(emp)
    const [{ data: off }, { data: tp }] = await Promise.all([
      sb.from('office_locations').select('*').eq('is_active', true),
      (async () => { const t=new Date(); t.setHours(0,0,0,0); return sb.from('attendance_punches').select('direction,punch_at').eq('employee_id', emp.id).gte('punch_at', t.toISOString()).order('punch_at') })(),
    ])
    setOffices(off || [])
    const last = (tp || []).slice(-1)[0]
    setNextDir(last && last.direction === 'in' ? 'out' : 'in')
  }

  // Ask for location as soon as the punch opens (not at the end) so the browser
  // prompt shows up front and the GPS fix has time to resolve before capture.
  function requestLocation() {
    geoRef.current = null
    if (!('geolocation' in navigator)) { setGeoState('unavailable'); return }
    setGeoState('pending')
    navigator.geolocation.getCurrentPosition(
      p => { geoRef.current = p.coords; setGeoState('ok') },
      err => { setGeoState(err && err.code === 1 ? 'denied' : 'error') },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    )
  }

  async function openPunch() {
    setCamErr(''); setCamOpen(true)
    requestLocation()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(()=>{}) }
    } catch { setCamErr('Camera not available — you can still punch without a photo.') }
  }
  function closeCam() {
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setGeoState('idle'); setCamOpen(false)
  }

  async function capturePunch() {
    if (guard.current || !me) return
    guard.current = true; setPunching(true)
    try {
      let blob = null
      const v = videoRef.current
      if (v && streamRef.current && v.videoWidth) {
        const w = 480, h = Math.round(v.videoHeight / v.videoWidth * 480) || 480
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h
        cv.getContext('2d').drawImage(v, 0, 0, w, h)
        blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.6))
      }
      // location was requested when the punch opened; use it, retry once if still pending
      let geo = geoRef.current
      if (!geo && ('geolocation' in navigator)) {
        geo = await new Promise(res => navigator.geolocation.getCurrentPosition(p => res(p.coords), () => res(null), { enableHighAccuracy:true, timeout:15000, maximumAge:60000 }))
      }
      let lat=null, lng=null, acc=null, within=null, officeId=null
      if (geo) { lat=geo.latitude; lng=geo.longitude; acc=geo.accuracy
        let best=null
        offices.forEach(o => { if(o.lat!=null){ const dm=distanceM({lat,lng},{lat:o.lat,lng:o.lng}); if(dm!=null&&(best==null||dm<best.dm)) best={dm,o} } })
        if (best) { within = best.dm <= (best.o.radius_m||150); officeId = best.o.id } }
      let photoPath = null
      if (blob) {
        const path = `${me.id}/${Date.now()}.jpg`
        const { error: upErr } = await sb.storage.from('attendance-photos').upload(path, blob, { contentType:'image/jpeg', upsert:false })
        if (!upErr) photoPath = path
      }
      const { error } = await sb.from('attendance_punches').insert({ employee_id: me.id, direction: nextDir, method:'web', lat, lng, accuracy_m: acc, within_geofence: within, office_id: officeId, photo_path: photoPath })
      if (error) throw error
      toast(nextDir === 'in' ? 'Checked in.' : 'Checked out.', 'success')
      closeCam(); await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false; setPunching(false) }
  }

  if (!me) return null
  const isOut = nextDir === 'out'

  return (
    <>
      <button onClick={openPunch} title="Check in / out"
        style={{display:'inline-flex',alignItems:'center',gap:7,height:34,padding:'0 12px',borderRadius:8,cursor:'pointer',
          font:'inherit',fontSize:13,fontWeight:500,color:'#0B1B30',background:'#fff',border:'1px solid #E8EBF0',whiteSpace:'nowrap'}}>
        <span style={{width:7,height:7,borderRadius:'50%',flexShrink:0,background:isOut?'#C25A00':'#1a73e8'}} />
        Check {isOut ? 'Out' : 'In'}
      </button>

      {camOpen && createPortal(
        <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(11,27,48,0.72)',display:'grid',placeItems:'center',padding:16}}>
          <div style={{background:'#fff',borderRadius:16,width:'min(420px,94vw)',overflow:'hidden',boxShadow:'0 20px 60px rgba(0,0,0,0.35)',fontFamily:"'Geist','DM Sans',sans-serif"}}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #EFF1F4',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontWeight:600,fontSize:15,color:'#0B1B30'}}>{isOut?'Punch Out':'Punch In'} · Selfie</div>
              <button onClick={closeCam} style={{border:0,background:'none',fontSize:18,cursor:'pointer',color:'#5B6878'}}>✕</button>
            </div>
            <div style={{background:'#0B1B30',aspectRatio:'4 / 3',display:'grid',placeItems:'center'}}>
              {camErr
                ? <div style={{color:'#fff',fontSize:13,textAlign:'center',padding:24,lineHeight:1.5}}>{camErr}</div>
                : <video ref={videoRef} playsInline muted style={{width:'100%',height:'100%',objectFit:'cover',transform:'scaleX(-1)'}} />}
            </div>
            <div style={{padding:16,display:'flex',flexDirection:'column',gap:10}}>
              <div style={{fontSize:12,textAlign:'center',lineHeight:1.5,color: geoState==='denied'?'#C2410C':'#5B6878'}}>
                {geoState==='ok' ? '📍 Location captured.'
                  : geoState==='pending' ? '📍 Getting your location…'
                  : geoState==='denied' ? '⚠️ Location is blocked. Allow Location for this site in your browser settings, then punch again — otherwise your office location won’t be recorded.'
                  : geoState==='unavailable' ? '📍 Location isn’t available on this device.'
                  : '📍 Your location is captured with the punch.'}
              </div>
              {geoState!=='ok' && geoState!=='pending' && <button onClick={requestLocation} style={{width:'100%',border:'1px solid #E8EBF0',background:'#fff',borderRadius:10,padding:10,font:'inherit',fontSize:13,fontWeight:600,color:'#0B1B30',cursor:'pointer'}}>📍 Enable location</button>}
              <button onClick={capturePunch} disabled={punching}
                style={{width:'100%',border:0,borderRadius:10,padding:13,font:'inherit',fontSize:14.5,fontWeight:600,cursor:punching?'default':'pointer',color:'#fff',background:isOut?'#C25A00':'#1a73e8',opacity:punching?0.65:1}}>
                {punching ? 'Saving…' : (camErr ? `Punch ${isOut?'Out':'In'} without photo` : `📸 Capture & Punch ${isOut?'Out':'In'}`)}
              </button>
            </div>
          </div>
        </div>, document.body)}
    </>
  )
}
