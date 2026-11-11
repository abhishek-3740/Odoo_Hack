import { Clock, Database, Lock } from 'lucide-react'

const GUARANTEES = [
  {
    icon: Lock,
    title: 'Strict transactional DDL',
    desc: 'Schema migrations apply atomically or rollback completely; no half-migrated states in production.',
  },
  {
    icon: Database,
    title: 'Optimistic concurrency versioning',
    desc: 'Quotes, line revisions and inventory levels check revision version numbers to eliminate race conditions.',
  },
  {
    icon: Clock,
    title: 'Transactional outbox event bus',
    desc: 'Real-time WebSocket events and audit records commit in the same database transaction as business operations.',
  },
]

const STACK = [
  { label: 'Backend', tech: 'FastAPI + Python 3.12' },
  { label: 'Database', tech: 'PostgreSQL 18 + SQLAlchemy Async' },
  { label: 'Realtime', tech: 'Native WebSocket events' },
  { label: 'Frontend', tech: 'React 19 + TypeScript + Vite 7' },
  { label: 'Styling', tech: 'Tailwind CSS v4' },
]

export function IntegrityStrip() {
  return (
    <section className="border-t border-line bg-canvas-sunken/40 py-16 sm:py-20">
      <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-brass-600">
            Enterprise Architecture
          </p>
          <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight text-text sm:text-4xl">
            Reliability at every layer
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">
            Built from scratch to guarantee data integrity, eliminate phantom edits, and scale without
            silent discrepancies.
          </p>
        </div>

        {/* 3 Guarantees */}
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {GUARANTEES.map((g) => {
            const Icon = g.icon
            return (
              <div
                key={g.title}
                className="rounded-[--radius-showcase] border border-line bg-panel p-6 shadow-panel"
              >
                <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-forest-200 bg-forest-50 text-forest-700">
                  <Icon className="size-4" aria-hidden />
                </div>
                <h3 className="font-serif text-base font-semibold text-text">{g.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-text-secondary">{g.desc}</p>
              </div>
            )
          })}
        </div>

        {/* Tech Stack Bar */}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-panel px-6 py-4 shadow-panel">
          <span className="font-mono text-2xs uppercase tracking-wider text-text-muted">
            Production Stack
          </span>
          <div className="flex flex-wrap items-center gap-6 sm:gap-8">
            {STACK.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-xs">
                <span className="font-medium text-text-muted">{s.label}:</span>
                <span className="font-mono font-semibold text-text">{s.tech}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
