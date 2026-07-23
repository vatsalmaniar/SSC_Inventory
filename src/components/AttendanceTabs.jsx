import { useNavigate, useLocation } from 'react-router-dom'

export default function AttendanceTabs({ role, isManager }) {
  const nav = useNavigate()
  const loc = useLocation()
  const isMgmt = ['admin', 'management'].includes(role)
  const tabs = [
    { k: '/people/attendance', l: 'Dashboard' },
    { k: '/people/attendance/me', l: 'My Attendance' },
    { k: '/people/attendance/leave', l: 'Leave' },
    { k: '/people/attendance/regularize', l: 'Regularize' },
    { k: '/people/attendance/swipes', l: 'Swipes' },
    ...(isMgmt ? [{ k: '/people/attendance/muster', l: 'Muster' }] : []),
    ...(isMgmt ? [{ k: '/people/config?tab=attendance', l: 'Config' }] : []),
  ]
  const active = tabs.find(t => loc.pathname === t.k) || (loc.pathname.startsWith('/people/attendance/me') ? tabs[1] : null)
  return (
    <div className="ptabs2" style={{ marginBottom: 16 }}>
      {tabs.map(t => (
        <button key={t.k} className={'ptab2' + (active === t ? ' on' : '')} onClick={() => nav(t.k)}>{t.l}</button>
      ))}
    </div>
  )
}
