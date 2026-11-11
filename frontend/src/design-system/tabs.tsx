import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * Tabs.
 *
 * Radix gives correct roving tabindex and arrow-key navigation. The wrapper adds
 * the one thing a workspace needs beyond that: tabs scroll horizontally inside
 * their own strip on narrow screens instead of wrapping into a second row that
 * shifts the content below.
 */

export interface TabDefinition {
  value: string
  label: string
  /** A count or state chip beside the label. */
  badge?: ReactNode
  disabled?: boolean
  disabledReason?: string
}

export function Tabs({
  value,
  onValueChange,
  tabs,
  children,
  label,
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  tabs: TabDefinition[]
  children: ReactNode
  /** Accessible name for the tab strip. */
  label: string
  className?: string
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={className}>
      <TabsPrimitive.List
        aria-label={label}
        className="scroll-subtle -mb-px flex gap-1 overflow-x-auto border-b border-line"
      >
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            title={tab.disabled ? tab.disabledReason : undefined}
            className={cn(
              'relative flex shrink-0 items-center gap-2 whitespace-nowrap px-3.5 py-2.5',
              'text-[13px] font-medium text-text-secondary transition-colors',
              'border-b-2 border-transparent -mb-px',
              'hover:text-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest-500',
              'data-[state=active]:border-forest-500 data-[state=active]:text-text data-[state=active]:font-semibold',
              'disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:text-text-muted',
            )}
          >
            {tab.label}
            {tab.badge}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  )
}

export function TabPanel({
  value,
  children,
  className,
}: {
  value: string
  children: ReactNode
  className?: string
}) {
  return (
    <TabsPrimitive.Content
      value={value}
      className={cn('pt-5 focus-visible:outline-none', className)}
    >
      {children}
    </TabsPrimitive.Content>
  )
}
