import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Accounts from './pages/Accounts'
import Sales from './pages/Sales'
import Orders from './pages/Orders'
import OrdersList from './pages/OrdersList'
import NewOrder from './pages/NewOrder'
import OrderDetail from './pages/OrderDetail'
import OpsOrders from './pages/OpsOrders'
import TodayDispatch from './pages/TodayDispatch'
import CRM from './pages/CRM'
import NewLead from './pages/NewLead'
import LeadDetail from './pages/LeadDetail'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/list" element={<OrdersList />} />
        <Route path="/orders/new" element={<NewOrder />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/ops" element={<OpsOrders />} />
        <Route path="/dispatch/today" element={<TodayDispatch />} />
        <Route path="/crm" element={<CRM />} />
        <Route path="/crm/new" element={<NewLead />} />
        <Route path="/crm/:id" element={<LeadDetail />} />
      </Routes>
    </BrowserRouter>
  )
}
