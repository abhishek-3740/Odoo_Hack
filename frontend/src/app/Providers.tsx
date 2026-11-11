import { QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Toaster } from 'sonner'

import { AuthProvider } from '@/auth/AuthProvider'
import { TooltipProvider } from '@/design-system'
import { RealtimeProvider } from '@/realtime/RealtimeProvider'

import { createQueryClient } from './queryClient'

/**
 * Application-wide providers.
 *
 * Order is load-bearing: the query client has to exist before the auth provider
 * (which clears the cache on a persona change), and the realtime provider has to
 * sit inside auth (it needs the token and must tear down with the session).
 *
 * Toasts confirm things that succeeded. Failures that need a decision stay
 * inline on the screen where the work was happening — see `InlineError`.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RealtimeProvider>
          <TooltipProvider>
            {children}
            <Toaster
              position="bottom-right"
              closeButton
              duration={4200}
              toastOptions={{
                classNames: {
                  toast:
                    'rounded-[--radius-panel] border border-line bg-panel text-text shadow-overlay',
                  description: 'text-text-secondary',
                },
              }}
            />
          </TooltipProvider>
        </RealtimeProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
