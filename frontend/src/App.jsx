import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoadingScreen } from './components/common/LoadingState';

// Layouts
import { CustomerLayout } from './layouts/CustomerLayout';
import { AdminLayout } from './layouts/AdminLayout';

// Auth Pages
import { LoginPage } from './pages/auth/LoginPage';

// Customer Pages
import { CustomerCatalogPage } from './pages/customer/CustomerCatalogPage';
import { CustomerQuotesPage } from './pages/customer/CustomerQuotesPage';
import { CustomerQuoteDetailPage } from './pages/customer/CustomerQuoteDetailPage';
import { CustomerInvoicesPage } from './pages/customer/CustomerInvoicesPage';

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

function RootRedirect() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === 'CUSTOMER') {
    return <Navigate to="/customer" replace />;
  }

  return <Navigate to="/admin" replace />;
}

// Protected route guard for Admin pages
function AdminGuard({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
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
          {/* Public Authentication */}
          <Route path="/login" element={<LoginPage />} />

          {/* Root Redirect */}
          <Route path="/" element={<RootRedirect />} />

          {/* Customer Facing Storefront & Portal */}
          <Route path="/customer" element={<CustomerLayout />}>
            <Route index element={<CustomerCatalogPage />} />
            <Route path="quotes" element={<CustomerQuotesPage />} />
            <Route path="quotes/:id" element={<CustomerQuoteDetailPage />} />
            <Route path="invoices" element={<CustomerInvoicesPage />} />
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

          {/* Catch-all fallback */}
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
