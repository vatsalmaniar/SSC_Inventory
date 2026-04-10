import { useNavigate, useLocation } from 'react-router-dom'
import '../styles/crm.css'

const ITEMS = [
  { key: 'dashboard',  label: 'Dashboard',        path: '/billing' },
  { key: 'dispatch',   label: 'Dispatch Billing',  path: '/billing/list' },
  { key: 'inward',     label: 'Inward Billing',    path: '/procurement/invoices' },
]

export default function BillingSubNav({ active }) {
  const navigate = useNavigate()
  const location = useLocation()
  const current = active || ITEMS.find(i => i.path !== '/billing' && location.pathname.startsWith(i.path))?.key || 'dashboard'

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
