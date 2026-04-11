import { useNavigate, useLocation } from 'react-router-dom'
import '../styles/crm.css'

const ITEMS = [
  { key: 'dashboard',     label: 'Dashboard',     path: '/crm' },
  { key: 'opportunities', label: 'Opportunities', path: '/crm/opportunities' },
  { key: 'visits',        label: 'Field Visits',  path: '/crm/visits' },
]

export default function CRMSubNav({ active, onAdd }) {
  const navigate = useNavigate()
  const location = useLocation()
  const current = active || ITEMS.find(i => i.path !== '/crm' && location.pathname.startsWith(i.path))?.key || 'dashboard'

  const addLabel = current === 'visits' ? '+ Log Visit' : '+ New'
  const handleAdd = onAdd || (() => navigate('/crm/opportunities/new'))

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
      {onAdd && (
        <button
          className="crm-btn crm-btn-primary"
          style={{ margin:'0 16px', fontSize:12, padding:'5px 14px' }}
          onClick={onAdd}
        >
          {addLabel}
        </button>
      )}
    </div>
  )
}
