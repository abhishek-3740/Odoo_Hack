/**
 * The marketing workflow scene.
 *
 * A labelled illustration, not a live view: it makes no API call and shows no
 * customer data. The real deal timeline in the workspace uses the same visual
 * vocabulary but only lights a milestone after the server confirms it, and the
 * two must never be confused — so every figure here is an obvious round number
 * and the page says in words that these are examples.
 *
 * Geometry is authored once in a fixed coordinate space and scaled by the SVG
 * viewBox, so the layout is identical at every width without any measurement.
 */

export interface SceneNode {
  id: string
  title: string
  /** One line of supporting detail; shown inside the node at wide widths. */
  detail: string
  /** One sentence for the inspector, explaining what this step really does. */
  explanation: string
  x: number
  y: number
  w?: number
  h?: number
  /** Visual weight — `anchor` nodes are the outcomes worth emphasising. */
  kind?: 'step' | 'gate' | 'anchor' | 'branch'
}

export interface SceneEdge {
  id: string
  from: string
  to: string
  /** SVG path in scene coordinates. Packets travel along exactly this curve. */
  d: string
  /** Where the edge's own caption sits, when it has one. */
  labelAt?: { x: number; y: number; anchor?: 'start' | 'middle' | 'end' }
  label?: string
  /** Drawn as a dashed line: a route that exists but is not taken in this run. */
  conditional?: boolean
}

export interface ScenePhase {
  edge: string
  /** The chip that rides the packet. Short, and never a changing money figure. */
  packet: string
  /** Milliseconds for the packet to travel this edge. */
  travelMs: number
  /** Pause after arrival before the next phase begins. */
  holdMs: number
  /** The sentence the inspector shows while this phase runs. */
  narration: string
}

export interface Scenario {
  id: string
  label: string
  summary: string
  /** Edges that exist in this scenario. Others are hidden entirely. */
  edges: string[]
  /** Edges drawn but not travelled — the route policy did not take. */
  dimmed?: string[]
  phases: ScenePhase[]
}

/* ------------------------------------------------------------------ layout */

export const SCENE_WIDTH = 1180
export const SCENE_HEIGHT = 600
export const NODE_W = 170
export const NODE_H = 56

export const NODES: SceneNode[] = [
  {
    id: 'request',
    title: 'Customer request',
    detail: 'From the catalogue',
    explanation:
      'A customer asks for a quotation from the catalogue. It becomes a real quotation owned by their account manager, priced at list.',
    x: 16,
    y: 40,
  },
  {
    id: 'quote',
    title: 'Sales quotation',
    detail: 'Lines, quantities, discounts',
    explanation:
      'The salesperson builds the terms. Prices, tax and totals are resolved on the server — the browser only sends what was asked for.',
    x: 226,
    y: 40,
  },
  {
    id: 'policy',
    title: 'Policy evaluation',
    detail: 'Ceilings and margin',
    explanation:
      'Every saved version is measured against the discount policy in force: tier ceilings, category ceilings, worst line, weighted excess and margin.',
    x: 436,
    y: 40,
    kind: 'branch',
  },
  {
    id: 'manager',
    title: 'Manager approval',
    detail: 'Step 1',
    explanation:
      'Step 1. Raised only when the terms breach the policy. A quotation cannot be approved by the person who submitted it.',
    x: 668,
    y: 40,
    kind: 'gate',
  },
  {
    id: 'finance',
    title: 'Finance approval',
    detail: 'Step 2',
    explanation:
      'Step 2, and strictly after step 1. Finance sees the step immediately but cannot decide until the manager has approved.',
    x: 878,
    y: 40,
    kind: 'gate',
  },
  {
    id: 'seller',
    title: 'Seller agreement',
    detail: 'Adopts these exact terms',
    explanation:
      'The salesperson records that they stand behind this exact version. Independent of approval — it can happen before or after.',
    x: 436,
    y: 172,
    kind: 'gate',
  },
  {
    id: 'customer',
    title: 'Customer acceptance',
    detail: 'One exact version',
    explanation:
      'The customer accepts one specific version, verified by its commercial hash. If the terms moved, the acceptance is refused rather than applied to a price they never saw.',
    x: 436,
    y: 272,
    kind: 'gate',
  },
  {
    id: 'order',
    title: 'Order confirmed',
    detail: 'All required gates met',
    explanation:
      'The order is created automatically the moment the last outstanding gate clears — in whichever order they happen to land.',
    x: 878,
    y: 208,
    h: 68,
    kind: 'anchor',
  },
  {
    id: 'fulfilment',
    title: 'Fulfilment',
    detail: 'Reserve · split · backorder',
    explanation:
      'Stock is reserved across warehouses under a lock. Anything short becomes a real backorder with a real expected date, or no date at all when none is known.',
    x: 668,
    y: 412,
  },
  {
    id: 'billing',
    title: 'Billing',
    detail: 'Invoice · subscription',
    explanation:
      'One-time lines are invoiced; recurring lines start a subscription with its own period and cadence. A shipment is not required first.',
    x: 878,
    y: 412,
  },
  {
    id: 'payment',
    title: 'Payment recorded',
    detail: 'Allocated to invoices',
    explanation:
      'A receipt is recorded and allocated across open invoices, oldest due first. Anything left over stays as customer credit.',
    x: 878,
    y: 512,
    kind: 'anchor',
  },
]

export const NODES_BY_ID: Record<string, SceneNode> = Object.fromEntries(
  NODES.map((node) => [node.id, node]),
)

/* ------------------------------------------------------------------- edges */

/** Right edge midpoint of a node. */
function right(id: string) {
  const n = NODES_BY_ID[id]
  return { x: n.x + (n.w ?? NODE_W), y: n.y + (n.h ?? NODE_H) / 2 }
}
/** Left edge midpoint. */
function left(id: string) {
  const n = NODES_BY_ID[id]
  return { x: n.x, y: n.y + (n.h ?? NODE_H) / 2 }
}
/** Bottom centre. */
function bottom(id: string) {
  const n = NODES_BY_ID[id]
  return { x: n.x + (n.w ?? NODE_W) / 2, y: n.y + (n.h ?? NODE_H) }
}
/** Top centre. */
function top(id: string) {
  const n = NODES_BY_ID[id]
  return { x: n.x + (n.w ?? NODE_W) / 2, y: n.y }
}

function straight(a: { x: number; y: number }, b: { x: number; y: number }) {
  return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
}

/** A horizontal-ish S curve: leaves and arrives level, bends in between. */
function curveH(a: { x: number; y: number }, b: { x: number; y: number }, bow = 0.55) {
  const dx = (b.x - a.x) * bow
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
}

/** A vertical S curve. */
function curveV(a: { x: number; y: number }, b: { x: number; y: number }, bow = 0.55) {
  const dy = (b.y - a.y) * bow
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy}, ${b.x} ${b.y - dy}, ${b.x} ${b.y}`
}

export const EDGES: SceneEdge[] = [
  {
    id: 'request-quote',
    from: 'request',
    to: 'quote',
    d: straight(right('request'), left('quote')),
  },
  {
    id: 'quote-policy',
    from: 'quote',
    to: 'policy',
    d: straight(right('quote'), left('policy')),
  },
  {
    id: 'policy-manager',
    from: 'policy',
    to: 'manager',
    d: straight(right('policy'), left('manager')),
    // Both branch labels sit in the clear bands above and below the top row.
    // Inside the 62px gap between the nodes they overlapped both of them.
    label: 'Outside policy',
    labelAt: { x: 637, y: 28, anchor: 'middle' },
  },
  {
    id: 'manager-finance',
    from: 'manager',
    to: 'finance',
    d: straight(right('manager'), left('finance')),
  },
  {
    // Down the right-hand rail into the order.
    id: 'finance-order',
    from: 'finance',
    to: 'order',
    d: curveV(bottom('finance'), top('order'), 0.6),
  },
  {
    // The within-policy route: straight from evaluation to the order rail.
    id: 'policy-order',
    from: 'policy',
    to: 'order',
    d: `M ${right('policy').x} ${right('policy').y + 14} C 720 ${right('policy').y + 14}, 963 120, 963 ${top('order').y}`,
    label: 'Within policy',
    labelAt: { x: 690, y: 134, anchor: 'middle' },
  },
  {
    id: 'seller-order',
    from: 'seller',
    to: 'order',
    d: curveH(right('seller'), { x: left('order').x, y: left('order').y - 12 }, 0.6),
  },
  {
    id: 'customer-order',
    from: 'customer',
    to: 'order',
    d: curveH(right('customer'), { x: left('order').x, y: left('order').y + 14 }, 0.6),
  },
  {
    id: 'order-fulfilment',
    from: 'order',
    to: 'fulfilment',
    d: `M ${bottom('order').x} ${bottom('order').y} C ${bottom('order').x} 340, ${top('fulfilment').x} 350, ${top('fulfilment').x} ${top('fulfilment').y}`,
  },
  {
    id: 'order-billing',
    from: 'order',
    to: 'billing',
    d: straight(
      { x: bottom('order').x + 26, y: bottom('order').y },
      { x: top('billing').x + 26, y: top('billing').y },
    ),
  },
  {
    id: 'billing-payment',
    from: 'billing',
    to: 'payment',
    d: straight(bottom('billing'), top('payment')),
  },
  {
    // The negotiation loop: a counteroffer creates fresh terms to evaluate.
    id: 'customer-quote',
    from: 'customer',
    to: 'quote',
    d: `M ${left('customer').x} ${left('customer').y} C 340 ${left('customer').y}, 180 ${left('customer').y}, 180 160 C 180 100, ${bottom('quote').x} 110, ${bottom('quote').x} ${bottom('quote').y}`,
    label: 'Counteroffer',
    labelAt: { x: 186, y: 232, anchor: 'start' },
  },
]

export const EDGES_BY_ID: Record<string, SceneEdge> = Object.fromEntries(
  EDGES.map((edge) => [edge.id, edge]),
)

/* --------------------------------------------------------------- scenarios */

const CORE_OUTPUTS: ScenePhase[] = [
  {
    edge: 'order-fulfilment',
    packet: 'Reserve stock',
    travelMs: 700,
    holdMs: 240,
    narration:
      'Fulfilment reserves stock across warehouses. Anything short becomes a backorder rather than an unexplained delay.',
  },
  {
    edge: 'order-billing',
    packet: 'Raise invoice',
    travelMs: 700,
    holdMs: 240,
    narration:
      'Billing raises the one-time invoice and starts any subscription. It does not wait for a shipment.',
  },
  {
    edge: 'billing-payment',
    packet: 'Receipt ₹39,300',
    travelMs: 700,
    holdMs: 700,
    narration:
      'A receipt is recorded against the invoice. Cash collected and revenue invoiced stay separate figures throughout.',
  },
]

export const SCENARIOS: Scenario[] = [
  {
    id: 'approval',
    label: 'Needs approval',
    summary: 'A discount above the customer’s ceiling: manager first, then finance.',
    edges: [
      'request-quote',
      'quote-policy',
      'policy-manager',
      'manager-finance',
      'finance-order',
      'seller-order',
      'customer-order',
      'order-fulfilment',
      'order-billing',
      'billing-payment',
      'policy-order',
    ],
    dimmed: ['policy-order'],
    phases: [
      {
        edge: 'request-quote',
        packet: 'Request',
        travelMs: 720,
        holdMs: 220,
        narration:
          'A customer asks for a quotation from the catalogue. It arrives as a real quotation, owned by their account manager.',
      },
      {
        edge: 'quote-policy',
        packet: 'Quote v1',
        travelMs: 700,
        holdMs: 260,
        narration:
          'The salesperson saves terms. Every saved version is priced and measured on the server.',
      },
      {
        edge: 'policy-manager',
        packet: 'Review required',
        travelMs: 780,
        holdMs: 320,
        narration:
          'The discount is above this customer’s ceiling, so step 1 is raised for a manager with the exact reason attached.',
      },
      {
        edge: 'manager-finance',
        packet: 'Step 1 approved',
        travelMs: 720,
        holdMs: 300,
        narration:
          'The manager approves. Only now can finance decide — step 2 was visible all along, but never actionable early.',
      },
      {
        edge: 'finance-order',
        packet: 'Step 2 approved',
        travelMs: 820,
        holdMs: 260,
        narration: 'Finance approves. That clears the approval gate, but not the other two.',
      },
      {
        edge: 'seller-order',
        packet: 'Seller adopted',
        travelMs: 720,
        holdMs: 240,
        narration:
          'The salesperson adopts these exact terms. This is a separate fact from approval.',
      },
      {
        edge: 'customer-order',
        packet: 'Accepted v1',
        travelMs: 720,
        holdMs: 420,
        narration:
          'The customer accepts this exact version. With all three gates met, the order is created — no one had to remember to press a button.',
      },
      ...CORE_OUTPUTS,
    ],
  },
  {
    id: 'within-policy',
    label: 'Within policy',
    summary: 'Nothing breaches the policy, so no approval step is created at all.',
    edges: [
      'request-quote',
      'quote-policy',
      'policy-order',
      'seller-order',
      'customer-order',
      'order-fulfilment',
      'order-billing',
      'billing-payment',
      'policy-manager',
      'manager-finance',
      'finance-order',
    ],
    dimmed: ['policy-manager', 'manager-finance', 'finance-order'],
    phases: [
      {
        edge: 'request-quote',
        packet: 'Request',
        travelMs: 700,
        holdMs: 200,
        narration: 'The same start: a catalogue request becomes a real quotation.',
      },
      {
        edge: 'quote-policy',
        packet: 'Quote v1',
        travelMs: 680,
        holdMs: 260,
        narration: 'Terms are saved and evaluated against the policy in force.',
      },
      {
        edge: 'policy-order',
        packet: 'No approval needed',
        travelMs: 900,
        holdMs: 360,
        narration:
          'Nothing breaches a ceiling and margin holds, so no manager or finance step is created. Nobody is waiting in a queue.',
      },
      {
        edge: 'seller-order',
        packet: 'Seller adopted',
        travelMs: 700,
        holdMs: 220,
        narration: 'The salesperson adopts the terms they proposed.',
      },
      {
        edge: 'customer-order',
        packet: 'Accepted v1',
        travelMs: 700,
        holdMs: 400,
        narration:
          'The customer accepts. Two gates were all this deal ever needed, and the order follows immediately.',
      },
      ...CORE_OUTPUTS,
    ],
  },
  {
    id: 'negotiation',
    label: 'Negotiated deal',
    summary: 'The customer counters, the terms are re-priced, and everything re-evaluates.',
    edges: [
      'request-quote',
      'quote-policy',
      'customer-quote',
      'policy-manager',
      'manager-finance',
      'finance-order',
      'seller-order',
      'customer-order',
      'order-fulfilment',
      'order-billing',
      'billing-payment',
      'policy-order',
    ],
    dimmed: ['policy-order'],
    phases: [
      {
        edge: 'quote-policy',
        packet: 'Quote v1',
        travelMs: 700,
        holdMs: 240,
        narration: 'The first version is priced and measured.',
      },
      {
        edge: 'customer-quote',
        packet: 'Asks 10% off',
        travelMs: 900,
        holdMs: 340,
        narration:
          'The customer proposes 10% off the whole quotation. It is priced at once and becomes version 2 — but seller agreement is reset, so nothing is committed.',
      },
      {
        edge: 'quote-policy',
        packet: 'Quote v2',
        travelMs: 700,
        holdMs: 300,
        narration:
          'Version 2 is measured against the policy from scratch. An approval given for version 1 does not carry over to terms that have changed.',
      },
      {
        edge: 'policy-manager',
        packet: 'Review required',
        travelMs: 780,
        holdMs: 300,
        narration:
          'At 10% this now breaches the ceiling, so a fresh approval chain is raised for the new version.',
      },
      {
        edge: 'manager-finance',
        packet: 'Step 1 approved',
        travelMs: 700,
        holdMs: 260,
        narration: 'The manager approves version 2. The earlier version stays in the history.',
      },
      {
        edge: 'finance-order',
        packet: 'Step 2 approved',
        travelMs: 800,
        holdMs: 240,
        narration: 'Finance approves the version that was actually negotiated.',
      },
      {
        edge: 'seller-order',
        packet: 'Seller adopted v2',
        travelMs: 700,
        holdMs: 220,
        narration:
          'The salesperson adopts the customer’s terms — the business agreeing to sell on them. A reply would not have done this.',
      },
      {
        edge: 'customer-order',
        packet: 'Accepted v2',
        travelMs: 700,
        holdMs: 420,
        narration:
          'The customer accepts version 2 — the exact version they proposed and the one the invoice will be raised from.',
      },
      ...CORE_OUTPUTS,
    ],
  },
]

export const DEFAULT_SCENARIO = SCENARIOS[0]

/** Total run time of a scenario, used for the progress rail. */
export function scenarioDuration(scenario: Scenario): number {
  return scenario.phases.reduce((total, phase) => total + phase.travelMs + phase.holdMs, 0)
}

/** The ordered text walkthrough shown under reduced motion. */
export function walkthrough(scenario: Scenario): Array<{ from: string; to: string; text: string }> {
  return scenario.phases.map((phase) => {
    const edge = EDGES_BY_ID[phase.edge]
    return {
      from: NODES_BY_ID[edge.from].title,
      to: NODES_BY_ID[edge.to].title,
      text: phase.narration,
    }
  })
}
