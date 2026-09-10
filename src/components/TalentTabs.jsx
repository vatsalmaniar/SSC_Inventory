import { useNavigate, useLocation } from 'react-router-dom'

// Talent 360 sub-nav. Same .ptabs2/.ptab2 chrome as AttendanceTabs so the
// module reads as part of People 360 rather than a separate product.
//
// Every Talent route is admin/management-only (offered CTC is as sensitive as
// employee_compensation), so unlike AttendanceTabs there is nothing to gate
// per-tab — the whole module is gated once, in Layout's NAV_ITEMS and again in
// each page's own role check.
const TABS = [
  { k: '/talent',              l: 'Dashboard' },
  { k: '/talent/openings',     l: 'Openings' },
  { k: '/talent/pipeline',     l: 'Pipeline' },
  { k: '/talent/offers',       l: 'Offers' },
]

export default function TalentTabs() {
  const nav = useNavigate()
  const loc = useLocation()
  // Longest matching prefix wins, so /talent/openings does not also light up
  // /talent. A candidate detail page sits under the Pipeline tab.
  const active = loc.pathname.startsWith('/talent/candidates')
    ? '/talent/pipeline'
    : TABS.map(t => t.k).filter(k => loc.pathname === k || loc.pathname.startsWith(k + '/'))
        .sort((a, b) => b.length - a.length)[0] || '/talent'

  return (
    <div className="ptabs2" style={{ marginBottom: 16 }}>
      {TABS.map(t => (
        <button key={t.k} className={'ptab2' + (active === t.k ? ' on' : '')} onClick={() => nav(t.k)}>{t.l}</button>
      ))}
    </div>
  )
}
