import { describe, expect, it } from 'vitest'

import { describeReason } from './reasons'

describe('describeReason', () => {
  it('passes a plain string through unchanged', () => {
    expect(describeReason('Delivery date unconfirmed.')).toEqual({
      message: 'Delivery date unconfirmed.',
      details: [],
    })
  })

  it('never shows the internal code, and names every remaining field', () => {
    const reason = {
      code: 'BELOW_REORDER_POINT',
      message: 'Available 0 is at or below the reorder point of 2.',
      available: 0,
      reorderPoint: 2,
      suggestedOrderQuantity: 6,
    }

    expect(describeReason(reason)).toEqual({
      message: 'Available 0 is at or below the reorder point of 2.',
      details: [
        { label: 'Available', value: '0' },
        { label: 'Reorder point', value: '2' },
        { label: 'Suggested order', value: '6' },
      ],
    })
  })

  it('formats business dates and quantities', () => {
    const reason = {
      code: 'PAST_PROMISED_DATE',
      promisedDate: '2026-08-31',
      outstandingQuantity: 3,
      message: '3 units are still unshipped past the promised date.',
    }

    expect(describeReason(reason).details).toEqual([
      { label: 'Promised date', value: '31 Aug 2026' },
      { label: 'Outstanding quantity', value: '3' },
    ])
  })

  it('renders minor-unit money with the currency symbol', () => {
    const reason = {
      code: 'INVOICE_PAST_DUE',
      dueDate: '2026-10-30',
      outstandingMinor: 1_000_000,
      message: '10000.00 remains outstanding.',
    }

    expect(describeReason(reason).details).toEqual([
      { label: 'Due date', value: '30 Oct 2026' },
      { label: 'Outstanding', value: '₹10,000.00' },
    ])
  })

  it('builds a sentence when the server supplied no message', () => {
    expect(
      describeReason({ promisedDate: '2026-08-31', outstandingQuantity: 3 }),
    ).toEqual({
      message: 'Promised date 31 Aug 2026 · Outstanding quantity 3',
      details: [],
    })
  })

  it('drops nested objects instead of dumping JSON at the reader', () => {
    const described = describeReason({
      message: 'Something was flagged.',
      nested: { hidden: true },
      tags: ['stock', 'urgent'],
    })

    expect(described).toEqual({
      message: 'Something was flagged.',
      details: [{ label: 'Tags', value: 'stock, urgent' }],
    })
    expect(JSON.stringify(described)).not.toContain('hidden')
  })

  it('joins an array of reasons', () => {
    expect(describeReason(['One', 'Two'])).toEqual({
      message: 'One · Two',
      details: [],
    })
  })

  it('has a readable fallback for an empty reason', () => {
    expect(describeReason(null).message).toContain('without further detail')
    expect(describeReason(undefined).message).toContain('without further detail')
  })
})
