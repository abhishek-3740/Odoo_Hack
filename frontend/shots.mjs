// Captures the screens for a visual review. Not part of the test suite.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3001'
const API = 'http://127.0.0.1:8080/api/v1'
const OUT = process.env.OUT ?? './shots'
mkdirSync(OUT, { recursive: true })

const accounts = await (await fetch(`${API}/auth/demo-accounts`)).json()
const tokens = Object.fromEntries(accounts.data.map((a) => [a.email, a.token]))

const rep = tokens['rep.a@dealflow.demo']
const admin = tokens['admin@dealflow.demo']
const customer = tokens['alpha@customer.demo']

// Find a quotation with something to look at.
const quotes = await (
  await fetch(`${API}/quotes?pageSize=20`, { headers: { Authorization: `Bearer ${rep}` } })
).json()
const quoteId = quotes.data.items[0]?.id

const portalQuotes = await (
  await fetch(`${API}/portal/quotes`, { headers: { Authorization: `Bearer ${customer}` } })
).json()
const portalQuoteId = portalQuotes.data?.[0]?.id

const SHOTS = [
  ['landing', null, '/', 1440, true],
  ['landing-mobile', null, '/', 390, true],
  ['catalogue-public', null, '/catalogue', 1440, false],
  ['sign-in', null, '/sign-in', 1440, false],
  ['staff-home', admin, '/admin', 1440, false],
  ['pipeline', admin, '/admin/quotes', 1440, false],
  ['approvals', admin, '/admin/approvals', 1440, false],
  ['orders', admin, '/admin/orders', 1440, false],
  ['inventory', admin, '/admin/inventory', 1440, false],
  ['reports', admin, '/admin/reports', 1440, true],
  ['catalog-admin', admin, '/admin/catalog', 1440, false],
  ['policy', admin, '/admin/policy', 1440, true],
  ['people', admin, '/admin/people', 1440, false],
  ['operations', admin, '/admin/operations', 1440, false],
  ['health', admin, '/admin/health', 1440, false],
  ['workspace', rep, quoteId ? `/admin/quotes/${quoteId}` : '/admin/quotes', 1440, true],
  ['workspace-tablet', rep, quoteId ? `/admin/quotes/${quoteId}` : '/admin/quotes', 768, false],
  ['customer-home', customer, '/customer', 1440, false],
  ['deal-room', customer, portalQuoteId ? `/customer/quotes/${portalQuoteId}` : '/customer/quotes', 1440, true],
  ['deal-room-mobile', customer, portalQuoteId ? `/customer/quotes/${portalQuoteId}` : '/customer/quotes', 390, false],
  ['customer-catalogue', customer, '/customer/catalogue', 1440, false],
  ['customer-invoices', customer, '/customer/invoices', 1440, false],
  ['billing', admin, '/admin/billing', 1440, false],
  ['reviews', admin, '/admin/reviews', 1440, false],
  ['notifications', admin, '/admin/notifications', 1440, false],
]

const browser = await chromium.launch()
for (const [name, token, path, width, full] of SHOTS) {
  const context = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 950 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  if (token) {
    await page.addInitScript(
      (value) => window.localStorage.setItem('dealflow.session', value),
      JSON.stringify({ token, source: 'DEMO', email: null, expiresAt: null }),
    )
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(1600)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full })
  console.log(`captured ${name}`)
  await context.close()
}
await browser.close()
console.log('done')
