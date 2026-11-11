import { expect, test, type APIRequestContext } from '@playwright/test'

import { api, expectNoHorizontalOverflow, signIn, tokenFor } from './support'

/**
 * The commercial workflow, from the screens rather than from the API.
 *
 * Arrangement goes through the API because setting a scene by clicking is slow
 * and brittle; every *assertion* is against what a person can see, because the
 * defects this rebuild exists to fix were all "the server was right and the
 * screen did not say so".
 *
 * These tests write real quotations, approvals and acceptances. Point them at a
 * disposable stack, never at production or a customer's data.
 */

interface Customer {
  id: string
  name: string
  tier: string
}
interface Product {
  id: string
  code: string
  chargeKind: string
}
interface Variant {
  id: string
  sku: string
}
interface Evaluation {
  quoteId: string
  reference: string
  revisionId: string
  revisionNo: number
  rowVersion: number
  stage: string
  revisionStatus: string
  commercialHash: string
  currency: string
  risk: { requiredLevel: string }
  approvals: Array<{ id: string; step: number; requiredRole: string; status: string }>
  gates: {
    sellerAdopted: boolean
    approvalCleared: boolean
    customerAccepted: boolean
    orderExists: boolean
    orderId: string | null
  }
  totals: { oneTimeTotal: string; initialAmountDue: string }
}

/** Builds a saved-and-submitted quotation at whichever approval level is wanted. */
async function seedQuote(
  request: APIRequestContext,
  rep: string,
  options: { customerName: string; productCode: string; discountBp: number; title: string },
): Promise<Evaluation> {
  const customers = await api<{ items: Customer[] }>(request, '/customers?pageSize=100', {
    token: rep,
  })
  const customer = customers.items.find((row) => row.name === options.customerName)
  expect(customer, `No seeded customer named ${options.customerName}`).toBeTruthy()

  const products = await api<{ items: Product[] }>(request, '/products?pageSize=100', { token: rep })
  const product = products.items.find((row) => row.code === options.productCode)
  expect(product, `No seeded product ${options.productCode}`).toBeTruthy()

  const variants = await api<Variant[]>(request, `/variants?productId=${product!.id}`, {
    token: rep,
  })
  expect(variants.length, `No variant for ${options.productCode}`).toBeGreaterThan(0)

  const draft = await api<Evaluation>(request, '/quotes', {
    token: rep,
    data: { customerId: customer!.id, title: options.title },
  })

  const saved = await api<Evaluation>(request, `/quotes/${draft.quoteId}/revisions`, {
    token: rep,
    data: {
      expectedRowVersion: draft.rowVersion,
      lines: [
        {
          lineKey: 'line-1',
          variantId: variants[0].id,
          quantity: 2,
          lineDiscountBp: options.discountBp,
        },
      ],
      orderDiscountBp: 0,
    },
  })

  return api<Evaluation>(request, `/quotes/${draft.quoteId}/submissions`, {
    token: rep,
    data: { expectedRevisionId: saved.revisionId },
  })
}

/* ====================================================================== */

test.describe('a quotation inside policy', () => {
  test('says so plainly rather than leaving an empty approver queue unexplained', async ({
    page,
    request,
  }) => {
    const rep = await tokenFor(request, 'rep')
    const submitted = await seedQuote(request, rep, {
      customerName: 'Alpha Traders',
      productCode: 'LAPTOP',
      discountBp: 0,
      title: `Within policy ${Date.now()}`,
    })

    expect(submitted.risk.requiredLevel).toBe('NONE')
    expect(submitted.approvals).toEqual([])

    await signIn(page, rep, `/admin/quotes/${submitted.quoteId}`)

    // The chip must stop asking for an action already taken.
    await expect(page.getByText('Within policy · no approval required').first()).toBeVisible()
    await expect(page.getByText('Within policy · Submit to validate')).toHaveCount(0)

    // The policy check lives in the inspector, which is a rail at 2xl and a
    // drawer below it. At this width that means opening the drawer — which is
    // also the only way most laptops will ever see it.
    await page.getByRole('button', { name: 'Totals & policy' }).click()
    const inspector = page.getByRole('dialog', { name: /Totals, policy and gates/ })
    await expect(inspector.getByText('no manager or finance step was created')).toBeVisible()
    await page.keyboard.press('Escape')

    // The approvals tab says the same thing rather than showing an empty list.
    await page.getByRole('tab', { name: 'Approvals' }).click()
    await expect(page.getByText('No approval step exists for this version.')).toBeVisible()
  })
})

test.describe('a quotation that breaches policy', () => {
  test('tells the rep approval is outstanding, and reaches both queues', async ({
    page,
    request,
  }) => {
    const rep = await tokenFor(request, 'rep')
    // Alpha Traders is Bronze (5% tier ceiling) and SETUP is a service; 30% is
    // far enough over to pass the worst-line test and reach finance too.
    const submitted = await seedQuote(request, rep, {
      customerName: 'Alpha Traders',
      productCode: 'SETUP',
      discountBp: 3000,
      title: `Needs approval ${Date.now()}`,
    })

    expect(submitted.risk.requiredLevel).toBe('MANAGER_FINANCE')
    expect(submitted.approvals.map((step) => [step.step, step.requiredRole, step.status])).toEqual([
      [1, 'MANAGER', 'PENDING'],
      [2, 'FINANCE', 'PENDING'],
    ])

    // A submitted quotation sits at stage REVIEW. The previous frontend tested
    // the share-the-portal branch first, which made this sentence unreachable
    // for exactly the deals that were waiting for approval.
    await signIn(page, rep, `/admin/quotes/${submitted.quoteId}`)
    const step = page.getByRole('region', { name: 'Next workflow step' })
    await expect(step).toContainText('step 1 manager approval')

    await expect(page.getByLabel('Approval route')).toContainText('Step 1 · Manager')
    await expect(page.getByLabel('Approval route')).toContainText('Step 2 · Finance')

    // Finance sees its step immediately — locked, with the reason, not hidden.
    await signIn(page, await tokenFor(request, 'finance'), '/admin/approvals')
    const financeRow = page.getByRole('listitem').filter({ hasText: submitted.reference })
    await expect(financeRow).toBeVisible()
    await expect(financeRow).toContainText('Waiting for the manager step to be approved first')

    // The manager sees step 1 and can act on it.
    await signIn(page, await tokenFor(request, 'manager'), '/admin/approvals')
    const managerRow = page.getByRole('listitem').filter({ hasText: submitted.reference })
    await expect(managerRow).toBeVisible()
    await expect(managerRow.getByRole('button', { name: 'Decide' })).toBeEnabled()
  })

  test('unlocks the finance step only after the manager approves', async ({ page, request }) => {
    const rep = await tokenFor(request, 'rep')
    const submitted = await seedQuote(request, rep, {
      customerName: 'Alpha Traders',
      productCode: 'SETUP',
      discountBp: 3000,
      title: `Sequence ${Date.now()}`,
    })

    // Before: finance cannot decide.
    await signIn(page, await tokenFor(request, 'finance'), '/admin/approvals')
    const before = page.getByRole('listitem').filter({ hasText: submitted.reference })
    await expect(before.getByRole('button', { name: 'Decide' })).toBeDisabled()

    // The manager approves step 1, through the UI.
    await signIn(page, await tokenFor(request, 'manager'), '/admin/approvals')
    const managerRow = page.getByRole('listitem').filter({ hasText: submitted.reference })
    await managerRow.getByRole('button', { name: 'Decide' }).click()
    await page.getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByText(/Approve recorded/)).toBeVisible()

    // After: the same finance step is now actionable and says nothing about
    // waiting on an earlier one.
    await signIn(page, await tokenFor(request, 'finance'), '/admin/approvals')
    const after = page.getByRole('listitem').filter({ hasText: submitted.reference })
    await expect(after.getByRole('button', { name: 'Decide' })).toBeEnabled()
    await expect(after).not.toContainText('Waiting for the manager step')
  })
})

test.describe('the customer side', () => {
  test('a counteroffer creates a priced version but commits nobody until it is adopted', async ({
    page,
    request,
  }) => {
    // The longest journey here: it seeds and submits a quotation, shares it,
    // signs in twice, loads the deal room and the workspace, and polls the
    // server for the outcome. Against a hosted database each of those steps
    // costs a couple of seconds of round trips, and the suite default of one
    // minute is not enough for a test doing this much. Nothing here is slow
    // because of the UI — the two query problems that were have been fixed.
    test.setTimeout(120_000)

    const rep = await tokenFor(request, 'rep')
    const customer = await tokenFor(request, 'customer')

    const submitted = await seedQuote(request, rep, {
      customerName: 'Alpha Traders',
      productCode: 'LAPTOP',
      discountBp: 0,
      title: `Negotiation ${Date.now()}`,
    })
    await api(request, `/quotes/${submitted.quoteId}/shares`, { token: rep, data: {} })

    const before = Number(submitted.totals.oneTimeTotal)
    expect(before).toBeGreaterThan(0)

    // The customer asks for 10% off the whole quotation, from the deal room.
    await signIn(page, customer, `/customer/quotes/${submitted.quoteId}`)
    await page.getByRole('button', { name: 'Ask for a discount' }).click()
    await page
      .getByLabel('Discount you are asking for on the whole quotation')
      .fill('10')
    await page.getByLabel('Why?').fill('We can commit this quarter for three units.')
    await page.getByRole('button', { name: 'Send the proposal' }).click()
    await expect(page.getByText('Proposal sent')).toBeVisible()

    // The proposal is priced at once and becomes the version on screen — that is
    // the point of it. What must NOT happen is agreement.
    const proposed = await api<{ totals: { oneTimeTotal: string }; versionNumber: number }>(
      request,
      `/portal/quotes/${submitted.quoteId}`,
      { token: customer },
    )
    expect(Number(proposed.totals.oneTimeTotal)).toBeCloseTo(before * 0.9, 0)
    expect(proposed.versionNumber).toBe(2)

    const uncommitted = await api<Evaluation>(request, `/quotes/${submitted.quoteId}`, {
      token: rep,
    })
    expect(
      uncommitted.gates.sellerAdopted,
      'A customer proposal committed the seller without anyone agreeing to it',
    ).toBe(false)
    expect(
      uncommitted.gates.orderExists,
      'A customer proposal produced an order on its own',
    ).toBe(false)

    // The salesperson sees the proposal as numbers, and adopts it.
    await signIn(page, rep, `/admin/quotes/${submitted.quoteId}`)
    await page.getByRole('tab', { name: 'Conversation' }).click()
    await expect(page.getByText('What they are asking for')).toBeVisible()
    await expect(page.getByText('off the whole quotation')).toBeVisible()

    // The banner above the tabs offers the same action; press the one in the
    // conversation so the test covers the path a rep actually reads first.
    await page
      .getByRole('tabpanel')
      .getByRole('button', { name: 'Adopt these terms' })
      .first()
      .click()
    await expect(page.getByText('Customer terms adopted')).toBeVisible()

    // Adoption is what commits the seller. The figures were already the
    // customer's; the agreement is the new fact.
    const after = await api<Evaluation>(request, `/quotes/${submitted.quoteId}`, { token: rep })
    expect(after.gates.sellerAdopted).toBe(true)
    expect(Number(after.totals.oneTimeTotal)).toBeCloseTo(before * 0.9, 0)
  })

  test('acceptance names one exact version and creates the order when nothing else is missing', async ({
    page,
    request,
  }) => {
    const rep = await tokenFor(request, 'rep')
    const customer = await tokenFor(request, 'customer')

    const submitted = await seedQuote(request, rep, {
      customerName: 'Alpha Traders',
      productCode: 'LAPTOP',
      discountBp: 0,
      title: `Acceptance ${Date.now()}`,
    })
    await api(request, `/quotes/${submitted.quoteId}/shares`, { token: rep, data: {} })
    await api(request, `/quotes/${submitted.quoteId}/adoptions`, {
      token: rep,
      data: { revisionId: submitted.revisionId },
    })

    await signIn(page, customer, `/customer/quotes/${submitted.quoteId}`)
    await expect(page.getByRole('button', { name: 'Accept & confirm' })).toBeEnabled()

    await page.getByRole('button', { name: 'Accept & confirm' }).click()
    await expect(page.getByRole('heading', { name: /Accept version/ })).toBeVisible()
    await page.getByRole('button', { name: 'Yes, accept these terms' }).click()

    // The toast says the same thing; assert the page's own confirmation.
    await expect(
      page.locator('#portal-main').getByText(/Order confirmed|Acceptance recorded/).first(),
    ).toBeVisible()

    // The server agrees: an order exists against this quotation.
    await expect
      .poll(
        async () => {
          const current = await api<Evaluation>(request, `/quotes/${submitted.quoteId}`, {
            token: rep,
          })
          return current.gates.orderExists
        },
        { message: 'No order was created after every gate cleared' },
      )
      .toBe(true)
  })

  test('a customer never sees an internal figure on their own quotation', async ({
    page,
    request,
  }) => {
    const rep = await tokenFor(request, 'rep')
    const customer = await tokenFor(request, 'customer')

    const submitted = await seedQuote(request, rep, {
      customerName: 'Alpha Traders',
      productCode: 'LAPTOP',
      discountBp: 0,
      title: `Boundary ${Date.now()}`,
    })
    await api(request, `/quotes/${submitted.quoteId}/shares`, { token: rep, data: {} })

    await signIn(page, customer, `/customer/quotes/${submitted.quoteId}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // Not "hidden with CSS" — these words are absent from the document, because
    // the portal response has no field for them.
    const text = (await page.locator('body').innerText()).toLowerCase()
    for (const forbidden of ['margin', 'contribution', 'unit cost', 'ceiling', 'policy version']) {
      expect(text, `The customer page mentions "${forbidden}"`).not.toContain(forbidden)
    }
  })
})

test.describe('the deal workspace', () => {
  test('refuses to offer a second submission of the same version', async ({ page, request }) => {
    const rep = await tokenFor(request, 'rep')
    const submitted = await seedQuote(request, rep, {
      customerName: 'Alpha Traders',
      productCode: 'LAPTOP',
      discountBp: 0,
      title: `No double submit ${Date.now()}`,
    })

    await signIn(page, rep, `/admin/quotes/${submitted.quoteId}`)
    const submit = page.getByRole('button', { name: 'Submitted' })
    await expect(submit).toBeVisible()
    await expect(submit).toBeDisabled()
    await expect(submit).toHaveAttribute('title', /already been submitted/)
  })

  test('prices an edit without saving it', async ({ page, request }) => {
    const rep = await tokenFor(request, 'rep')
    const draft = await api<Evaluation>(request, '/quotes', {
      token: rep,
      data: {
        customerId: (
          await api<{ items: Customer[] }>(request, '/customers?pageSize=100', { token: rep })
        ).items.find((row) => row.name === 'Alpha Traders')!.id,
        title: `Live pricing ${Date.now()}`,
      },
    })
    const products = await api<{ items: Product[] }>(request, '/products?pageSize=100', {
      token: rep,
    })
    const laptop = products.items.find((row) => row.code === 'LAPTOP')!
    const variants = await api<Variant[]>(request, `/variants?productId=${laptop.id}`, {
      token: rep,
    })
    const saved = await api<Evaluation>(request, `/quotes/${draft.quoteId}/revisions`, {
      token: rep,
      data: {
        expectedRowVersion: draft.rowVersion,
        lines: [{ lineKey: 'line-1', variantId: variants[0].id, quantity: 1, lineDiscountBp: 0 }],
        orderDiscountBp: 0,
      },
    })

    // Wide enough for the inspector rail, where the totals live.
    await page.setViewportSize({ width: 1600, height: 950 })
    await signIn(page, rep, `/admin/quotes/${draft.quoteId}`)
    await expect(page.getByRole('tab', { name: 'Quote' })).toHaveAttribute(
      'data-state',
      'active',
    )

    const totals = page.locator('aside').getByText('Payable on confirmation').locator('..')
    const beforeTotal = await totals.innerText()

    await page.getByLabel(/^Line discount for/).first().fill('10')

    // The figures move without anyone pressing Save, and the screen says the
    // work is unsaved rather than implying it has been persisted.
    await expect(page.getByText('Unsaved changes')).toBeVisible()
    await expect
      .poll(async () => totals.innerText(), {
        message: 'The totals never re-priced after the discount changed',
      })
      .not.toBe(beforeTotal)

    // Nothing was written: the saved revision is untouched.
    const current = await api<Evaluation>(request, `/quotes/${draft.quoteId}`, { token: rep })
    expect(current.revisionId).toBe(saved.revisionId)
    expect(current.revisionNo).toBe(saved.revisionNo)
  })
})

test.describe('building a quotation from nothing', () => {
  /**
   * Every other test here arranges its quotation through the API, which is fast
   * but skips the state a rep actually starts in: a quotation that has been
   * created and never submitted. A runtime contract guard rejected exactly that
   * response for a month because the commercial hash is only minted at
   * submission, and no test noticed. This walks the path with the mouse.
   */
  test('a rep creates one, adds a line, saves and submits it — all from the screens', async ({
    page,
    request,
  }) => {
    const rep = await tokenFor(request, 'rep')
    const title = `Built by hand ${Date.now()}`
    // The option's text is "name · tier", so pick it by id rather than guessing
    // the tier this demo database happens to have given them.
    const alpha = (
      await api<{ items: Customer[] }>(request, '/customers?pageSize=100', { token: rep })
    ).items.find((row) => row.name === 'Alpha Traders')!

    await page.setViewportSize({ width: 1600, height: 950 })
    await signIn(page, rep, '/admin/quotes')

    await page.getByRole('button', { name: 'New quotation' }).first().click()
    const newQuote = page.getByRole('dialog')
    await expect(newQuote.getByRole('heading', { name: 'New quotation' })).toBeVisible()
    await newQuote.getByLabel('Customer').selectOption(alpha.id)
    await newQuote.getByLabel('Title').fill(title)
    await newQuote.getByRole('button', { name: 'Create and open' }).click()

    // The workspace opens on a draft that has never been submitted. This is the
    // state the guard used to refuse.
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(title) })).toBeVisible()
    await expect(page.getByText('This quotation could not be opened')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Quote' })).toHaveAttribute('data-state', 'active')

    // Nothing may be submitted yet, and the button says why rather than sitting
    // there dead. The server refuses an empty quotation, so the screen must too.
    const submit = page.getByRole('button', { name: 'Submit for approval' })
    await expect(submit).toBeDisabled()
    await expect(submit).toHaveAttribute('title', /at least one line/i)

    await page.getByRole('button', { name: 'Add a line' }).click()
    const catalogue = page.getByRole('dialog')
    await catalogue.getByLabel('Search the catalogue').fill('LAPTOP')
    await catalogue.getByRole('listitem').first().getByRole('button').click()

    // Picking the product moves the same dialog on to its variants; picking one
    // closes it and puts the line on the quotation.
    await expect(catalogue.getByText('Choose the variant to quote.')).toBeVisible()
    await catalogue.getByRole('listitem').first().getByRole('button').click()
    await expect(catalogue).toHaveCount(0)

    await expect(page.getByText('Unsaved changes')).toBeVisible()

    await page.getByRole('button', { name: 'Save terms' }).click()
    await expect(page.getByText(/Saved as version/)).toBeVisible()
    await expect(page.getByText('Unsaved changes')).toHaveCount(0)

    await expect(submit).toBeEnabled()
    await submit.click()

    // The button relabels only once the refetched quotation says SUBMITTED, so
    // this is the state itself rather than a toast that fires on the response.
    const submitted = page.getByRole('button', { name: 'Submitted' })
    await expect(submitted).toBeVisible()
    await expect(submitted).toBeDisabled()

    // The server agrees, and the hash it mints at submission is now present.
    const list = await api<{ items: Array<{ id: string; title: string }> }>(
      request,
      '/quotes?pageSize=100',
      { token: rep },
    )
    const created = list.items.find((row) => row.title === title)
    expect(created, 'The quotation the browser created is not in the list').toBeTruthy()
    const server = await api<Evaluation>(request, `/quotes/${created!.id}`, { token: rep })
    expect(server.revisionStatus).toBe('SUBMITTED')
    expect(server.commercialHash, 'Submission did not mint a commercial hash').toBeTruthy()
    expect(server.gates.sellerAdopted).toBe(true)
  })
})

test.describe('the two detail screens at every width', () => {
  // The static routes are covered by the smoke suite. These two are the most
  // complex layouts in the product and need a real record to render, so they are
  // checked here where one can be created.
  const WIDTHS = [320, 768, 1024, 1440]

  test('the deal workspace and the deal room never scroll sideways', async ({ page, request }) => {
    const rep = await tokenFor(request, 'rep')
    const submitted = await seedQuote(request, rep, {
      customerName: 'Alpha Traders',
      productCode: 'LAPTOP',
      discountBp: 0,
      title: `Responsive ${Date.now()}`,
    })
    await api(request, `/quotes/${submitted.quoteId}/shares`, { token: rep, data: {} })

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await signIn(page, rep, `/admin/quotes/${submitted.quoteId}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }

    const customer = await tokenFor(request, 'customer')
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await signIn(page, customer, `/customer/quotes/${submitted.quoteId}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }
  })
})
