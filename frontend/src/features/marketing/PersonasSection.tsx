import { Briefcase, Check, Copy, CreditCard, ShoppingBag, UserCheck } from 'lucide-react'
import { useState } from 'react'

const PERSONAS = [
  {
    icon: Briefcase,
    role: 'Sales Representative',
    email: 'rep.a@dealflow.demo',
    badge: 'Internal · Quoting',
    text: 'Builds quotes, views live margin & stock, checks AI recommendations, submits discount exceptions, and answers buyers directly in the deal room.',
  },
  {
    icon: UserCheck,
    role: 'Sales Manager',
    email: 'manager.a@dealflow.demo',
    badge: 'Internal · Step 1 Review',
    text: 'Evaluates policy threshold breaches with the exact causative line attached. Approves, rejects, or requests structured revisions with comments.',
  },
  {
    icon: CreditCard,
    role: 'Finance & Operations',
    email: 'finance@dealflow.demo',
    badge: 'Internal · Step 2 Review',
    text: 'Secondary approval on large and high-risk deals, reviews multi-year billing schedules, manages credit memos, and handles invoice lifecycles.',
  },
  {
    icon: ShoppingBag,
    role: 'Customer Buyer (Acme Corp)',
    email: 'buyer@acme.demo',
    badge: 'External · Deal Room',
    text: 'Accesses the customer portal, negotiates terms on line items, reviews revision diffs, and signs approved quotes with SHA-256 seal.',
  },
]

export function PersonasSection() {
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null)

  const handleCopy = (email: string) => {
    void navigator.clipboard.writeText(email)
    setCopiedEmail(email)
    setTimeout(() => {
      setCopiedEmail((prev) => (prev === email ? null : prev))
    }, 2000)
  }

  return (
    <section id="personas" className="mx-auto w-full max-w-[1240px] px-4 py-16 sm:px-6 sm:py-20">
      <div className="max-w-3xl">
        <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-brass-600">
          Interactive Testing
        </p>
        <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight text-text sm:text-4xl">
          Seeded demo personas, ready to test
        </h2>
        <p className="mt-4 text-base leading-relaxed text-text-secondary">
          DealFlow360 comes pre-loaded with realistic enterprise roles. Click any persona to copy
          credentials and experience the platform from their exact vantage point.
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {PERSONAS.map((p) => {
          const Icon = p.icon
          const isCopied = copiedEmail === p.email

          return (
            <div
              key={p.email}
              className="group flex flex-col justify-between rounded-[--radius-showcase] border border-line bg-panel p-6 shadow-panel transition-all duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-raised"
            >
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-xl border border-forest-200/80 bg-forest-50 text-forest-700">
                    <Icon className="size-4" aria-hidden />
                  </div>
                  <span className="rounded-full border border-line bg-canvas-sunken px-2.5 py-0.5 text-2xs font-medium text-text-secondary">
                    {p.badge}
                  </span>
                </div>

                <h3 className="font-serif text-lg font-semibold text-text">{p.role}</h3>
                <p className="mt-2.5 text-xs leading-relaxed text-text-secondary">{p.text}</p>
              </div>

              <div className="mt-6 border-t border-line pt-4">
                <button
                  type="button"
                  onClick={() => handleCopy(p.email)}
                  className="flex w-full items-center justify-between rounded-[--radius-control] border border-line bg-canvas-sunken px-3 py-2 text-2xs font-mono transition-colors hover:border-forest-300 hover:bg-forest-50/50"
                  title="Click to copy email"
                >
                  <span className="truncate text-text font-medium">{p.email}</span>
                  {isCopied ? (
                    <span className="ml-2 inline-flex items-center gap-1 font-sans text-forest-700 font-semibold">
                      <Check className="size-3.5" aria-hidden />
                      Copied
                    </span>
                  ) : (
                    <Copy className="ml-2 size-3.5 shrink-0 text-text-muted group-hover:text-forest-700" aria-hidden />
                  )}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
