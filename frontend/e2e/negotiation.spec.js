import { test, expect } from '@playwright/test';

// Run only against the disposable, seeded UI-test backend described in docs.
const apiUrl = process.env.UI_TEST_API || 'http://127.0.0.1:8082/api/v1';

async function call(request, token, path, data, method = data === undefined ? 'GET' : 'POST') {
  const response = await request.fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    data,
  });
  expect(response.ok(), `${method} ${path}: ${response.status()} ${response.ok() ? '' : await response.text()}`)
    .toBeTruthy();
  return (await response.json()).data;
}

async function login(page, token, path) {
  await page.addInitScript((value) => localStorage.setItem('dealflow_token', value), token);
  await page.goto(path);
}

/** A shared quotation the customer can negotiate: two laptops, nothing off. */
async function sharedQuote(request) {
  const accounts = await call(request, '', '/auth/demo-accounts');
  const tokens = Object.fromEntries(accounts.map((a) => [a.email, a.token]));
  const rep = tokens['rep.a@dealflow.demo'];

  const customers = await call(request, rep, '/customers?pageSize=100');
  const customer = customers.items.find((c) => c.name === 'Alpha Traders');
  const products = await call(request, rep, '/products?pageSize=100');
  const product = products.items.find((p) => p.code === 'LAPTOP');
  const variants = await call(request, rep, `/variants?productId=${product.id}`);
  const variant = variants.find((v) => v.sku === 'LAPTOP-14');

  const draft = await call(request, rep, '/quotes', {
    customerId: customer.id,
    title: `Negotiation check ${Date.now()}`,
  });
  const saved = await call(request, rep, `/quotes/${draft.quoteId}/revisions`, {
    expectedRowVersion: draft.rowVersion,
    lines: [{ lineKey: 'laptop', variantId: variant.id, quantity: 2, lineDiscountBp: 0 }],
    orderDiscountBp: 0,
    backorderTerms: 'ALLOW_BACKORDER',
  });
  await call(request, rep, `/quotes/${draft.quoteId}/submissions`, { expectedRevisionId: saved.revisionId });
  await call(request, rep, `/quotes/${draft.quoteId}/shares`, {});

  return { tokens, rep, quoteId: draft.quoteId, before: saved };
}

test('a customer asking for 10% off the quotation actually reprices it, and the rep can adopt it', async ({
  page,
  request,
}) => {
  const { tokens, rep, quoteId, before } = await sharedQuote(request);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // ---- the customer proposes 10% off the whole quotation
  await login(page, tokens['alpha@customer.demo'], `/customer/quotes/${quoteId}`);
  await page.getByRole('button', { name: 'Negotiate' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: /Counteroffer/ })).toHaveAttribute('aria-checked', 'true');

  const discount = dialog.getByLabel('Discount you are asking for on the whole quotation');
  await expect(discount).toHaveValue('0');
  await discount.fill('10');
  await dialog.getByLabel('Message to your account manager').fill('We can sign today at 10% off.');
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(dialog).not.toBeVisible();

  // The price the customer is now looking at has actually moved.
  const portal = await call(request, tokens['alpha@customer.demo'], `/portal/quotes/${quoteId}`);
  expect(portal.orderDiscountBp).toBe(1000);
  expect(Number(portal.totals.oneTimeSubtotal)).toBeCloseTo(Number(before.totals.oneTimeNet) * 0.9, 2);
  await expect(page.getByText('Quotation discount applied')).toBeVisible();

  // ---- the rep sees the proposal, in numbers, with something to do about it
  await login(page, rep, `/admin/sales/quotes/${quoteId}`);
  const banner = page.getByRole('region', { name: 'The customer proposed these terms' });
  await expect(banner).toBeVisible();
  await expect(banner.getByText('10%', { exact: true })).toBeVisible();
  await expect(page.getByText('Asked for 10% off the whole quotation')).toBeVisible();

  await banner.getByRole('button', { name: 'Adopt these terms' }).click();
  await expect(page.getByText('Customer terms adopted.')).toBeVisible();

  const internal = await call(request, rep, `/quotes/${quoteId}`);
  expect(internal.revisionSource).toBe('CUSTOMER_COUNTER');
  expect(internal.gates.sellerAdopted).toBe(true);
  expect(Number(internal.totals.oneTimeNet)).toBeCloseTo(Number(before.totals.oneTimeNet) * 0.9, 2);

  const requests = await call(request, rep, `/quotes/${quoteId}/requests`);
  expect(requests[0].status).toBe('ADOPTED');
  expect(requests[0].payload.requestedOrderDiscountBp).toBe(1000);

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('the deal room keeps its messages on screen while it refreshes', async ({ page, request }) => {
  const { tokens, rep, quoteId } = await sharedQuote(request);

  await call(request, tokens['alpha@customer.demo'], `/portal/quotes/${quoteId}/requests`, {
    requestType: 'COMMENT',
    expectedRevisionId: (await call(request, tokens['alpha@customer.demo'], `/portal/quotes/${quoteId}`)).revisionId,
    message: 'Does the price include on-site setup?',
  });

  await login(page, rep, `/admin/sales/quotes/${quoteId}`);
  const question = page.getByText('Does the price include on-site setup?');
  await expect(question).toBeVisible();

  // The fallback poll runs every five seconds while the socket is down. The
  // message must stay put across several of those ticks rather than being
  // replaced by a loading state.
  for (let i = 0; i < 3; i += 1) {
    await page.waitForTimeout(2500);
    await expect(question).toBeVisible();
    await expect(page.getByText('Loading conversation')).toHaveCount(0);
  }

  await page
    .getByRole('textbox', { name: 'Reply to customer' })
    .fill('Yes — on-site setup is included in the quoted price.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText('Yes — on-site setup is included in the quoted price.')).toBeVisible();
  await expect(question).toBeVisible();
});
