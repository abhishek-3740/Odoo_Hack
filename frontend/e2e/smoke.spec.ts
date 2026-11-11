import { expect, test } from '@playwright/test'

import {
  collectConsoleErrors,
  expectNoHorizontalOverflow,
  signInAs,
  type Persona,
} from './support'

/**
 * Every route renders, at every width the plan names.
 *
 * This is the test that would have caught both failures the previous frontend
 * shipped with: screens that rendered nothing, and a shared header that made
 * every customer page scroll sideways at tablet width.
 */

const WIDTHS = [
  { name: '320 (small phone)', width: 320, height: 720 },
  { name: '768 (tablet)', width: 768, height: 1024 },
  { name: '1024 (small laptop)', width: 1024, height: 800 },
  { name: '1440 (desktop)', width: 1440, height: 900 },
]

const STAFF_ROUTES = [
  '/admin',
  '/admin/quotes',
  '/admin/customers',
  '/admin/approvals',
  '/admin/reviews',
  '/admin/orders',
  '/admin/inventory',
  '/admin/billing',
  '/admin/health',
  '/admin/notifications',
  '/admin/reports',
  '/admin/catalog',
  '/admin/policy',
  '/admin/operations',
]

const CUSTOMER_ROUTES = [
  '/customer',
  '/customer/quotes',
  '/customer/invoices',
  '/customer/catalogue',
  '/customer/account',
]

const PUBLIC_ROUTES = ['/', '/catalogue', '/sign-in', '/sign-up', '/sign-up/team']

test.describe('public routes', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} renders with no page error`, async ({ page }) => {
      const errors = collectConsoleErrors(page)
      await page.goto(route)
      await expect(page.locator('main')).toBeVisible()
      // Something meaningful is on screen — not an empty shell.
      await expect(page.locator('h1').first()).toBeVisible()
      expect(errors, `Console errors on ${route}:\n${errors.join('\n')}`).toEqual([])
    })
  }
})

test.describe('staff routes', () => {
  for (const route of STAFF_ROUTES) {
    test(`${route} renders for an administrator`, async ({ page, request }) => {
      const errors = collectConsoleErrors(page)
      await signInAs(page, request, 'admin', route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      // The shell itself is present, so navigation is reachable.
      await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeAttached()
      expect(errors, `Console errors on ${route}:\n${errors.join('\n')}`).toEqual([])
    })
  }
})

test.describe('customer routes', () => {
  for (const route of CUSTOMER_ROUTES) {
    test(`${route} renders for a customer`, async ({ page, request }) => {
      const errors = collectConsoleErrors(page)
      await signInAs(page, request, 'customer', route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(errors, `Console errors on ${route}:\n${errors.join('\n')}`).toEqual([])
    })
  }
})

test.describe('no horizontal overflow', () => {
  const CHECKS: Array<{ persona: Persona; routes: string[] }> = [
    { persona: 'admin', routes: ['/admin', '/admin/quotes', '/admin/billing', '/admin/reports'] },
    { persona: 'customer', routes: CUSTOMER_ROUTES },
  ]

  for (const { persona, routes } of CHECKS) {
    for (const route of routes) {
      for (const viewport of WIDTHS) {
        test(`${route} at ${viewport.name}`, async ({ page, request }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
          await signInAs(page, request, persona, route)
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
          await expectNoHorizontalOverflow(page)
        })
      }
    }
  }

  for (const viewport of WIDTHS) {
    test(`the landing page at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    })
  }
})

test('a customer cannot reach the staff workspace', async ({ page, request }) => {
  await signInAs(page, request, 'customer', '/admin/quotes')
  await expect(page).toHaveURL(/\/customer/)
})

test('staff are sent to the workspace rather than the portal', async ({ page, request }) => {
  await signInAs(page, request, 'rep', '/customer/quotes')
  await expect(page).toHaveURL(/\/admin/)
})

test('a deep link survives sign-in', async ({ page }) => {
  await page.goto('/admin/quotes')
  await expect(page).toHaveURL(/\/sign-in/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('old quotation links still work', async ({ page, request }) => {
  await signInAs(page, request, 'admin', '/admin/sales/quotes')
  await expect(page).toHaveURL(/\/admin\/quotes$/)
  await expect(page.getByRole('heading', { name: 'Quotations' })).toBeVisible()
})
