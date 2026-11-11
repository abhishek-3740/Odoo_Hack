import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

import { Button, IconButton } from './primitives'

/**
 * Overlays.
 *
 * Built on Radix so focus trapping, escape handling, scroll locking and
 * `aria-modal` are correct — the parts of a dialog that are easy to get subtly
 * wrong by hand and impossible to notice without a keyboard. Everything visual
 * is ours.
 *
 * One thing Radix cannot do for us here: these dialogs are opened from ordinary
 * buttons rather than from `Dialog.Trigger`, so Radix's own close handler has no
 * trigger to return focus to and drops it on the body. {@link useFocusReturn}
 * remembers what was focused when the dialog opened and puts it back, which is
 * the difference between closing a dialog with the keyboard and losing your
 * place on the page entirely.
 */

/** Remembers the element focused before an overlay opened, and restores it. */
function useFocusReturn(open: boolean) {
  const previous = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) {
      previous.current = document.activeElement as HTMLElement | null
    }
  }, [open])

  return (event: Event) => {
    // Radix would otherwise focus its own (absent) trigger and leave the page.
    event.preventDefault()
    previous.current?.focus?.()
  }
}

/* ------------------------------------------------------------------ dialog */

const OVERLAY = cn(
  'fixed inset-0 z-50 bg-ink-950/40 backdrop-blur-[2px]',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
)

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Blocks the close button and outside-click while a mutation is in flight. */
  busy?: boolean
}

const DIALOG_SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  busy,
}: DialogProps) {
  const returnFocus = useFocusReturn(open)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={busy ? () => {} : onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY} />
        <DialogPrimitive.Content
          onCloseAutoFocus={returnFocus}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault()
          }}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2',
            'rounded-[--radius-panel] border border-line bg-panel shadow-overlay',
            'max-h-[calc(100vh-3rem)] overflow-hidden flex flex-col',
            DIALOG_SIZES[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[15px] font-semibold leading-tight text-text">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton label="Close" size="sm" disabled={busy}>
                <X className="size-4" aria-hidden />
              </IconButton>
            </DialogPrimitive.Close>
          </div>

          <div className="scroll-subtle min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-panel-muted px-5 py-3">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/* --------------------------------------------------------- confirm dialog */

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** What will happen. Written so the user can decide without re-reading the screen. */
  body: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'primary' | 'danger'
  busy?: boolean
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  busy,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-[13px] leading-relaxed text-text">{body}</div>
    </Dialog>
  )
}

/* --------------------------------------------------------------- side panel */

/**
 * A drawer from the right.
 *
 * The workspace inspector becomes one of these below desktop widths, so the same
 * content works at 1440px and at 390px without a second implementation.
 */
export function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: 'md' | 'lg'
}) {
  const returnFocus = useFocusReturn(open)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY} />
        <DialogPrimitive.Content
          onCloseAutoFocus={returnFocus}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-panel shadow-overlay',
            width === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[15px] font-semibold text-text">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-[13px] text-text-secondary">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton label="Close panel" size="sm">
                <X className="size-4" aria-hidden />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          <div className="scroll-subtle min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? (
            <div className="border-t border-line bg-panel-muted px-5 py-3">{footer}</div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/* ----------------------------------------------------------------- tooltip */

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={280} skipDelayDuration={120}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

/**
 * Supplementary detail on hover or focus.
 *
 * Never the only place information lives: a tooltip is unreachable on touch and
 * easy to miss, so anything a decision depends on is also on the page.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 max-w-xs rounded-[--radius-control] bg-ink-900 px-2.5 py-1.5',
            'text-xs leading-relaxed text-text-inverse shadow-overlay',
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-ink-900" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

/* ----------------------------------------------------------------- popover */

export function Popover({
  trigger,
  children,
  align = 'end',
  className,
}: {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
}) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          sideOffset={8}
          className={cn(
            'z-50 rounded-[--radius-panel] border border-line bg-panel p-4 shadow-overlay',
            'w-[min(22rem,calc(100vw-2rem))]',
            className,
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/* ----------------------------------------------------------------- menu */

export function Menu({
  trigger,
  children,
  align = 'end',
}: {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <DropdownPrimitive.Root>
      <DropdownPrimitive.Trigger asChild>{trigger}</DropdownPrimitive.Trigger>
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content
          align={align}
          sideOffset={6}
          className={cn(
            'z-50 min-w-52 overflow-hidden rounded-[--radius-panel] border border-line',
            'bg-panel p-1 shadow-overlay',
          )}
        >
          {children}
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  )
}

export function MenuItem({
  children,
  onSelect,
  icon,
  tone = 'default',
  disabled,
}: {
  children: ReactNode
  onSelect?: () => void
  icon?: ReactNode
  tone?: 'default' | 'danger'
  disabled?: boolean
}) {
  return (
    <DropdownPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[13px] outline-none',
        'data-[highlighted]:bg-canvas-sunken data-[disabled]:cursor-not-allowed data-[disabled]:text-text-muted',
        tone === 'danger' ? 'text-stop-text' : 'text-text',
      )}
    >
      {icon}
      {children}
    </DropdownPrimitive.Item>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownPrimitive.Label className="px-2.5 py-1.5 text-2xs font-semibold uppercase tracking-wide text-text-muted">
      {children}
    </DropdownPrimitive.Label>
  )
}

export function MenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-line" />
}

/* -------------------------------------------------------- disclosure hook */

/** Small helper so screens do not each re-declare open/close state. */
export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial)
  return {
    open,
    setOpen,
    show: () => setOpen(true),
    hide: () => setOpen(false),
    toggle: () => setOpen((value) => !value),
  }
}
