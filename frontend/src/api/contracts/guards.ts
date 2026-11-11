import { ApiError } from '../client'

import type { Invoice } from './billing'
import type { PortalQuoteDetail } from './portal'
import type { QuoteEvaluation } from './quotes'

/**
 * Runtime shape checks at the boundary.
 *
 * TypeScript describes what the server promised; it cannot see what actually
 * arrived. These guards run on the payloads where being wrong costs money — a
 * quotation evaluation, a portal quotation, an invoice — and turn a malformed
 * response into a visible page error carrying the request id.
 *
 * The rule they enforce is narrow and deliberate: **a missing financial field is
 * an error, never a zero.** Substituting zero is how a screen ends up telling a
 * customer their order is free, or a finance user that nothing is outstanding.
 * Everything else is left to the compiler; validating all 114 payloads at
 * runtime would cost more than it protects.
 */

class ContractError extends ApiError {
  constructor(what: string, missing: string[]) {
    super({
      status: 200,
      code: 'CONTRACT_ERROR',
      message:
        `The server's ${what} response is missing ${missing.length === 1 ? 'a field' : 'fields'} ` +
        `this screen needs: ${missing.join(', ')}. The figures cannot be shown safely.`,
      details: { missing },
    })
  }
}

function missingFrom(value: unknown, keys: string[]): string[] {
  if (value === null || typeof value !== 'object') return keys
  const record = value as Record<string, unknown>
  return keys.filter((key) => record[key] === undefined || record[key] === null)
}

/** A quotation evaluation. Totals and gates drive every action on the screen. */
export function assertQuoteEvaluation(value: unknown): QuoteEvaluation {
  const missing = missingFrom(value, [
    'quoteId',
    'revisionId',
    'stage',
    'lines',
    'totals',
    'risk',
    'gates',
    'rowVersion',
  ])
  if (missing.length) throw new ContractError('quotation', missing)

  const evaluation = value as QuoteEvaluation

  // The commercial hash is minted at submission, so a revision that has never
  // been submitted has none and that is correct — refusing to open a draft would
  // break the one screen a rep spends their day in, and a draft can also be
  // cancelled without ever being submitted. Where a revision *has* been
  // submitted, a missing hash is a real fault: it is what acceptance and sharing
  // are pinned to.
  const wasSubmitted =
    evaluation.revisionStatus === 'SUBMITTED' || evaluation.revisionStatus === 'SUPERSEDED'
  if (wasSubmitted && !evaluation.commercialHash) {
    throw new ContractError('quotation', ['commercialHash'])
  }

  const totalsMissing = missingFrom(evaluation.totals, [
    'currency',
    'oneTimeNet',
    'oneTimeTotal',
    'initialAmountDue',
  ])
  if (totalsMissing.length) {
    throw new ContractError(
      'quotation',
      totalsMissing.map((key) => `totals.${key}`),
    )
  }
  return evaluation
}

/**
 * A customer's view of a quotation.
 *
 * `acceptable` and `commercialHash` are checked because acceptance is the one
 * irreversible thing a customer can do, and both are required to do it safely.
 */
export function assertPortalQuote(value: unknown): PortalQuoteDetail {
  const missing = missingFrom(value, [
    'id',
    'revisionId',
    'status',
    'lines',
    'totals',
    'commercialHash',
  ])
  if (missing.length) throw new ContractError('quotation', missing)

  const detail = value as PortalQuoteDetail
  if (typeof detail.acceptable !== 'boolean') {
    throw new ContractError('quotation', ['acceptable'])
  }
  const totalsMissing = missingFrom(detail.totals, [
    'currency',
    'oneTimeTotal',
    'dueOnConfirmation',
  ])
  if (totalsMissing.length) {
    throw new ContractError(
      'quotation',
      totalsMissing.map((key) => `totals.${key}`),
    )
  }
  return detail
}

/** An invoice. `outstanding` is derived server-side and never recomputed here. */
export function assertInvoice(value: unknown): Invoice {
  const missing = missingFrom(value, [
    'id',
    'reference',
    'status',
    'currency',
    'total',
    'paid',
    'credited',
    'outstanding',
  ])
  if (missing.length) throw new ContractError('invoice', missing)
  return value as Invoice
}
