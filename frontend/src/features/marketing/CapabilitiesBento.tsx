import { Boxes, CheckCircle2, Fingerprint, ShieldCheck } from 'lucide-react'

const RISK_INPUTS = [
  { key: 'M', name: 'Worst line excess', value: '4.0 pp', note: 'single line over its ceiling' },
  { key: 'W', name: 'Value-weighted excess', value: '0.18', note: 'concession share across line value' },
  { key: 'E', name: 'Excess money', value: '₹23,520', note: 'total conceded beyond policy ceilings' },
  { key: 'D', name: 'Aggregate discount', value: '11.4%', note: 'across the whole quotation' },
]

export function CapabilitiesBento() {
  return (
    <section id="capabilities" className="border-t border-line bg-canvas-sunken/60 py-16 sm:py-20">
      <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-6">
        <div className="max-w-3xl">
          <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-brass-600">
            Governed Capabilities
          </p>
          <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight text-text sm:text-4xl">
            The hard parts, engineered properly
          </h2>
          <p className="mt-4 text-base leading-relaxed text-text-secondary">
            Discount governance, inventory allocation, hybrid recurring billing and cryptographic
            audit are enforced in the backend — not approximated in browser forms.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {/* Risk engine — hero bento tile (spans 2 columns) */}
          <div className="rounded-[--radius-showcase] border border-line bg-panel p-7 shadow-panel lg:col-span-2">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl border border-forest-200 bg-forest-50 text-forest-700">
                <ShieldCheck className="size-5" aria-hidden />
              </span>
              <div>
                <h3 className="font-serif text-2xl font-semibold text-text">
                  A risk engine that shows its working
                </h3>
                <p className="text-2xs font-medium uppercase tracking-wider text-brass-600">
                  Dual-tier sequential approval
                </p>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-text-secondary">
              Every quotation is scored on four independent measures, and the strictest one decides
              the approval route. A compliant line contributes zero — it can never quietly offset another
              line&apos;s policy breach.
            </p>

            {/* Live mathematical evaluation breakdown */}
            <div className="mt-6 rounded-xl border border-line bg-canvas-sunken p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                <span className="font-mono text-2xs uppercase tracking-wider text-text-muted">
                  Live Evaluation Model · Policy v3.2
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-stop-border bg-stop-surface px-2.5 py-0.5 text-2xs font-semibold text-stop-text">
                  Step 1 Required: Sales Manager
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {RISK_INPUTS.map((item) => (
                  <div
                    key={item.key}
                    className="flex flex-col justify-between rounded-lg border border-line/80 bg-panel p-3 shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-text-muted">
                        [{item.key}] {item.name}
                      </span>
                      <span className="font-mono text-xs font-bold text-forest-700">
                        {item.value}
                      </span>
                    </div>
                    <span className="mt-1 text-2xs text-text-muted">{item.note}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 text-2xs text-text-secondary">
                <span>
                  Outcome: <strong className="font-semibold text-text">Requires Manager</strong> → then{' '}
                  <strong className="font-semibold text-text">Finance VP</strong>
                </span>
                <span className="font-mono text-forest-700">Composite Index: 0.84</span>
              </div>
            </div>
          </div>

          {/* SHA-256 Customer acceptance seal tile */}
          <div className="flex flex-col justify-between rounded-[--radius-showcase] border border-line bg-panel p-7 shadow-panel">
            <div>
              <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-brass-200 bg-brass-50 text-brass-700">
                <Fingerprint className="size-5" aria-hidden />
              </div>
              <h3 className="font-serif text-xl font-semibold text-text">
                Hash-verified customer acceptance
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                When a customer signs, the exact approved commercial terms (lines, discounts, quantities
                and payment terms) are sealed with a cryptographic SHA-256 hash. If anything changes
                in-flight, the deal cannot be accepted.
              </p>
            </div>

            <div className="mt-6 rounded-xl border border-line bg-canvas-sunken p-4">
              <span className="block font-mono text-2xs uppercase tracking-wider text-text-muted">
                Commercial Hash Sealed
              </span>
              <p className="mt-1 break-all font-mono text-2xs font-semibold text-forest-700">
                sha256: 7f8b9a14c2e6d89f01ab43c8…
              </p>
              <div className="mt-3 flex items-center gap-1.5 text-2xs font-medium text-ok-text">
                <CheckCircle2 className="size-3.5 text-ok-text" aria-hidden />
                <span>Zero drift between review & contract</span>
              </div>
            </div>
          </div>

          {/* Atomic stock fulfillment tile */}
          <div className="flex flex-col justify-between rounded-[--radius-showcase] border border-line bg-panel p-7 shadow-panel lg:col-span-3">
            <div className="grid gap-6 md:grid-cols-[1fr_1.4fr] md:items-center">
              <div>
                <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-forest-200 bg-forest-50 text-forest-700">
                  <Boxes className="size-5" aria-hidden />
                </div>
                <h3 className="font-serif text-2xl font-semibold text-text">
                  Atomic inventory & order settlement
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                  Customer confirmation executes in a single database transaction: stock is deducted,
                  backorders are assigned, subscriptions are provisioned, and the initial invoice is
                  created simultaneously.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-line bg-canvas-sunken p-4">
                  <span className="font-mono text-xs font-semibold text-forest-700">01. Stock</span>
                  <p className="mt-1 text-sm font-semibold text-text">Deducted Immediately</p>
                  <p className="mt-0.5 text-2xs text-text-muted">Zero risk of overselling inventory</p>
                </div>
                <div className="rounded-xl border border-line bg-canvas-sunken p-4">
                  <span className="font-mono text-xs font-semibold text-forest-700">02. Backorder</span>
                  <p className="mt-1 text-sm font-semibold text-text">Automatic Split</p>
                  <p className="mt-0.5 text-2xs text-text-muted">Routed to replenishment desk</p>
                </div>
                <div className="rounded-xl border border-line bg-canvas-sunken p-4">
                  <span className="font-mono text-xs font-semibold text-forest-700">03. Invoicing</span>
                  <p className="mt-1 text-sm font-semibold text-text">Generated at Once</p>
                  <p className="mt-0.5 text-2xs text-text-muted">Prorated ledger lines verified</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
