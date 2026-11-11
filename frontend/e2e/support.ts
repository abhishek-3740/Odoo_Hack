import { expect, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Shared helpers for the browser journeys.
 *
 * Sign-in goes through the demo-token endpoint and seeds the session directly,
 * because these tests are about the workflow rather than about the sign-in form
 * — that has its own test. The stored shape has to match `auth/session.ts`
 * exactly; if it drifts, every journey fails at the first navigation, which is
 * the right way to find out.
 */

const API = '/api/v1'
const SESSION_KEY = 'dealflow.session'

export const PERSONAS = {
  rep: 'rep.a@dealflow.demo',
  manager: 'manager.a@dealflow.demo',
  finance: 'finance@dealflow.demo',
  admin: 'admin@dealflow.demo',
  customer: 'alpha@customer.demo',
  customerBeta: 'beta@customer.demo',
} as const

export type Persona = keyof typeof PERSONAS

/**
 * Normalises a paged payload to the shape the screens use.
 *
 * This backend returns paged rows as `data: [...]` plus `meta.page/size/total`;
 * the Spring API these journeys were written against nests them as
 * `{ items, page, pageSize, totalItems, totalPages }`. The application client
 * already converts at its boundary; this helper does the same for tests that
 * arrange their scene through the API directly.
 */
function normalisePage(data: unknown, meta: Record<string, unknown> | undefined): unknown {
  if (!Array.isArray(data) || !meta) return data
  const page = meta.page
  const pageSize = meta.size
  const totalItems = meta.total
  if (typeof page !== 'number' || typeof pageSize !== 'number' || typeof totalItems !== 'number') {
    return data
  }
  return {
    items: data,
    page,
    pageSize,
    totalItems,
    totalPages: pageSize > 0 ? Math.ceil(totalItems / pageSize) : 0,
  }
}

/** Calls the API directly, asserting a useful message when it fails. */
export async function api<T>(
  request: APIRequestContext,
  path: string,
  init: { method?: string; token?: string; data?: unknown } = {},
): Promise<T> {
  const { method = init.data === undefined ? 'GET' : 'POST', token, data } = init
  const response = await request.fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    data: data as never,
  })
  const body = await response.text()
  expect(
    response.ok(),
    `${method} ${path} → ${response.status()} ${response.ok() ? '' : body}`,
  ).toBeTruthy()
  if (!body) return undefined as T
  const payload = JSON.parse(body) as { data?: unknown; meta?: Record<string, unknown> }
  return normalisePage(payload.data, payload.meta) as T
}

interface DemoAccount {
  email: string
  role: string
  token: string
}

let cachedTokens: Record<string, string> | null = null

export async function tokens(request: APIRequestContext): Promise<Record<string, string>> {
  if (cachedTokens) return cachedTokens
  const accounts = await api<DemoAccount[]>(request, '/auth/demo-accounts')
  cachedTokens = Object.fromEntries(accounts.map((account) => [account.email, account.token]))
  return cachedTokens
}

export async function tokenFor(request: APIRequestContext, persona: Persona): Promise<string> {
  const all = await tokens(request)
  const token = all[PERSONAS[persona]]
  expect(token, `No demo token for ${PERSONAS[persona]}`).toBeTruthy()
  return token
}

/** Seeds the session so the app boots straight into an authenticated route. */
export async function signIn(page: Page, token: string, path = '/'): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string)
    },
    [
      SESSION_KEY,
      JSON.stringify({ token, source: 'DEMO', email: null, expiresAt: null }),
    ],
  )
  await page.goto(path)
}

export async function signInAs(
  page: Page,
  request: APIRequestContext,
  persona: Persona,
  path = '/',
): Promise<void> {
  await signIn(page, await tokenFor(request, persona), path)
}

/**
 * Fails when the page scrolls sideways.
 *
 * Horizontal page overflow is a defect in this product, not a cosmetic issue —
 * it is what made every customer screen unusable on a tablet in the previous
 * frontend. A wide table is allowed to scroll inside its own container; the
 * document is not.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))
  expect(
    overflow.documentWidth,
    `Page scrolls horizontally: ${overflow.documentWidth}px of content in a ${overflow.viewportWidth}px viewport`,
  ).toBeLessThanOrEqual(overflow.viewportWidth + 1)
}

/** Collects console errors so a test can assert a screen rendered cleanly. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // A failed request the UI already reports inline is not a rendering defect.
    if (/Failed to load resource|net::ERR_|status of 40|status of 50/.test(text)) return
    // Nor is a refused WebSocket: the workspace shows "Not live" and falls back
    // to polling. Whether the backend's CORS allowlist includes this origin is
    // an environment question, and the connection indicator is what asserts it.
    if (/WebSocket connection to|WebSocket handshake/.test(text)) return
    errors.push(text)
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  return errors
}
