import { AlertOctagon, ArrowLeft, Home, RefreshCw } from 'lucide-react'
import { Link, isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'

import { ApiError, RECOVERY_GUIDANCE } from '@/api'
import { Button, Panel } from '@/design-system'

/**
 * What a route shows when it fails outright.
 *
 * A failed screen says which failure it was — denied, missing, offline or a bug
 * — and offers the recovery that actually applies. It never renders an empty
 * table, which reads as "there is nothing here" and is a different, wrong claim.
 */
export function RouteBoundary() {
  const error = useRouteError()
  const navigate = useNavigate()

  let title = 'This screen could not be loaded'
  let message = 'Something went wrong while opening this page.'
  let requestId: string | null = null
  let canRetry = true

  if (error instanceof ApiError) {
    requestId = error.requestId
    message = error.message
    if (error.status === 403) {
      title = 'Not available to your role'
      canRetry = false
    } else if (error.status === 404) {
      title = 'That record does not exist'
      message = 'It may have been removed, or it belongs to another team.'
      canRetry = false
    } else if (error.code === 'NETWORK_ERROR') {
      title = 'The server could not be reached'
    } else if (error.code === 'CONTRACT_ERROR') {
      title = 'The data did not arrive in a usable shape'
    }
    const guidance = RECOVERY_GUIDANCE[error.code]
    if (guidance) message = `${message} ${guidance}`
  } else if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? 'Page not found' : `Error ${error.status}`
    message = error.statusText || message
    canRetry = false
  } else if (error instanceof Error) {
    message = error.message
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg items-center px-4">
      <Panel className="w-full">
        <div className="flex gap-3">
          <span className="mt-0.5 text-stop-text">
            <AlertOctagon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-text">{title}</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">{message}</p>
            {requestId ? (
              <p className="tabular mt-2 text-2xs text-text-muted">Request {requestId}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {canRetry ? (
                <Button
                  variant="primary"
                  icon={<RefreshCw className="size-3.5" />}
                  onClick={() => navigate(0)}
                >
                  Reload this screen
                </Button>
              ) : null}
              <Button
                variant="secondary"
                icon={<ArrowLeft className="size-3.5" />}
                onClick={() => navigate(-1)}
              >
                Go back
              </Button>
              <Link
                to="/"
                className="inline-flex h-10 items-center gap-2 rounded-[--radius-control] px-4 text-sm font-semibold text-text-secondary hover:bg-canvas-sunken hover:text-text"
              >
                <Home className="size-3.5" aria-hidden />
                Home
              </Link>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  )
}

/** The 404 for a URL that matches no route at all. */
export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg items-center px-4">
      <Panel className="w-full text-center">
        <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-brass-600">404</p>
        <h1 className="mt-1 text-lg font-semibold text-text">That page does not exist</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
          The link may be out of date. Older quotation and invoice links still work — everything
          else is reachable from the workspace.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Link
            to="/"
            className="inline-flex h-10 items-center rounded-[--radius-control] bg-forest-500 px-4 text-sm font-semibold text-white hover:bg-forest-600"
          >
            Back to DealFlow360
          </Link>
        </div>
      </Panel>
    </div>
  )
}
