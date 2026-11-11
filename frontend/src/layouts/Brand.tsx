import { Link } from 'react-router-dom'

import { cn } from '@/lib/cn'

/**
 * The mark.
 *
 * Three connected nodes on one path — the same idea the landing diagram animates
 * at full size: a deal is a sequence of linked decisions, not a single event.
 * Drawn inline rather than loaded as an asset so it never flashes in late.
 */
export function Mark({ className, tone = 'forest' }: { className?: string; tone?: 'forest' | 'paper' }) {
  const stroke = tone === 'paper' ? 'var(--color-canvas)' : 'var(--color-forest-500)'
  const fill = tone === 'paper' ? 'var(--color-canvas)' : 'var(--color-forest-500)'
  return (
    <svg viewBox="0 0 28 28" aria-hidden className={cn('size-7', className)}>
      <path
        d="M5 20.5 L11.5 11 L18 16 L23.5 6.5"
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.45"
      />
      <circle cx="5" cy="20.5" r="2.6" fill={fill} />
      <circle cx="11.5" cy="11" r="2.6" fill={fill} opacity="0.72" />
      <circle cx="18" cy="16" r="2.6" fill={fill} opacity="0.72" />
      <circle cx="23.5" cy="6.5" r="3" fill="var(--color-brass-500)" />
    </svg>
  )
}

export function Wordmark({
  to = '/',
  tone = 'forest',
  className,
  suffix,
}: {
  to?: string
  tone?: 'forest' | 'paper'
  className?: string
  suffix?: string
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group inline-flex min-w-0 items-center gap-2.5 rounded-[--radius-control]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500',
        className,
      )}
    >
      <Mark tone={tone} className="shrink-0" />
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn(
            'truncate text-[15px] font-semibold tracking-[-0.015em]',
            tone === 'paper' ? 'text-text-inverse' : 'text-text',
          )}
        >
          DealFlow
          <span className={tone === 'paper' ? 'text-brass-300' : 'text-brass-500'}>360</span>
        </span>
        {suffix ? (
          <span
            className={cn(
              'hidden truncate text-2xs font-medium uppercase tracking-[0.09em] sm:inline',
              tone === 'paper' ? 'text-text-inverse-muted' : 'text-text-muted',
            )}
          >
            {suffix}
          </span>
        ) : null}
      </span>
    </Link>
  )
}
