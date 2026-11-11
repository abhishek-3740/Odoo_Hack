import { lazy, Suspense, type ComponentType } from 'react'
import { createBrowserRouter, Navigate, useParams } from 'react-router-dom'

import { LoadingPanel } from '@/design-system'
import { AppShell } from '@/layouts/AppShell'
import { CustomerShell } from '@/layouts/CustomerShell'
import { PublicShell } from '@/layouts/PublicShell'

import { RedirectIfSignedIn, RequireAuth, RequireRole } from './guards'
import { NotFoundPage, RouteBoundary } from './RouteBoundary'

/**
 * The route tree.
 *
 * Three URL families are preserved from the previous frontend — public,
 * `/admin/*` and `/customer/*` — so existing links keep working, and the older
 * nested paths redirect rather than 404. Everything private is lazy: the landing
 * page is the first thing most visitors load and should not carry the workspace.
 */

/** Wraps a lazily-loaded screen in a suspense fallback sized like the screen. */
function lazyRoute(loader: () => Promise<{ default: ComponentType }>) {
  const Component = lazy(loader)
  return (
    <Suspense fallback={<LoadingPanel rows={6} className="m-4" />}>
      <Component />
    </Suspense>
  )
}

/** Carries a legacy `:id` through to its replacement route. */
function RedirectWithId({ to }: { to: (id: string) => string }) {
  const params = useParams()
  return <Navigate to={to(params.id ?? '')} replace />
}

export const router = createBrowserRouter([
  // ------------------------------------------------------------- public
  {
    element: <PublicShell />,
    errorElement: <RouteBoundary />,
    children: [
      { index: true, element: lazyRoute(() => import('@/features/marketing/LandingPage')) },
      {
        path: 'catalogue',
        element: lazyRoute(() => import('@/features/catalog/PublicCataloguePage')),
      },
    ],
  },

  // ------------------------------------------------------------ identity
  {
    element: <RedirectIfSignedIn />,
    errorElement: <RouteBoundary />,
    children: [
      { path: 'sign-in', element: lazyRoute(() => import('@/features/identity/SignInPage')) },
      { path: 'sign-up', element: lazyRoute(() => import('@/features/identity/SignUpPage')) },
      {
        path: 'sign-up/team',
        element: lazyRoute(() => import('@/features/identity/InternalSignUpPage')),
      },
    ],
  },

  // --------------------------------------------------------------- staff
  {
    element: <RequireAuth />,
    errorElement: <RouteBoundary />,
    children: [
      {
        element: <RequireRole roles={['REP', 'MANAGER', 'FINANCE', 'ADMIN']} />,
        children: [
          {
            path: 'admin',
            element: <AppShell />,
            errorElement: <RouteBoundary />,
            children: [
              { index: true, element: lazyRoute(() => import('@/features/home/StaffHomePage')) },

              // customers
              {
                path: 'customers',
                element: lazyRoute(() => import('@/features/customers/CustomerListPage')),
              },
              {
                path: 'customers/:customerId',
                element: lazyRoute(() => import('@/features/customers/CustomerDetailPage')),
              },

              // quotations
              {
                path: 'quotes',
                element: lazyRoute(() => import('@/features/quotes/PipelinePage')),
              },
              {
                path: 'quotes/:quoteId',
                element: lazyRoute(() => import('@/features/quotes/DealWorkspacePage')),
              },

              // decisions
              {
                path: 'approvals',
                element: lazyRoute(() => import('@/features/approvals/ApprovalInboxPage')),
              },
              {
                path: 'approvals/:approvalRequestId',
                element: lazyRoute(() => import('@/features/approvals/ApprovalDetailPage')),
              },
              {
                path: 'reviews',
                element: lazyRoute(() => import('@/features/escalations/ReviewInboxPage')),
              },

              // orders and stock
              { path: 'orders', element: lazyRoute(() => import('@/features/orders/OrderListPage')) },
              {
                path: 'orders/:orderId',
                element: lazyRoute(() => import('@/features/orders/OrderDetailPage')),
              },
              {
                path: 'inventory',
                element: lazyRoute(() => import('@/features/inventory/InventoryPage')),
              },

              // billing
              {
                path: 'billing',
                element: lazyRoute(() => import('@/features/billing/BillingPage')),
              },
              {
                path: 'invoices/:invoiceId',
                element: lazyRoute(() => import('@/features/billing/InvoiceDetailPage')),
              },
              {
                path: 'subscriptions/:subscriptionId',
                element: lazyRoute(() => import('@/features/billing/SubscriptionDetailPage')),
              },

              // insight and administration
              { path: 'health', element: lazyRoute(() => import('@/features/health/HealthPage')) },
              {
                path: 'notifications',
                element: lazyRoute(() => import('@/features/health/NotificationsPage')),
              },
              { path: 'reports', element: lazyRoute(() => import('@/features/reports/ReportsPage')) },
              {
                path: 'catalog',
                element: lazyRoute(() => import('@/features/catalog/CatalogAdminPage')),
              },
              { path: 'policy', element: lazyRoute(() => import('@/features/policy/PolicyPage')) },
              { path: 'people', element: lazyRoute(() => import('@/features/people/PeoplePage')) },
              {
                path: 'operations',
                element: lazyRoute(() => import('@/features/operations/OperationsPage')),
              },

              // legacy paths from the previous frontend
              { path: 'sales/quotes', element: <Navigate to="/admin/quotes" replace /> },
              {
                path: 'sales/quotes/:id',
                element: <RedirectWithId to={(id) => `/admin/quotes/${id}`} />,
              },
              { path: 'manager/approvals', element: <Navigate to="/admin/approvals" replace /> },
              { path: 'finance/approvals', element: <Navigate to="/admin/approvals" replace /> },
              { path: 'manager/health', element: <Navigate to="/admin/health" replace /> },
              { path: 'finance/invoices', element: <Navigate to="/admin/billing" replace /> },
              { path: 'finance/billing', element: <Navigate to="/admin/billing" replace /> },
              { path: 'finance/fulfillment', element: <Navigate to="/admin/orders" replace /> },
              { path: 'system/catalog', element: <Navigate to="/admin/catalog" replace /> },
              { path: 'system/operations', element: <Navigate to="/admin/operations" replace /> },
              { path: 'system/governance', element: <Navigate to="/admin/policy" replace /> },
              { path: 'system/people', element: <Navigate to="/admin/people" replace /> },
            ],
          },
        ],
      },

      // ------------------------------------------------------- customer
      {
        element: <RequireRole roles={['CUSTOMER']} />,
        children: [
          {
            path: 'customer',
            element: <CustomerShell />,
            errorElement: <RouteBoundary />,
            children: [
              { index: true, element: lazyRoute(() => import('@/features/portal/CustomerHomePage')) },
              {
                path: 'catalogue',
                element: lazyRoute(() => import('@/features/portal/CustomerCataloguePage')),
              },
              {
                path: 'quotes',
                element: lazyRoute(() => import('@/features/portal/CustomerQuotesPage')),
              },
              {
                path: 'quotes/:quoteId',
                element: lazyRoute(() => import('@/features/portal/DealRoomPage')),
              },
              {
                path: 'invoices',
                element: lazyRoute(() => import('@/features/portal/CustomerInvoicesPage')),
              },
              {
                path: 'invoices/:invoiceId',
                element: lazyRoute(() => import('@/features/portal/CustomerInvoiceDetailPage')),
              },
              {
                path: 'account',
                element: lazyRoute(() => import('@/features/portal/CustomerAccountPage')),
              },
            ],
          },
        ],
      },
    ],
  },

  { path: '*', element: <NotFoundPage /> },
])
