import { Loader2 } from 'lucide-react'
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react'

import { cn } from '@/lib/cn'

/* ------------------------------------------------------------------ button */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'editorial'
type Size = 'sm' | 'md' | 'lg'

/**
 * Disabled has to read as disabled.
 *
 * Every variant dims to the same degree, and hover is suppressed — a control
 * that looks live but does nothing is worse than one that is plainly
 * unavailable, and this product disables a great many buttons on purpose.
 */
const DISABLED = 'disabled:opacity-45 disabled:shadow-none disabled:hover:bg-inherit'

const VARIANTS: Record<Variant, string> = {
  primary: `bg-forest-500 text-white shadow-panel hover:bg-forest-600 active:bg-forest-700 ${DISABLED}`,
  secondary: `bg-panel text-text border border-line-strong shadow-panel hover:bg-canvas-sunken active:bg-canvas-sunken ${DISABLED}`,
  ghost: `bg-transparent text-text-secondary hover:bg-canvas-sunken hover:text-text ${DISABLED}`,
  danger: `bg-stop-surface text-stop-text border border-stop-border hover:bg-stop-border/60 ${DISABLED}`,
  editorial: `bg-brass-500 text-white shadow-panel hover:bg-brass-600 active:bg-brass-700 ${DISABLED}`,
}

const SIZES: Record<Size, string> = {
  // 44px minimum touch target on small screens; tighter on pointer devices.
  sm: 'h-9 px-3 text-[13px] gap-1.5 min-h-11 sm:min-h-0',
  md: 'h-10 px-4 text-sm gap-2 min-h-11 sm:min-h-0',
  lg: 'h-12 px-6 text-[15px] gap-2.5',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Shows a spinner and blocks the click without changing the button's width. */
  busy?: boolean
  /**
   * Why this button is unavailable.
   *
   * A disabled control with no explanation is the single most common way a
   * workflow screen becomes unusable, so passing this renders the reason as the
   * accessible description rather than leaving the user to guess.
   */
  disabledReason?: string | null
  icon?: ReactNode
  iconAfter?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    busy = false,
    disabled,
    disabledReason,
    icon,
    iconAfter,
    className,
    children,
    ...props
  },
  ref,
) {
  const isDisabled = disabled || busy
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      disabled={isDisabled}
      title={isDisabled && disabledReason ? disabledReason : props.title}
      aria-describedby={props['aria-describedby']}
      className={cn(
        'inline-flex items-center justify-center rounded-[--radius-control] font-semibold',
        'transition-colors duration-150 select-none whitespace-nowrap',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
      {iconAfter}
    </button>
  )
})

/* -------------------------------------------------------------- icon button */

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon-only control with no name is invisible to a screen reader. */
  label: string
  variant?: Variant
  size?: 'sm' | 'md'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-[--radius-control] transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'size-8' : 'size-10',
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
})

/* ------------------------------------------------------------------ panels */

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Removes internal padding for tables that manage their own. */
  flush?: boolean
  tone?: 'default' | 'muted' | 'ink'
}

export function Panel({ flush, tone = 'default', className, ...props }: PanelProps) {
  return (
    <div
      className={cn(
        'rounded-[--radius-panel] border shadow-panel',
        tone === 'ink'
          ? 'border-line-inverse bg-ink-800 text-text-inverse'
          : tone === 'muted'
            ? 'border-line bg-panel-muted'
            : 'border-line bg-panel',
        !flush && 'p-5',
        className,
      )}
      {...props}
    />
  )
}

export interface PanelHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Renders the title as this level. Panels inside a page are usually h2/h3. */
  as?: 'h2' | 'h3' | 'h4'
  className?: string
}

export function PanelHeader({
  title,
  description,
  actions,
  as: Heading = 'h3',
  className,
}: PanelHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <Heading className="text-[15px] font-semibold leading-tight">{title}</Heading>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ badges */

export type BadgeTone = 'ok' | 'wait' | 'stop' | 'info' | 'neutral' | 'brass'

const BADGE_TONES: Record<BadgeTone, string> = {
  ok: 'bg-ok-surface text-ok-text border-ok-border',
  wait: 'bg-wait-surface text-wait-text border-wait-border',
  stop: 'bg-stop-surface text-stop-text border-stop-border',
  info: 'bg-info-surface text-info-text border-info-border',
  neutral: 'bg-neutral-surface text-neutral-text border-neutral-border',
  brass: 'bg-brass-50 text-brass-700 border-brass-200',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  icon?: ReactNode
  size?: 'sm' | 'md'
}

/**
 * A labelled state chip.
 *
 * Colour never carries meaning on its own here: the tone reinforces a word that
 * is always present, so the badge still reads correctly in monochrome and to
 * anyone who does not distinguish the hues.
 */
export function Badge({ tone = 'neutral', icon, size = 'md', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-2xs' : 'px-2.5 py-1 text-xs',
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  )
}

/* ----------------------------------------------------------------- surfaces */

export function Divider({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn('border-t border-line', className)} {...props} />
}

/** A quiet key/value row, used throughout detail panels. */
export function DetailRow({
  label,
  children,
  className,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5', className)}>
      <dt className="text-[13px] text-text-secondary">{label}</dt>
      <dd className="tabular text-[13px] font-medium text-text text-right">{children}</dd>
    </div>
  )
}

/* ------------------------------------------------------------------ loading */

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn('size-4 animate-spin text-text-muted', className)}
    />
  )
}

/**
 * A shaped placeholder.
 *
 * Sized to the content it replaces so nothing jumps when data arrives — layout
 * shift while a table populates is a real defect, not a cosmetic one.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-canvas-sunken', className)}
      {...props}
    />
  )
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn('h-3.5', index === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  )
}
