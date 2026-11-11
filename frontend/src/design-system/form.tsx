import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

import { basisPointsToInput, inputToBasisPoints } from '@/lib/money'
import { cn } from '@/lib/cn'

/**
 * Form primitives.
 *
 * Two rules the whole application depends on:
 *
 *  - Every control is associated with its label through `htmlFor`/`id`, and a
 *    `<select>` is never nested inside its `<label>`. Nesting pulls every
 *    option's text into the label's accessible name, which breaks assistive
 *    technology and any test that looks a field up by name.
 *  - A field's error, hint and unit are wired through `aria-describedby`, so the
 *    reason a value was refused is announced rather than only drawn.
 */

const CONTROL = cn(
  'w-full rounded-[--radius-control] border border-line-strong bg-panel px-3 text-sm text-text',
  'placeholder:text-text-muted transition-shadow',
  'focus:border-forest-400 focus:outline-none focus:ring-2 focus:ring-forest-500/25',
  'disabled:cursor-not-allowed disabled:bg-canvas-sunken disabled:text-text-muted',
  'aria-[invalid=true]:border-stop-border aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-stop-border/40',
)

export interface FieldProps {
  label: ReactNode
  /** Rendered under the control, and referenced by the control's description. */
  hint?: ReactNode
  error?: string | null
  required?: boolean
  className?: string
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
  }) => ReactNode
}

/** Wraps any control with a correctly wired label, hint and error. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-text">
        {label}
        {required ? (
          <span className="ml-1 text-stop-text" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={errorId} className="text-[13px] font-medium text-stop-text">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-[13px] leading-relaxed text-text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL, 'h-10', className)} {...props} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(CONTROL, 'py-2 leading-relaxed', className)} {...props} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(CONTROL, 'h-10 cursor-pointer appearance-none bg-no-repeat pr-9', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%2352615B' stroke-width='1.6'%3E%3Cpath d='M6 8l4 4 4-4'/%3E%3C/svg%3E\")",
          backgroundPosition: 'right 0.6rem center',
          backgroundSize: '1.1rem',
        }}
        {...props}
      />
    )
  },
)

export function Checkbox({
  label,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className={cn('flex gap-2.5', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line-strong text-forest-500 focus:ring-2 focus:ring-forest-500/30"
        {...props}
      />
      <label htmlFor={id} className="cursor-pointer text-[13px] leading-relaxed text-text">
        {label}
        {hint ? <span className="block text-text-secondary">{hint}</span> : null}
      </label>
    </div>
  )
}

/* --------------------------------------------------------- money and units */

/**
 * A percentage input backed by basis points.
 *
 * Users think in percent and the API counts in basis points. Rather than making
 * every screen convert (and get it wrong somewhere), this owns the conversion:
 * it shows "12.5", emits 1250, and refuses a value the server would reject
 * instead of sending it and surfacing an opaque validation error.
 */
export function PercentInput({
  label,
  valueBp,
  onChangeBp,
  hint,
  error,
  disabled,
  max = 99.99,
  className,
  id: providedId,
  'aria-label': ariaLabel,
}: {
  label?: ReactNode
  valueBp: number | null
  onChangeBp: (bp: number | null) => void
  hint?: ReactNode
  error?: string | null
  disabled?: boolean
  max?: number
  className?: string
  id?: string
  'aria-label'?: string
}) {
  // Every line in a quotation renders one of these, so an unlabelled instance
  // needs its own generated id — a shared literal would put duplicate ids on the
  // page and break every assistive lookup on it.
  const generatedId = useId()

  const control = (id: string, described?: string, invalid?: boolean) => (
    <div className="relative">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step="0.01"
        disabled={disabled}
        aria-describedby={described}
        aria-invalid={invalid}
        aria-label={label ? undefined : ariaLabel}
        value={basisPointsToInput(valueBp)}
        placeholder="0"
        onChange={(event) => onChangeBp(inputToBasisPoints(event.target.value))}
        className={cn(CONTROL, 'h-10 pr-8 tabular')}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-medium text-text-muted"
      >
        %
      </span>
    </div>
  )

  if (!label) {
    return <div className={className}>{control(providedId ?? generatedId)}</div>
  }
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, 'aria-describedby': described, 'aria-invalid': invalid }) =>
        control(id, described, invalid)
      }
    </Field>
  )
}

/** An amount in major units, with the currency shown as a fixed adornment. */
export function MoneyInput({
  label,
  currency = 'INR',
  value,
  onChange,
  hint,
  error,
  disabled,
  required,
  className,
  placeholder = '0.00',
}: {
  label: ReactNode
  currency?: string
  value: string
  onChange: (value: string) => void
  hint?: ReactNode
  error?: string | null
  disabled?: boolean
  required?: boolean
  className?: string
  placeholder?: string
}) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, 'aria-describedby': described, 'aria-invalid': invalid }) => (
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-medium text-text-muted"
          >
            {currency}
          </span>
          <input
            id={id}
            type="text"
            inputMode="decimal"
            disabled={disabled}
            aria-describedby={described}
            aria-invalid={invalid}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            className={cn(CONTROL, 'h-10 pl-12 tabular')}
          />
        </div>
      )}
    </Field>
  )
}

/**
 * A business date.
 *
 * `<input type="date">` speaks the same `YYYY-MM-DD` the API does, so the value
 * passes straight through with no Date object and therefore no timezone shift.
 */
export function DateInput({
  label,
  value,
  onChange,
  hint,
  error,
  min,
  max,
  required,
  disabled,
  className,
}: {
  label: ReactNode
  value: string | null
  onChange: (value: string | null) => void
  hint?: ReactNode
  error?: string | null
  min?: string
  max?: string
  required?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {({ id, 'aria-describedby': described, 'aria-invalid': invalid }) => (
        <input
          id={id}
          type="date"
          value={value ?? ''}
          min={min}
          max={max}
          disabled={disabled}
          aria-describedby={described}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value || null)}
          className={cn(CONTROL, 'h-10 tabular')}
        />
      )}
    </Field>
  )
}

/** A labelled quantity input that respects the product's own quantity mode. */
export function QuantityInput({
  value,
  onChange,
  integerOnly,
  disabled,
  label,
  className,
}: {
  value: string
  onChange: (value: string) => void
  integerOnly?: boolean
  disabled?: boolean
  label: string
  className?: string
}) {
  return (
    <input
      type="number"
      inputMode={integerOnly ? 'numeric' : 'decimal'}
      min={integerOnly ? 1 : 0.001}
      step={integerOnly ? 1 : 0.001}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={cn(CONTROL, 'h-9 w-24 tabular text-right', className)}
    />
  )
}
