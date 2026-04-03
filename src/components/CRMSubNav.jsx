import { useNavigate, useLocation } from 'react-router-dom'
import '../styles/crm.css'

const ITEMS = [
  { key: 'dashboard',     label: 'Dashboard',     path: '/crm' },
  { key: 'companies',     label: 'Companies',     path: '/crm/companies' },
  { key: 'leads',         label: 'Leads',         path: '/crm/leads' },
  { key: 'opportunities', label: 'Opportunities', path: '/crm/opportunities' },
  { key: 'visits',        label: 'Field Visits',  path: '/crm/visits' },
  { key: 'samples',       label: 'Sample Requests', path: '/crm/samples' },
  { key: 'targets',       label: 'Targets',       path: '/crm/targets' },
]

export default function CRMSubNav({ active }) {
  const navigate  = useNavigate()
  const location  = useLocation()

  const current = active || ITEMS.find(i => i.path !== '/crm' && location.pathname.startsWith(i.path))?.key || 'dashboard'

  return (
    <div className="crm-subnav">
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
  )
}
