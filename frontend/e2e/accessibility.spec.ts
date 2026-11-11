import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { signInAs } from './support'

/**
 * Automated accessibility checks.
 *
 * These catch a real class of defect — an unlabelled control, a colour-only
 * state, a heading order that makes a screen unnavigable — but they are a floor,
 * not a ceiling. The keyboard checks below cover the parts axe cannot see.
 */

const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

test.describe('axe', () => {
  test('the landing page', async ({ page }) => {
    await page.goto('/')
    const results = await new AxeBuilder({ page }).withTags(RULES).analyze()
    expect(results.violations, describe(results.violations)).toEqual([])
  })

  test('the sign-in page', async ({ page }) => {
    await page.goto('/sign-in')
    const results = await new AxeBuilder({ page }).withTags(RULES).analyze()
    expect(results.violations, describe(results.violations)).toEqual([])
  })

  test('the staff pipeline', async ({ page, request }) => {
    await signInAs(page, request, 'admin', '/admin/quotes')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const results = await new AxeBuilder({ page }).withTags(RULES).analyze()
    expect(results.violations, describe(results.violations)).toEqual([])
  })

  test('the customer deal room list', async ({ page, request }) => {
    await signInAs(page, request, 'customer', '/customer/quotes')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const results = await new AxeBuilder({ page }).withTags(RULES).analyze()
    expect(results.violations, describe(results.violations)).toEqual([])
  })
})

test.describe('keyboard', () => {
  test('a dialog traps focus and returns it on close', async ({ page, request }) => {
    await signInAs(page, request, 'admin', '/admin/quotes')
    const trigger = page.getByRole('button', { name: 'New quotation' })
    await trigger.focus()
    await page.keyboard.press('Enter')

    await expect(page.getByRole('dialog')).toBeVisible()

    // Focus is inside the dialog, not left behind on the page.
    const insideDialog = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]')
      return dialog?.contains(document.activeElement) ?? false
    })
    expect(insideDialog, 'Focus stayed outside the dialog').toBe(true)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('the skip link reaches the main content', async ({ page, request }) => {
    await signInAs(page, request, 'admin', '/admin')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Dispatch the first Tab to the body, which reliably holds page focus.
    await page.locator('body').press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to main content' })
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#workspace-main')).toBeVisible()
  })

  test('every select is reachable by its own label', async ({ page, request }) => {
    // A `<select>` nested inside its `<label>` pulls every option's text into
    // the accessible name. This asserts the labels are wired with htmlFor/id.
    await signInAs(page, request, 'admin', '/admin/quotes')
    await expect(page.getByLabel('Stage', { exact: true })).toBeVisible()
    await signInAs(page, request, 'admin', '/admin/health')
    await expect(page.getByLabel('Status', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Type', { exact: true })).toBeVisible()
  })
})

test('the workspace reports its live-connection state rather than hiding it', async ({
  page,
  request,
}) => {
  await signInAs(page, request, 'admin', '/admin')
  // One of the three states is always shown, so a user waiting on someone
  // else's approval knows whether this screen is actually listening.
  await expect(page.getByText(/Live connection: (Live|Reconnecting|Not live)/)).toBeAttached()
})

function describe(violations: Array<{ id: string; description: string; nodes: unknown[] }>): string {
  if (violations.length === 0) return ''
  return violations
    .map((violation) => `${violation.id}: ${violation.description} (${violation.nodes.length} nodes)`)
    .join('\n')
}
