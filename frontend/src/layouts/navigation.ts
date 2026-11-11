import {
  Boxes,
  ClipboardCheck,
  FileSpreadsheet,
  Gauge,
  Landmark,
  LayoutGrid,
  type LucideIcon,
  MessagesSquare,
  Package,
  ReceiptText,
  ScrollText,
  Settings2,
  ShieldCheck,
  Users,
  Warehouse,
} from 'lucide-react'

import type { Me, Role } from '@/api'

/**
 * The staff navigation.
 *
 * Grouped by the question each area answers rather than by which controller
 * serves it. `roles` is the coarse filter that keeps a screen out of the menu
 * when it would only ever return 403 — the screens themselves still check their
 * own capabilities, because being *in* the menu is not permission.
 */

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Roles for whom this screen does something useful. */
  roles: Role[]
  /** Matches child routes too, for highlighting. */
  match?: (pathname: string) => boolean
  description?: string
}

export interface NavGroup {
  heading: string
  items: NavItem[]
}

const ALL_STAFF: Role[] = ['REP', 'MANAGER', 'FINANCE', 'ADMIN']

export const NAVIGATION: NavGroup[] = [
  {
    heading: 'Work',
    items: [
      {
        to: '/admin',
        label: 'Today',
        icon: Gauge,
        roles: ALL_STAFF,
        match: (path) => path === '/admin',
        description: 'What needs you now',
      },
      {
        to: '/admin/quotes',
        label: 'Quotations',
        icon: ScrollText,
        roles: ALL_STAFF,
        match: (path) => path.startsWith('/admin/quotes'),
      },
      {
        to: '/admin/customers',
        label: 'Customers',
        icon: Users,
        roles: ALL_STAFF,
        match: (path) => path.startsWith('/admin/customers'),
      },
    ],
  },
  {
    heading: 'Decisions',
    items: [
      {
        to: '/admin/approvals',
        label: 'Approvals',
        icon: ClipboardCheck,
        roles: ['MANAGER', 'FINANCE', 'ADMIN', 'REP'],
        description: 'Manager step 1, finance step 2',
      },
      {
        to: '/admin/reviews',
        label: 'Questions',
        icon: MessagesSquare,
        roles: ALL_STAFF,
        description: 'Escalations — not approvals',
      },
    ],
  },
  {
    heading: 'Delivery',
    items: [
      {
        to: '/admin/orders',
        label: 'Orders',
        icon: Package,
        roles: ALL_STAFF,
        match: (path) => path.startsWith('/admin/orders'),
      },
      {
        to: '/admin/inventory',
        label: 'Inventory',
        icon: Warehouse,
        roles: ['FINANCE', 'ADMIN', 'MANAGER'],
      },
    ],
  },
  {
    heading: 'Money',
    items: [
      {
        to: '/admin/billing',
        label: 'Billing',
        icon: ReceiptText,
        roles: ['FINANCE', 'ADMIN', 'MANAGER', 'REP'],
        match: (path) =>
          path.startsWith('/admin/billing') ||
          path.startsWith('/admin/invoices') ||
          path.startsWith('/admin/subscriptions'),
        description: 'Invoices, subscriptions, receipts',
      },
      {
        to: '/admin/reports',
        label: 'Reports',
        icon: FileSpreadsheet,
        roles: ALL_STAFF,
      },
    ],
  },
  {
    heading: 'Operate',
    items: [
      {
        to: '/admin/health',
        label: 'Deal health',
        icon: LayoutGrid,
        roles: ALL_STAFF,
      },
      {
        to: '/admin/catalog',
        label: 'Catalogue',
        icon: Boxes,
        roles: ['ADMIN', 'MANAGER', 'FINANCE'],
      },
      {
        to: '/admin/policy',
        label: 'Discount policy',
        icon: ShieldCheck,
        roles: ALL_STAFF,
      },
      {
        to: '/admin/people',
        label: 'People',
        icon: Landmark,
        roles: ['ADMIN'],
      },
      {
        to: '/admin/operations',
        label: 'Jobs',
        icon: Settings2,
        roles: ['FINANCE', 'ADMIN'],
      },
    ],
  },
]

export function visibleNavigation(me: Me | null): NavGroup[] {
  if (!me) return []
  return NAVIGATION.map((group) => ({
    heading: group.heading,
    items: group.items.filter((item) => item.roles.includes(me.role)),
  })).filter((group) => group.items.length > 0)
}

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.match) return item.match(pathname)
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}
