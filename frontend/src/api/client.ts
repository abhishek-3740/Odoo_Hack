/**
 * The HTTP boundary.
 *
 * Every call in the application goes through here, so the envelope, the error
 * codes, the token and the idempotency rules are decided once. Screens receive
 * either data or a typed {@link ApiError}; they never see a Response.
 */

import type { ErrorCode } from './contracts/errors'

/**
 * API root. Relative by default so the dev server proxy handles `/api/v1`;
 * deployed builds set `VITE_API_BASE_URL` to the backend origin at build time.
 */
export const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || '/api/v1'
).replace(/\/+$/, '')

/** Success envelope: `{ data, meta: { requestId, evaluatedAt, ... } }`. */
export interface Envelope<T> {
  data: T
  meta: Record<string, unknown>
}

/** Paged payload. Every list endpoint on this API is bounded. */
export interface Page<T> {
  items: T[]
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

/**
 * Normalises a paginated payload to this client's {@link Page} contract.
 *
 * The FastAPI backend returns paged rows as `data: [...]` with
 * `meta: { page, size, total }`; the Spring API this client was written
 * against nests them in a `Page` record. Converting at the boundary keeps
 * every screen on the same shape.
 */
function toPage(data: unknown, meta: Record<string, unknown>): unknown {
  if (!Array.isArray(data)) return data
  const page = meta.page
  const pageSize = meta.size
  const totalItems = meta.total
  if (typeof page !== 'number' || typeof pageSize !== 'number' || typeof totalItems !== 'number') {
    return data
  }
  return {
    items: data,
    page,
    pageSize,
    totalItems,
    totalPages: pageSize > 0 ? Math.ceil(totalItems / pageSize) : 0,
  }
}

/**
 * A failure the server described.
 *
 * `code` is the contract; `message` is prose for a person and may be reworded.
 * Screens branch on the code — never on the message text.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'CONTRACT_ERROR' | 'UNKNOWN_ERROR'
  readonly details: Record<string, unknown>
  readonly requestId: string | null

  constructor(init: {
    status: number
    code: ApiError['code']
    message: string
    details?: Record<string, unknown>
    requestId?: string | null
  }) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.details = init.details ?? {}
    this.requestId = init.requestId ?? null
  }

  /** Field-level messages from bean validation, when the server sent them. */
  get fieldErrors(): Record<string, string> {
    const fields = this.details.fields
    if (fields && typeof fields === 'object') {
      return Object.fromEntries(
        Object.entries(fields as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
      )
    }
    return {}
  }

  /** The record moved under us: preserve the draft, re-read, re-confirm. */
  get isStale(): boolean {
    return (
      this.status === 409 &&
      (this.code === 'STALE_QUOTE_VERSION' ||
        this.code === 'STALE_VERSION' ||
        this.code === 'CONFLICTING_STATE' ||
        this.code === 'ACCEPTANCE_HASH_MISMATCH')
    )
  }

  /** Retrying will not help: the input or the caller's rights are the problem. */
  get isPermanent(): boolean {
    return this.status === 400 || this.status === 401 || this.status === 403 || this.status === 422
  }
}

// ------------------------------------------------------------ token source

type TokenReader = () => string | null
type UnauthorizedHandler = () => void

let readToken: TokenReader = () => null
let onUnauthorized: UnauthorizedHandler = () => {}

/**
 * Installs the session adapter.
 *
 * Called once by the auth provider. Keeping the token behind a function rather
 * than a module variable means a persona switch takes effect on the very next
 * request without a reload, and no module has to import the auth context.
 */
export function configureApi(options: {
  token: TokenReader
  unauthorized: UnauthorizedHandler
}): void {
  readToken = options.token
  onUnauthorized = options.unauthorized
}

// -------------------------------------------------------------- requesting

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  /** Query parameters. Undefined and null entries are dropped, not sent as "null". */
  query?: Record<string, string | number | boolean | null | undefined>
  /**
   * One key per user intent, reused verbatim on retry after an ambiguous
   * network failure. A changed payload is a new intent and needs a new key.
   */
  idempotencyKey?: string
  signal?: AbortSignal
  /** Suppress the global 401 handler — used by the sign-in screen itself. */
  anonymous?: boolean
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url
}

async function readError(response: Response): Promise<ApiError> {
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const body = payload as
    | { error?: { code?: string; message?: string; details?: Record<string, unknown> }; requestId?: string }
    | null

  return new ApiError({
    status: response.status,
    code: (body?.error?.code as ApiError['code']) ?? 'UNKNOWN_ERROR',
    message:
      body?.error?.message ??
      (response.status === 401
        ? 'Your session has ended. Sign in to continue.'
        : `The server returned HTTP ${response.status}.`),
    details: body?.error?.details ?? {},
    requestId: body?.requestId ?? null,
  })
}

/** Performs a request and returns the whole envelope, meta included. */
export async function requestEnvelope<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Envelope<T>> {
  const { method = 'GET', body, query, idempotencyKey, signal, anonymous } = options

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  if (!anonymous) {
    const token = readToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'The workspace could not reach the server. Check your connection and try again.',
    })
  }

  if (!response.ok) {
    const error = await readError(response)
    if (error.status === 401 && !anonymous) onUnauthorized()
    throw error
  }

  if (response.status === 204) return { data: undefined as T, meta: {} }

  const payload = (await response.json()) as Envelope<T>
  const meta = payload?.meta ?? {}
  return { data: toPage(payload?.data, meta) as T, meta }
}

/** Performs a request and returns just the payload. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const envelope = await requestEnvelope<T>(path, options)
  return envelope.data
}

export const api = {
  get: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...options, method: 'GET' }),

  getEnvelope: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    requestEnvelope<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...options, method: 'POST', body }),

  postEnvelope: <T>(
    path: string,
    body?: unknown,
    options: Omit<RequestOptions, 'method' | 'body'> = {},
  ) => requestEnvelope<T>(path, { ...options, method: 'POST', body }),

  patch: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...options, method: 'PATCH', body }),

  put: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...options, method: 'PUT', body }),
}

// -------------------------------------------------------------- downloads

/**
 * Fetches a document endpoint and hands the bytes to the browser.
 *
 * These endpoints answer with a real PDF/XLSX/DOC and a filename, so the
 * response is read as a blob and the server's own `Content-Disposition` name is
 * honoured when it sent one. A failure still arrives as the JSON error envelope,
 * so it is decoded into an {@link ApiError} rather than saved as a corrupt file
 * called "invoice.pdf".
 */
export async function download(
  path: string,
  fallbackFilename: string,
  query?: RequestOptions['query'],
): Promise<void> {
  const token = readToken()
  const response = await fetch(buildUrl(path, query), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (!response.ok) {
    const error = await readError(response)
    if (error.status === 401) onUnauthorized()
    throw error
  }

  const disposition = response.headers.get('content-disposition') ?? ''
  const named = /filename="?([^";]+)"?/i.exec(disposition)
  const filename = named?.[1] ?? fallbackFilename

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoke on the next tick: revoking synchronously cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Fetches a document for on-screen preview and returns an object URL. */
export async function fetchDocumentUrl(
  path: string,
  query?: RequestOptions['query'],
): Promise<{ url: string; revoke: () => void }> {
  const token = readToken()
  const response = await fetch(buildUrl(path, query), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) {
    const error = await readError(response)
    if (error.status === 401) onUnauthorized()
    throw error
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  return { url, revoke: () => URL.revokeObjectURL(url) }
}

// ------------------------------------------------------------ idempotency

/**
 * A fresh idempotency key.
 *
 * One key belongs to one user intent. Callers hold the key across retries of
 * the *same* payload and mint a new one when the user edits what they meant to
 * do — otherwise a corrected amount would replay the original.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
