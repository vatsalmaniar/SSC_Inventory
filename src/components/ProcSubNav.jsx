import { useNavigate, useLocation } from 'react-router-dom'
import '../styles/crm.css'

const ITEMS = [
  { key: 'dashboard',  label: 'Dashboard',       path: '/procurement' },
  { key: 'po',         label: 'Purchase Orders',  path: '/procurement/po' },
  { key: 'co',         label: 'CO Orders',        path: '/procurement/orders' },
]

export default function ProcSubNav({ active }) {
  const navigate = useNavigate()
  const location = useLocation()
  const current = active || ITEMS.find(i => i.path !== '/procurement' && location.pathname.startsWith(i.path))?.key || 'dashboard'

  return (
    <div className="crm-subnav" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
      <div style={{ display:'flex', gap:2 }}>
        {ITEMS.map(item => (
          <button
            key={item.key}
            className={'crm-subnav-item' + (current === item.key ? ' active' : '')}
            onClick={() => navigate(item.path)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
