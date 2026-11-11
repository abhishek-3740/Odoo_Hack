import { describe, expect, it } from 'vitest'

import { assertQuoteEvaluation } from './guards'

/**
 * The boundary guard on a quotation evaluation.
 *
 * It exists to stop a malformed payload being drawn as money, so it has to be
 * strict — but strictness that refuses a legitimate response is worse than no
 * guard at all. It once required `commercialHash` on every evaluation. The
 * server only mints that at submission, so the guard rejected every draft, and
 * the deal workspace — the screen a rep spends the day in — showed "this
 * quotation could not be opened" for every quotation they had just created.
 */

/** Enough of an evaluation to satisfy the guard; each test spoils one thing. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    quoteId: 'q-1',
    revisionId: 'r-1',
    revisionStatus: 'DRAFT',
    stage: 'DRAFT',
    lines: [],
    totals: {
      currency: 'INR',
      oneTimeNet: '0.00',
      oneTimeTotal: '0.00',
      initialAmountDue: '0.00',
    },
    risk: { requiredLevel: 'NONE' },
    gates: { approvalCleared: true },
    commercialHash: null,
    rowVersion: 1,
    ...overrides,
  }
}

describe('assertQuoteEvaluation', () => {
  it('accepts a draft that has no commercial hash yet', () => {
    expect(() => assertQuoteEvaluation(payload())).not.toThrow()
  })

  it('accepts a draft cancelled before it was ever submitted', () => {
    expect(() =>
      assertQuoteEvaluation(payload({ revisionStatus: 'CANCELED', commercialHash: null })),
    ).not.toThrow()
  })

  it('refuses a submitted revision with no commercial hash', () => {
    // Acceptance and sharing are pinned to this value. Showing the screen
    // without it would offer actions that cannot be performed safely.
    expect(() =>
      assertQuoteEvaluation(payload({ revisionStatus: 'SUBMITTED', commercialHash: null })),
    ).toThrow(/commercialHash/)
  })

  it('refuses a superseded revision with no commercial hash', () => {
    expect(() =>
      assertQuoteEvaluation(payload({ revisionStatus: 'SUPERSEDED', commercialHash: null })),
    ).toThrow(/commercialHash/)
  })

  it('refuses a payload missing its totals rather than treating them as zero', () => {
    expect(() => assertQuoteEvaluation(payload({ totals: undefined }))).toThrow(/totals/)
  })

  it('names the missing total, not just the object', () => {
    expect(() =>
      assertQuoteEvaluation(
        payload({ totals: { currency: 'INR', oneTimeNet: '0.00', oneTimeTotal: '0.00' } }),
      ),
    ).toThrow(/totals\.initialAmountDue/)
  })

  it('refuses a response that is not an object at all', () => {
    expect(() => assertQuoteEvaluation(null)).toThrow(/quoteId/)
  })
})
