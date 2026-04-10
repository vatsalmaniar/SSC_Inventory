import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'

// Login stays eager — it's the entry point
import Login from './pages/Login'

// Lazy-load everything else — each page downloads only when navigated to
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Accounts = lazy(() => import('./pages/Accounts'))
const Sales = lazy(() => import('./pages/Sales'))
const Orders = lazy(() => import('./pages/Orders'))
const OrdersList = lazy(() => import('./pages/OrdersList'))
const NewOrder = lazy(() => import('./pages/NewOrder'))
const OrderDetail = lazy(() => import('./pages/OrderDetail'))
const OpsOrders = lazy(() => import('./pages/OpsOrders'))
const TodayDispatch = lazy(() => import('./pages/TodayDispatch'))
const CustomerMaster = lazy(() => import('./pages/CustomerMaster'))
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'))
const NewCustomer = lazy(() => import('./pages/NewCustomer'))
const CRMDashboard = lazy(() => import('./pages/CRMDashboard'))
const CRMCompanies = lazy(() => import('./pages/CRMCompanies'))
const CRMCompanyDetail = lazy(() => import('./pages/CRMCompanyDetail'))
const CRMLeads = lazy(() => import('./pages/CRMLeads'))
const CRMLeadDetail = lazy(() => import('./pages/CRMLeadDetail'))
const CRMNewLead = lazy(() => import('./pages/CRMNewLead'))
const CRMOpportunities = lazy(() => import('./pages/CRMOpportunities'))
const CRMOpportunityDetail = lazy(() => import('./pages/CRMOpportunityDetail'))
const CRMNewOpportunity = lazy(() => import('./pages/CRMNewOpportunity'))
const CRMFieldVisits = lazy(() => import('./pages/CRMFieldVisits'))
const CRMSampleRequests = lazy(() => import('./pages/CRMSampleRequests'))
const CRMTargets = lazy(() => import('./pages/CRMTargets'))
const VendorMaster = lazy(() => import('./pages/VendorMaster'))
const NewVendor = lazy(() => import('./pages/NewVendor'))
const VendorDetail = lazy(() => import('./pages/VendorDetail'))
const ProcurementDashboard = lazy(() => import('./pages/ProcurementDashboard'))
const PurchaseOrderList = lazy(() => import('./pages/PurchaseOrderList'))
const NewPurchaseOrder = lazy(() => import('./pages/NewPurchaseOrder'))
const PurchaseOrderDetail = lazy(() => import('./pages/PurchaseOrderDetail'))
const ProcurementOrders = lazy(() => import('./pages/ProcurementOrders'))
const GRNList = lazy(() => import('./pages/GRNList'))
const NewGRN = lazy(() => import('./pages/NewGRN'))
const GRNDetail = lazy(() => import('./pages/GRNDetail'))
const PurchaseInvoiceList = lazy(() => import('./pages/PurchaseInvoiceList'))
const PurchaseInvoiceDetail = lazy(() => import('./pages/PurchaseInvoiceDetail'))
const FCDashboard = lazy(() => import('./pages/FCDashboard'))
const FCModule = lazy(() => import('./pages/FCModule'))
const FCOrderDetail = lazy(() => import('./pages/FCOrderDetail'))
const BillingDashboard = lazy(() => import('./pages/BillingDashboard'))
const BillingList = lazy(() => import('./pages/BillingList'))
const BillingOrderDetail = lazy(() => import('./pages/BillingOrderDetail'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontFamily:'DM Sans,sans-serif',color:'#888'}}>Loading...</div>}>
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
          <Route path="/vendors" element={<VendorMaster />} />
          <Route path="/vendors/new" element={<NewVendor />} />
          <Route path="/vendors/:id" element={<VendorDetail />} />
          <Route path="/procurement" element={<ProcurementDashboard />} />
          <Route path="/procurement/po" element={<PurchaseOrderList />} />
          <Route path="/procurement/po/new" element={<NewPurchaseOrder />} />
          <Route path="/procurement/po/:id" element={<PurchaseOrderDetail />} />
          <Route path="/procurement/orders" element={<ProcurementOrders />} />
          <Route path="/procurement/grn" element={<Navigate to="/fc/grn" replace />} />
          <Route path="/procurement/grn/new" element={<Navigate to="/fc/grn/new" replace />} />
          <Route path="/procurement/invoices" element={<PurchaseInvoiceList />} />
          <Route path="/procurement/invoices/:id" element={<PurchaseInvoiceDetail />} />
          <Route path="/fc" element={<FCDashboard />} />
          <Route path="/fc/list" element={<FCModule />} />
          <Route path="/fc/grn" element={<GRNList />} />
          <Route path="/fc/grn/new" element={<NewGRN />} />
          <Route path="/fc/grn/:id" element={<GRNDetail />} />
          <Route path="/fc/:id" element={<FCOrderDetail />} />
          <Route path="/billing" element={<BillingDashboard />} />
          <Route path="/billing/list" element={<BillingList />} />
          <Route path="/billing/:id" element={<BillingOrderDetail />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
