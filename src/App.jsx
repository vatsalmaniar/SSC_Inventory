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
import CustomerMaster from './pages/CustomerMaster'
import CustomerDetail from './pages/CustomerDetail'
import NewCustomer from './pages/NewCustomer'
import CRMDashboard from './pages/CRMDashboard'
import CRMCompanies from './pages/CRMCompanies'
import CRMCompanyDetail from './pages/CRMCompanyDetail'
import CRMLeads from './pages/CRMLeads'
import CRMLeadDetail from './pages/CRMLeadDetail'
import CRMNewLead from './pages/CRMNewLead'
import CRMOpportunities from './pages/CRMOpportunities'
import CRMOpportunityDetail from './pages/CRMOpportunityDetail'
import CRMNewOpportunity from './pages/CRMNewOpportunity'
import CRMFieldVisits from './pages/CRMFieldVisits'
import CRMSampleRequests from './pages/CRMSampleRequests'
import CRMTargets from './pages/CRMTargets'
import FCDashboard from './pages/FCDashboard'
import FCModule from './pages/FCModule'
import FCOrderDetail from './pages/FCOrderDetail'
import BillingDashboard from './pages/BillingDashboard'
import BillingList from './pages/BillingList'
import BillingOrderDetail from './pages/BillingOrderDetail'

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
        <Route path="/customers" element={<CustomerMaster />} />
        <Route path="/customers/new" element={<NewCustomer />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/crm" element={<CRMDashboard />} />
        <Route path="/crm/companies" element={<CRMCompanies />} />
        <Route path="/crm/companies/:id" element={<CRMCompanyDetail />} />
        <Route path="/crm/leads" element={<CRMLeads />} />
        <Route path="/crm/leads/new" element={<CRMNewLead />} />
        <Route path="/crm/leads/:id" element={<CRMLeadDetail />} />
        <Route path="/crm/opportunities" element={<CRMOpportunities />} />
        <Route path="/crm/opportunities/new" element={<CRMNewOpportunity />} />
        <Route path="/crm/opportunities/:id" element={<CRMOpportunityDetail />} />
        <Route path="/crm/visits" element={<CRMFieldVisits />} />
        <Route path="/crm/samples" element={<CRMSampleRequests />} />
        <Route path="/crm/targets" element={<CRMTargets />} />
        <Route path="/fc" element={<FCDashboard />} />
        <Route path="/fc/list" element={<FCModule />} />
        <Route path="/fc/:id" element={<FCOrderDetail />} />
        <Route path="/billing" element={<BillingDashboard />} />
        <Route path="/billing/list" element={<BillingList />} />
        <Route path="/billing/:id" element={<BillingOrderDetail />} />
      </Routes>
    </BrowserRouter>
  )
}
