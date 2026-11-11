import { expect, test, type Page } from '@playwright/test'

import { api } from './support'

/**
 * The sign-in path itself.
 *
 * The workflow journeys seed a token because they are about the deal, not the
 * door. This suite is about the door: a stored credential the server rejects
 * must explain itself, a wrong password must not navigate, and a real local
 * account must be able to sign in and reach its own home.
 */

const SESSION_KEY = 'dealflow.session'

interface AuthToken {
  accessToken: string
  role: string
}

async function seedSession(
  page: Page,
  session: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SESSION_KEY, JSON.stringify(session)],
  )
}

test.describe('signing in', () => {
  test('a stored token the server rejects lands on sign-in and says why', async ({ page }) => {
    await seedSession(page, {
      token: 'not-a-jwt',
      source: 'LOCAL',
      email: null,
      expiresAt: null,
    })

    await page.goto('/admin')

    await expect(page).toHaveURL(/\/sign-in/)
    await expect(page.locator('div[role="status"]')).toHaveText(
      'Your saved sign-in is no longer valid. Sign in to continue.',
    )
  })

  test('an expired stored session says the previous session expired', async ({ page }) => {
    await seedSession(page, {
      token: 'not-a-jwt',
      source: 'LOCAL',
      email: null,
      expiresAt: Date.now() - 60_000,
    })

    await page.goto('/admin')

    await expect(page).toHaveURL(/\/sign-in/)
    await expect(page.locator('div[role="status"]')).toHaveText(
      'Your previous session expired. Sign in to continue.',
    )
  })

  test('a wrong password is reported in place, without navigating', async ({ page, request }) => {
    const email = `auth-e2e-${Date.now()}@example.com`
    await api<AuthToken>(request, '/auth/register', {
      data: {
        email,
        password: 'CorrectPassw0rd!',
        fullName: 'Auth E2E',
        companyName: 'Auth E2E Co',
      },
    })

    await page.goto('/sign-in')
    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[type="password"]').fill('definitely-wrong')
    await page.getByRole('button', { name: /^sign in$/i }).click()

    await expect(page.getByText('Invalid email or password.')).toBeVisible()
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('a registered customer can sign in and lands in the deal room', async ({ page, request }) => {
    const email = `auth-e2e-${Date.now()}@example.com`
    const company = 'Auth E2E Industries'
    await api<AuthToken>(request, '/auth/register', {
      data: {
        email,
        password: 'CorrectPassw0rd!',
        fullName: 'Auth E2E',
        companyName: company,
      },
    })

    await page.goto('/sign-in')
    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[type="password"]').fill('CorrectPassw0rd!')
    await page.getByRole('button', { name: /^sign in$/i }).click()

    await expect(page).toHaveURL(/\/customer$/)
    await expect(page.getByRole('heading', { name: 'Welcome back, Auth' })).toBeVisible()
    const stored = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_KEY)
    expect(stored).toBeTruthy()
  })
})
