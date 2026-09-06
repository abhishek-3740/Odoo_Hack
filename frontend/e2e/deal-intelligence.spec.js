import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Run only against the disposable, seeded UI-test backend described in docs.
const apiUrl = process.env.UI_TEST_API || 'http://127.0.0.1:8082/api/v1';
async function call(request, token, path, data, method = data === undefined ? 'GET' : 'POST') {
  const response = await request.fetch(`${apiUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}) }, data });
  expect(response.ok(), `${method} ${path}: ${response.status()} ${response.ok() ? '' : await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function login(page, token, path) {
  await page.addInitScript(value => localStorage.setItem('dealflow_token', value), token);
  await page.goto(path);
  await expect(page.getByRole('button', { name: 'Ask DealFlow' })).toBeVisible();
}
async function setup(request) {
  const accounts = await call(request, '', '/auth/demo-accounts');
  const tokens = Object.fromEntries(accounts.map(a => [a.email, a.token]));
  const rep = tokens['rep.a@dealflow.demo'];
  const customers = await call(request, rep, '/customers?pageSize=100');
  const customer = customers.items.find(c => c.name === 'Alpha Traders');
  const products = await call(request, rep, '/products?pageSize=100');
  const product = products.items.find(p => p.code === 'LAPTOP');
  const variants = await call(request, rep, `/variants?productId=${product.id}`);
  const variant = variants.find(v => v.sku === 'LAPTOP-14');
  const draft = await call(request, rep, '/quotes', { customerId: customer.id, title: `Browser check ${Date.now()}` });
  const quote = await call(request, rep, `/quotes/${draft.quoteId}/revisions`, { expectedRowVersion: draft.rowVersion, lines: [{ lineKey: 'laptop', variantId: variant.id, quantity: 2, lineDiscountBp: 100 }], orderDiscountBp: 200, backorderTerms: 'ALLOW_BACKORDER' });
  return { tokens, rep, quote };
}

test('upgrade, review routing and finance resolution use the real backend', async ({ page, request }) => {
  const { tokens, rep, quote } = await setup(request);
  const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
  await login(page, rep, `/admin/sales/quotes/${quote.quoteId}`);
  await expect(page.getByRole('heading', { name: 'Make this deal work harder' })).toBeVisible();
  await page.getByRole('button', { name: 'Upsell · Upgrade an item' }).click();
  await expect(page.getByRole('button', { name: 'Apply upgrade' }).first()).toBeEnabled();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Quote overflows at ${width}`).toBeTruthy();
  }
  await page.locator('#recommendations-title').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/quote-opportunities-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Apply upgrade' }).first().click();
  await expect(page.getByRole('button', { name: 'Apply upgrade' })).toHaveCount(0);
  const updated = await call(request, rep, `/quotes/${quote.quoteId}`);
  expect(updated.lines[0].variantId).not.toBe(quote.lines[0].variantId);
  expect(Number(updated.lines[0].quantity)).toBe(2);
  await page.getByRole('link', { name: 'Need a decision?' }).click();
  await page.getByRole('button', { name: 'Raise a review' }).click();
  await page.getByLabel('Context for your reviewer').fill(`Review a possible discount for ${quote.reference}.`);
  await page.getByRole('button', { name: 'Send for review', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText(`Review a possible discount for ${quote.reference}.`, { exact: true })).toBeVisible();
  const cases = await call(request, rep, '/escalations');
  expect(cases.find(c => c.quoteId === quote.quoteId).targetRole).toBe('FINANCE');
  await login(page, tokens['finance@dealflow.demo'], '/admin/reviews');
  const row = page.locator('.review-case').filter({ hasText: quote.reference });
  await row.getByRole('button', { name: 'Record resolution' }).click();
  await page.getByLabel('Resolution', { exact: true }).fill('Submit revised terms for the required sequential approval.');
  await page.getByRole('button', { name: 'Resolve case', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Resolved', exact: true }).click();
  await expect(page.locator('.review-case').filter({ hasText: quote.reference })).toContainText('Submit revised terms');
  expect(pageErrors).toEqual([]);
});

test('cross-sell adds a real line and unsaved edits block recommendation writes', async ({ page, request }) => {
  const { rep, quote } = await setup(request);
  await login(page, rep, `/admin/sales/quotes/${quote.quoteId}`);
  const add = page.getByRole('button', { name: 'Add & save' }).first();
  await expect(add).toBeEnabled();
  // Discounts are entered as percentages everywhere; 2.5% is 250 basis points.
  await page.getByLabel('Order Discount %').fill('2.5');
  await expect(add).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save Revision' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save Revision' }).click();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByText('Line Items Cart (2)')).toBeVisible();
  const current = await call(request, rep, `/quotes/${quote.quoteId}`);
  expect(current.lines).toHaveLength(2);
  expect(current.orderDiscountBp).toBe(250);
  const dismiss = page.getByRole('button', { name: /^Dismiss / }).first();
  if (await dismiss.count()) {
    const name = await dismiss.getAttribute('aria-label');
    await dismiss.click(); await page.reload();
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
});

test('assistant reports provider errors and retries without mutating the deal', async ({ page, request }) => {
  const { rep, quote } = await setup(request);
  await login(page, rep, `/admin/sales/quotes/${quote.quoteId}`);
  let attempts = 0;
  await page.route('**/api/v1/assistant/chat', route => {
    attempts++;
    return route.fulfill(attempts === 1
      ? { status: 503, json: { error: { message: 'Provider temporarily unavailable' } } }
      : { json: { data: { answer: 'Your quote remains unchanged.', scope: 'Current quotation', generatedAt: new Date().toISOString() } } });
  });
  await page.getByRole('button', { name: 'Ask DealFlow' }).click();
  await page.getByRole('button', { name: 'What should I do next on this deal?' }).click();
  await expect(page.getByRole('alert')).toContainText('Provider temporarily unavailable');
  await page.getByRole('button', { name: 'Retry message' }).click();
  await expect(page.locator('.assistant-message.assistant')).toContainText('Your quote remains unchanged.');
  expect((await call(request, rep, `/quotes/${quote.quoteId}`)).revisionId).toBe(quote.revisionId);
});

test('customer AI handoff, keyboard access and responsive review inbox', async ({ page, request }) => {
  const { tokens, rep, quote } = await setup(request);
  await call(request, rep, `/quotes/${quote.quoteId}/submissions`, { expectedRevisionId: quote.revisionId, expectedRowVersion: quote.rowVersion });
  await call(request, rep, `/quotes/${quote.quoteId}/shares`, {});
  await login(page, tokens['alpha@customer.demo'], `/customer/quotes/${quote.quoteId}`);
  // Deterministic UI response. Sarvam itself is verified separately through the real API.
  await page.route('**/api/v1/assistant/chat', route => route.fulfill({ json: { data: { answer: 'Ask your salesperson to review a 3% discount. A new quote needs approval and acceptance.', scope: 'Current quotation', generatedAt: new Date().toISOString() } } }));
  await page.getByRole('button', { name: 'Ask DealFlow' }).click();
  await expect(page.getByLabel('Message your assistant')).toBeFocused();
  await page.getByLabel('Message your assistant').fill('Could you review a 3% discount for me?');
  await page.getByRole('dialog', { name: 'Your DealFlow assistant' }).getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.assistant-message.assistant')).toContainText('Ask your salesperson');
  await page.getByRole('button', { name: 'Send my last question to salesperson' }).click();
  await expect(page.getByText('Your question was sent to your salesperson. It is now in your deal room.')).toBeVisible();
  const requests = await call(request, rep, `/quotes/${quote.quoteId}/requests`);
  expect(requests.some(r => r.message === 'Could you review a 3% discount for me?')).toBeTruthy();
  const a11y = await new AxeBuilder({ page }).include('.assistant-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(a11y.violations).toEqual([]);
  await page.screenshot({ path: 'test-results/customer-assistant-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Ask DealFlow' })).toBeFocused();
  await login(page, rep, '/admin/reviews');
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: 'Review inbox', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.getByRole('button', { name: 'Ask DealFlow' }).click();
    expect(await page.locator('.assistant-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    if (width === 320) await page.screenshot({ path: 'test-results/assistant-mobile.png' });
    await page.keyboard.press('Escape');
  }
});

test('customer sees cross-sell and upsell and sends a request without changing quote terms', async ({ page,request }) => {
  const {tokens,rep,quote}=await setup(request);
  await call(request,rep,`/quotes/${quote.quoteId}/submissions`,{expectedRevisionId:quote.revisionId,expectedRowVersion:quote.rowVersion});
  await call(request,rep,`/quotes/${quote.quoteId}/shares`,{});
  await login(page,tokens['alpha@customer.demo'],`/customer/quotes/${quote.quoteId}`);
  await expect(page.getByRole('heading',{name:'A better fit for your team'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Request add-on'}).first()).toBeVisible();
  await page.getByRole('button',{name:'Upsell · Upgrades',exact:true}).click();
  await expect(page.getByRole('button',{name:'Request upgrade'}).first()).toBeVisible();
  await page.getByRole('button',{name:'Request upgrade'}).first().click();
  await expect(page.getByText('Request sent to your salesperson. Follow the discussion in your deal room.')).toBeVisible();
  const current=await call(request,rep,`/quotes/${quote.quoteId}`);
  expect(current.revisionId).toBe(quote.revisionId);
  expect(current.lines).toHaveLength(1);
  const requests=await call(request,rep,`/quotes/${quote.quoteId}/requests`);
  expect(requests.some(r=>r.message.includes('an upgrade'))).toBeTruthy();
  expect((await new AxeBuilder({page}).include('section[aria-labelledby="customer-offers-title"]').withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
});

test('real quote becomes an order and finance records payment through repaired billing form', async ({page,request})=>{
  const {tokens,rep,quote}=await setup(request);
  await call(request,rep,`/quotes/${quote.quoteId}/submissions`,{expectedRevisionId:quote.revisionId,expectedRowVersion:quote.rowVersion});
  await call(request,rep,`/quotes/${quote.quoteId}/shares`,{});
  const buyer=tokens['alpha@customer.demo'];
  const visible=await call(request,buyer,`/portal/quotes/${quote.quoteId}`);
  await call(request,buyer,`/portal/quotes/${quote.quoteId}/acceptances`,{revisionId:visible.revisionId,commercialHash:visible.commercialHash});
  const current=await call(request,rep,`/quotes/${quote.quoteId}`);
  const finance=tokens['finance@dealflow.demo'];
  const invoices=await call(request,finance,`/invoices?customerId=${quote.customerId}&pageSize=100`);
  // The evaluation DTO carries the order id under gates, not at the top level.
  const invoice=invoices.items.find(i=>i.orderId===current.gates.orderId);
  expect(invoice).toBeTruthy();
  page.on('dialog',d=>d.accept());
  await login(page,finance,'/admin/finance/billing');
  await page.locator('select').first().selectOption(quote.customerId);
  const row=page.getByRole('row').filter({hasText:invoice.reference});
  await expect(row).toBeVisible();
  await row.getByRole('button',{name:/Record Payment|Settle|Pay/i}).click();
  await page.getByLabel('Payment Amount (INR)',{exact:true}).fill(String(invoice.outstanding));
  await page.getByLabel('Bank Reference / Transaction ID',{exact:true}).fill(`AUDIT-${Date.now()}`);
  await page.getByRole('button',{name:'Confirm Payment',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Record Customer Payment Receipt'})).not.toBeVisible();
  expect(Number((await call(request,finance,`/invoices/${invoice.id}`)).outstanding)).toBe(0);
});

test('catalog creation, policy publishing and report filters persist through actual APIs',async({page,request})=>{
  const accounts=await call(request,'','/auth/demo-accounts');
  const admin=accounts.find(a=>a.role==='ADMIN').token;
  await login(page,admin,'/admin/system/catalog');
  await page.getByText('Create & edit catalog configuration',{exact:true}).click();
  await page.getByLabel('Record type',{exact:true}).selectOption('warehouses');
  const name=`Audit warehouse ${Date.now()}`;
  await page.getByLabel('Warehouse code',{exact:true}).fill(`AUD-${Date.now()}`);
  await page.getByLabel('Warehouse name',{exact:true}).fill(name);
  await page.getByLabel('Location',{exact:true}).fill('Test site');
  await page.getByRole('button',{name:'Create record',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Warehouse saved');
  expect((await call(request,admin,'/warehouses')).some(w=>w.name===name)).toBeTruthy();
  await page.goto('/admin/system/governance');
  await page.getByLabel('Reason for the new version').fill('Audit confirms unchanged policy can publish through UI');
  await page.getByRole('button',{name:'Publish new policy version'}).click();
  await expect(page.getByRole('status')).toContainText('Published policy version');
  await page.goto('/admin/reports');
  await page.getByLabel('Quotation stage',{exact:true}).selectOption('CONFIRMED');
  await page.getByRole('button',{name:'Apply filters',exact:true}).click();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export XLSX',exact:true}).click();
  expect((await download).suggestedFilename()).toBe('dealflow-sales.xlsx');
});
