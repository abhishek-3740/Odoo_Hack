import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoadingScreen } from './components/common/LoadingState';
const PeoplePage = lazy(() => import('./pages/admin/system/PeoplePage').then(m => ({ default: m.PeoplePage })));

// Layouts
import { CustomerLayout } from './layouts/CustomerLayout';
import { AdminLayout } from './layouts/AdminLayout';

// Public & Auth Pages
const HomePage = lazy(() => import('./pages/public/HomePage').then(m => ({ default: m.HomePage })));
const LandingPage = lazy(() => import('./pages/public/LandingPage').then(m => ({ default: m.LandingPage })));
const SalesReportPage = lazy(() => import('./pages/admin/SalesReportPage').then(m => ({ default: m.SalesReportPage })));
const PolicyEditor = lazy(() => import('./pages/admin/system/PolicyEditor').then(m => ({ default: m.PolicyEditor })));
const LoginPage = lazy(() => import('./pages/auth/LoginPage').then(m => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import('./pages/auth/SignupPage').then(m => ({ default: m.SignupPage })));
const StaffSignupPage = lazy(() => import('./pages/auth/StaffSignupPage').then(m => ({ default: m.StaffSignupPage })));
import { LandingPage } from './pages/landing/LandingPage';
import { HomePage } from './pages/public/HomePage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { StaffSignupPage } from './pages/auth/StaffSignupPage';

// Customer Pages
const CustomerDashboardPage = lazy(() => import('./pages/customer/CustomerDashboardPage').then(m => ({ default: m.CustomerDashboardPage })));
const CustomerCatalogPage = lazy(() => import('./pages/customer/CustomerCatalogPage').then(m => ({ default: m.CustomerCatalogPage })));
const CustomerQuotesPage = lazy(() => import('./pages/customer/CustomerQuotesPage').then(m => ({ default: m.CustomerQuotesPage })));
const CustomerQuoteDetailPage = lazy(() => import('./pages/customer/CustomerQuoteDetailPage').then(m => ({ default: m.CustomerQuoteDetailPage })));
const CustomerInvoicesPage = lazy(() => import('./pages/customer/CustomerInvoicesPage').then(m => ({ default: m.CustomerInvoicesPage })));
const CustomerProfilePage = lazy(() => import('./pages/customer/CustomerProfilePage').then(m => ({ default: m.CustomerProfilePage })));
const CustomerSettingsPage = lazy(() => import('./pages/customer/CustomerSettingsPage').then(m => ({ default: m.CustomerSettingsPage })));

// Admin Pages
const AdminOverviewPage = lazy(() => import('./pages/admin/AdminOverviewPage').then(m => ({ default: m.AdminOverviewPage })));
const SalesQuotesPage = lazy(() => import('./pages/admin/sales/SalesQuotesPage').then(m => ({ default: m.SalesQuotesPage })));
const QuoteBuilderPage = lazy(() => import('./pages/admin/sales/QuoteBuilderPage').then(m => ({ default: m.QuoteBuilderPage })));
const ManagerApprovalsPage = lazy(() => import('./pages/admin/manager/ManagerApprovalsPage').then(m => ({ default: m.ManagerApprovalsPage })));
const ManagerHealthPage = lazy(() => import('./pages/admin/manager/ManagerHealthPage').then(m => ({ default: m.ManagerHealthPage })));
const FinanceApprovalsPage = lazy(() => import('./pages/admin/finance/FinanceApprovalsPage').then(m => ({ default: m.FinanceApprovalsPage })));
const FulfillmentPage = lazy(() => import('./pages/admin/finance/FulfillmentPage').then(m => ({ default: m.FulfillmentPage })));
const BillingPage = lazy(() => import('./pages/admin/finance/BillingPage').then(m => ({ default: m.BillingPage })));
const CatalogAdminPage = lazy(() => import('./pages/admin/system/CatalogAdminPage').then(m => ({ default: m.CatalogAdminPage })));
const GovernancePage = lazy(() => import('./pages/admin/system/GovernancePage').then(m => ({ default: m.GovernancePage })));
const OperationsPage = lazy(() => import('./pages/admin/system/OperationsPage').then(m => ({ default: m.OperationsPage })));
import { AssistantDock } from './components/assistant/AssistantDock';
const ReviewInboxPage = lazy(() => import('./pages/admin/ReviewInboxPage').then(m => ({ default: m.ReviewInboxPage })));

// Protected route guard for Admin pages
function AdminGuard({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login?next=/admin" replace />;
  }

  // Allow internal roles to access admin
  if (user.role === 'CUSTOMER') {
    return <Navigate to="/customer" replace />;
  }

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<LoadingScreen />}><Routes>
          {/* Public storefront & authentication */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/catalog" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/signup/staff" element={<StaffSignupPage />} />

          {/* Customer Portal (guarded inside the layout) */}
          <Route path="/customer" element={<CustomerLayout />}>
            <Route index element={<CustomerDashboardPage />} />
            <Route path="catalog" element={<CustomerCatalogPage />} />
            <Route path="quotes" element={<CustomerQuotesPage />} />
            <Route path="quotes/:id" element={<CustomerQuoteDetailPage />} />
            <Route path="invoices" element={<CustomerInvoicesPage />} />
            <Route path="profile" element={<CustomerProfilePage />} />
            <Route path="settings" element={<CustomerSettingsPage />} />
          </Route>

          {/* Enterprise Internal Workspace */}
          <Route
            path="/admin"
            element={
              <AdminGuard>
                <AdminLayout />
              </AdminGuard>
            }
          >
            <Route index element={<AdminOverviewPage />} />
            <Route path="reviews" element={<ReviewInboxPage />} />
            <Route path="reports" element={<SalesReportPage />} />

            {/* Sales Workspace */}
            <Route path="sales">
              <Route path="quotes" element={<SalesQuotesPage />} />
              <Route path="quotes/new" element={<SalesQuotesPage />} />
              <Route path="quotes/:id" element={<QuoteBuilderPage />} />
            </Route>

            {/* Manager Workspace */}
            <Route path="manager">
              <Route path="approvals" element={<ManagerApprovalsPage />} />
              <Route path="health" element={<ManagerHealthPage />} />
            </Route>

            {/* Finance & Operations Workspace */}
            <Route path="finance">
              <Route path="approvals" element={<FinanceApprovalsPage />} />
              <Route path="fulfillment" element={<FulfillmentPage />} />
              <Route path="billing" element={<BillingPage />} />
            </Route>

            {/* System Administration & Settings */}
            <Route path="system">
              <Route path="catalog" element={<CatalogAdminPage />} />
              <Route path="governance" element={<PolicyEditor />} />
              <Route path="people" element={<PeoplePage />} />
              <Route path="operations" element={<OperationsPage />} />
            </Route>
          </Route>

          {/* Catch-all fallback: the public storefront */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes></Suspense>
        <AssistantDock />
      </BrowserRouter>
    </AuthProvider>
  );
}
