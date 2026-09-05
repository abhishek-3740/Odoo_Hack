import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoadingScreen } from './components/common/LoadingState';

// Layouts
import { CustomerLayout } from './layouts/CustomerLayout';
import { AdminLayout } from './layouts/AdminLayout';

// Public & Auth Pages
import { HomePage } from './pages/public/HomePage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';

// Customer Pages
import { CustomerDashboardPage } from './pages/customer/CustomerDashboardPage';
import { CustomerCatalogPage } from './pages/customer/CustomerCatalogPage';
import { CustomerQuotesPage } from './pages/customer/CustomerQuotesPage';
import { CustomerQuoteDetailPage } from './pages/customer/CustomerQuoteDetailPage';
import { CustomerInvoicesPage } from './pages/customer/CustomerInvoicesPage';
import { CustomerProfilePage } from './pages/customer/CustomerProfilePage';
import { CustomerSettingsPage } from './pages/customer/CustomerSettingsPage';

// Admin Pages
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage';
import { SalesQuotesPage } from './pages/admin/sales/SalesQuotesPage';
import { QuoteBuilderPage } from './pages/admin/sales/QuoteBuilderPage';
import { ManagerApprovalsPage } from './pages/admin/manager/ManagerApprovalsPage';
import { ManagerHealthPage } from './pages/admin/manager/ManagerHealthPage';
import { FinanceApprovalsPage } from './pages/admin/finance/FinanceApprovalsPage';
import { FulfillmentPage } from './pages/admin/finance/FulfillmentPage';
import { BillingPage } from './pages/admin/finance/BillingPage';
import { CatalogAdminPage } from './pages/admin/system/CatalogAdminPage';
import { GovernancePage } from './pages/admin/system/GovernancePage';
import { OperationsPage } from './pages/admin/system/OperationsPage';
import { AssistantDock } from './components/assistant/AssistantDock';
import { ReviewInboxPage } from './pages/admin/ReviewInboxPage';

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
        <Routes>
          {/* Public storefront & authentication */}
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

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
              <Route path="governance" element={<GovernancePage />} />
              <Route path="operations" element={<OperationsPage />} />
            </Route>
          </Route>

          {/* Catch-all fallback: the public storefront */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <AssistantDock />
      </BrowserRouter>
    </AuthProvider>
  );
}
