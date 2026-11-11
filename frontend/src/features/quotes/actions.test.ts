import { describe, expect, it } from 'vitest'

import type { GateSummary, Me, QuoteEvaluation } from '@/api'

import { canAdopt, canEdit, canSave, canShare, canSubmit, nextStepSentence } from './actions'

/**
 * Action eligibility and the "what happens next" sentence.
 *
 * These are pure functions on purpose: the previous frontend inferred the same
 * decisions from stage labels inside components, which is how "Submit" survived
 * a submission and how the approval sentence became unreachable. Testing them
 * here is cheap and catches exactly those regressions.
 */

const REP: Me = {
  profileId: 'rep-1',
  email: 'rep@example.com',
  fullName: 'Rep',
  phone: null,
  role: 'REP',
  teamId: 'team-1',
  customerId: null,
  customerName: null,
  customerTier: null,
  internal: true,
  authProvider: 'DEMO',
  capabilities: ['quotes:create', 'quotes:edit-own', 'quotes:submit', 'quotes:share', 'quotes:adopt'],
}

const OTHER_REP: Me = { ...REP, profileId: 'rep-2' }
const MANAGER: Me = { ...REP, profileId: 'mgr-1', role: 'MANAGER', capabilities: ['quotes:read-team'] }

function gates(overrides: Partial<GateSummary> = {}): GateSummary {
  return {
    approvalStatus: 'NOT_REQUIRED',
    approvalCleared: true,
    sellerAdopted: false,
    customerAccepted: false,
    expired: false,
    orderExists: false,
    orderId: null,
    readyToExecute: false,
    blockingReasons: [],
    ...overrides,
  }
}

function quote(overrides: Partial<QuoteEvaluation> = {}): QuoteEvaluation {
  return {
    quoteId: 'q-1',
    reference: 'Q-1000',
    title: 'Test',
    customerId: 'c-1',
    customerName: 'Alpha',
    customerTier: 'BRONZE',
    ownerProfileId: 'rep-1',
    stage: 'DRAFT',
    validUntil: null,
    revisionId: 'r-1',
    revisionNo: 1,
    revisionStatus: 'DRAFT',
    revisionSource: 'SELLER',
    currency: 'INR',
    orderDiscountBp: 0,
    backorderTerms: 'ALLOW_BACKORDER',
    invoicingTerms: null,
    requestedActivationDate: null,
    lines: [
      {
        lineKey: 'l-1',
        position: 0,
        lineKind: 'ONE_TIME',
        productId: 'p-1',
        variantId: 'v-1',
        planId: null,
        categoryCode: 'HARDWARE',
        description: 'Laptop',
        quantity: '1',
        unitPrice: '10000.00',
        unitCost: '7000.00',
        taxRateBp: 1800,
        lineDiscountBp: 0,
        appliedOrderDiscountBp: 0,
        effectiveDiscountBp: 0,
        base: '10000.00',
        net: '10000.00',
        tax: '1800.00',
        costTotal: '7000.00',
        margin: '3000.00',
        marginPercent: '30.00',
        intervalMonths: null,
        requiresStock: true,
        promisedDate: null,
        source: 'MANUAL',
      },
    ],
    totals: {
      currency: 'INR',
      oneTimeNet: '10000.00',
      oneTimeTax: '1800.00',
      oneTimeTotal: '11800.00',
      recurring: [],
      recurringFirstCycleNet: '0.00',
      initialAmountDue: '11800.00',
      comparisonNet: '10000.00',
      contribution: '3000.00',
      contributionPercent: '30.00',
      monthlyRecurringRevenue: '0.00',
      totalBase: '10000.00',
      totalDiscount: '0.00',
    },
    risk: {
      requiredLevel: 'NONE',
      reasons: [],
      lines: [],
      worstLineExcessPp: null,
      weightedExcessPp: null,
      excessConcessionValue: null,
      aggregateDiscountPercent: '0.00',
      aggregateMarginPercent: '30.00',
      policyVersionNo: 1,
    },
    stockPreview: [],
    gates: gates(),
    approvals: [],
    commercialHash: 'hash-1',
    rowVersion: 3,
    preview: false,
    ...overrides,
  }
}

describe('canSave', () => {
  it('allows the first save of a new quotation, where only the editor has lines', () => {
    // The saved revision is still empty at this point. Reading its line count
    // instead of the editor's made a brand new quotation impossible to save.
    const result = canSave({
      evaluation: quote({ lines: [] }),
      me: REP,
      dirty: true,
      pendingLineCount: 1,
    })
    expect(result.allowed).toBe(true)
  })

  it('refuses a save that would leave nothing on the quotation', () => {
    const result = canSave({
      evaluation: quote(),
      me: REP,
      dirty: true,
      pendingLineCount: 0,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/at least one line/i)
  })
})

describe('canSubmit', () => {
  it('refuses an empty quotation with the reason, rather than letting the server say no', () => {
    // The server answers EMPTY_QUOTE. A live button that produces a server error
    // is precisely the pattern this module exists to remove.
    const result = canSubmit({ evaluation: quote({ lines: [] }), me: REP, dirty: false })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/at least one line/i)
  })


  it('allows the owner to submit a saved draft', () => {
    expect(canSubmit({ evaluation: quote(), me: REP, dirty: false }).allowed).toBe(true)
  })

  it('never offers a second submission of the same version', () => {
    const result = canSubmit({
      evaluation: quote({ revisionStatus: 'SUBMITTED', stage: 'REVIEW' }),
      me: REP,
      dirty: false,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/already been submitted/)
  })

  it('asks for a save first when there are unsaved edits', () => {
    const result = canSubmit({ evaluation: quote(), me: REP, dirty: true })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/Save your changes first/)
  })

  it("refuses another rep's quotation, with a reason", () => {
    const result = canSubmit({ evaluation: quote(), me: OTHER_REP, dirty: false })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/another salesperson/)
  })
})

describe('canEdit and canSave', () => {
  it('locks the terms once an order exists', () => {
    const result = canEdit({
      evaluation: quote({ gates: gates({ orderExists: true, orderId: 'o-1' }) }),
      me: REP,
      dirty: false,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/An order exists/)
  })

  it('lets a manager read but not change', () => {
    const result = canEdit({ evaluation: quote(), me: MANAGER, dirty: false })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/read this quotation but not change/)
  })

  it('has nothing to save when nothing changed', () => {
    expect(canSave({ evaluation: quote(), me: REP, dirty: false }).reason).toMatch(
      /Nothing has changed/,
    )
  })
})

describe('canShare', () => {
  it('will not share a draft', () => {
    const result = canShare({ evaluation: quote(), me: REP, dirty: false })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/Submit this version first/)
  })

  it('shares a submitted version', () => {
    expect(
      canShare({
        evaluation: quote({ revisionStatus: 'SUBMITTED', stage: 'REVIEW' }),
        me: REP,
        dirty: false,
      }).allowed,
    ).toBe(true)
  })
})

describe('canAdopt', () => {
  it('is available on a version the seller has not adopted', () => {
    expect(
      canAdopt({
        evaluation: quote({ revisionSource: 'CUSTOMER_COUNTER', revisionStatus: 'SUBMITTED' }),
        me: REP,
        dirty: false,
      }).allowed,
    ).toBe(true)
  })

  it('says so when it has already happened', () => {
    const result = canAdopt({
      evaluation: quote({ gates: gates({ sellerAdopted: true }) }),
      me: REP,
      dirty: false,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/already adopted/)
  })
})

describe('nextStepSentence', () => {
  it('tells a rep to submit a draft', () => {
    expect(nextStepSentence(quote())).toMatch(/submit these terms for approval/)
  })

  it('mentions the outstanding approval on a submitted quotation', () => {
    // The regression this exists for: a submitted quotation sits at stage
    // REVIEW, and testing the share-the-portal branch first made this sentence
    // unreachable for exactly the deals that were waiting for approval.
    const sentence = nextStepSentence(
      quote({
        stage: 'REVIEW',
        revisionStatus: 'SUBMITTED',
        gates: gates({
          sellerAdopted: true,
          approvalCleared: false,
          approvalStatus: 'PENDING_MANAGER',
        }),
      }),
    )
    expect(sentence).toMatch(/step 1 manager approval/)
  })

  it('names the finance step when the manager has already approved', () => {
    const sentence = nextStepSentence(
      quote({
        stage: 'REVIEW',
        revisionStatus: 'SUBMITTED',
        gates: gates({
          sellerAdopted: true,
          approvalCleared: false,
          approvalStatus: 'PENDING_FINANCE',
        }),
      }),
    )
    expect(sentence).toMatch(/step 2 finance approval/)
  })

  it('asks for the portal share once approval is not the blocker', () => {
    const sentence = nextStepSentence(
      quote({
        stage: 'REVIEW',
        revisionStatus: 'SUBMITTED',
        gates: gates({ sellerAdopted: true, approvalCleared: true }),
      }),
    )
    expect(sentence).toMatch(/Share customer portal/)
    expect(sentence).toMatch(/Do not submit this version again/)
  })

  it('stops asking for anything once the order exists', () => {
    expect(
      nextStepSentence(quote({ gates: gates({ orderExists: true, orderId: 'o-1' }) })),
    ).toMatch(/Order confirmed/)
  })
})

describe('nextStepSentence on an empty draft', () => {
  it('asks for products rather than for a submission that would be refused', () => {
    expect(nextStepSentence(quote({ lines: [] }))).toMatch(/add the products/i)
  })
})
