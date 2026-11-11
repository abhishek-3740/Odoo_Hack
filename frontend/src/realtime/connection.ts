import type { DealEvent } from '@/api'

/**
 * One live connection for the whole application.
 *
 * The backend exposes a native WebSocket at `/ws`, not a STOMP broker: the
 * upgrade is authenticated with the bearer token (browsers cannot attach an
 * `Authorization` header to a WebSocket, so it travels in the query string) and
 * events arrive as bare JSON frames. A STOMP client is therefore not used here —
 * it would ask the server to negotiate a subprotocol the server does not speak.
 *
 * A module singleton rather than a hook because panels come and go and a socket
 * per panel would be both wasteful and racy. Screens subscribe to the event
 * stream; nobody else opens a connection.
 */

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

type EventListener = (event: DealEvent) => void
type StatusListener = (status: ConnectionStatus) => void

const RECONNECT_MS = 5000

let socket: WebSocket | null = null
let activeToken = ''
let reconnectTimer: number | null = null
/** False after an explicit disconnect, so a closing socket does not reconnect. */
let shouldReconnect = false
let status: ConnectionStatus = 'disconnected'
/** Bumped on every successful (re)connect, so listeners can refetch after a gap. */
let connectionEpoch = 0

const eventListeners = new Set<EventListener>()
const statusListeners = new Set<StatusListener>()

/**
 * Frames are deduplicated on their event id.
 *
 * The server dispatches from a transactional outbox, so a crash between send and
 * mark can redeliver. A bounded ring is enough: redelivery happens within
 * seconds, never hundreds of events later.
 */
const seenOrder: string[] = []
const seen = new Set<string>()
const SEEN_LIMIT = 500

function remember(id: string | undefined): boolean {
  if (!id) return true
  if (seen.has(id)) return false
  seen.add(id)
  seenOrder.push(id)
  if (seenOrder.length > SEEN_LIMIT) {
    const oldest = seenOrder.shift()
    if (oldest) seen.delete(oldest)
  }
  return true
}

function setStatus(next: ConnectionStatus): void {
  if (status === next) return
  status = next
  for (const listener of statusListeners) {
    try {
      listener(next)
    } catch {
      // A broken listener must not take the connection down with it.
    }
  }
}

export function getConnectionStatus(): ConnectionStatus {
  return status
}

export function getConnectionEpoch(): number {
  return connectionEpoch
}

export function onConnectionStatus(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function onDealEvent(listener: EventListener): () => void {
  eventListeners.add(listener)
  return () => eventListeners.delete(listener)
}

function dispatch(payload: string): void {
  // The server's first frame is the STOMP-shaped handshake acknowledgement; it
  // is not an event. Everything after it is a JSON `DealEvent`.
  if (payload.startsWith('CONNECTED') || payload.startsWith('ERROR')) return
  let event: DealEvent
  try {
    event = JSON.parse(payload) as DealEvent
  } catch {
    // A frame we cannot parse is dropped; REST remains the source of truth.
    return
  }
  if (!remember(event.eventId)) return
  for (const listener of eventListeners) {
    try {
      listener(event)
    } catch {
      // Same reasoning as above.
    }
  }
}

function scheduleReconnect(): void {
  if (!shouldReconnect || reconnectTimer !== null) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    if (shouldReconnect && activeToken) openSocket(activeToken)
  }, RECONNECT_MS)
}

/**
 * The socket endpoint. Same-origin `/ws` behind the dev proxy, or the absolute
 * `VITE_WS_URL` baked in at build time for a separately hosted backend.
 */
function socketUrl(token: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const configured = import.meta.env.VITE_WS_URL as string | undefined
  const url = new URL(configured || `${scheme}//${window.location.host}/ws`)
  url.searchParams.set('token', token)
  return url.toString()
}

function openSocket(token: string): void {
  activeToken = token
  setStatus('connecting')

  const url = socketUrl(token)
  // No subprotocol: the backend accepts the plain upgrade and pushes JSON.
  const ws = new WebSocket(url)
  socket = ws

  ws.onopen = () => {
    if (socket !== ws) return
    connectionEpoch += 1
    setStatus('connected')
    // The backend registers the socket on accept; the CONNECT frame is sent for
    // parity with its protocol and the CONNECTED acknowledgement is ignored.
    ws.send('CONNECT\naccept-version:1.2\nheart-beat:0,0\n\n\u0000')
  }

  ws.onmessage = (message) => {
    if (socket !== ws || typeof message.data !== 'string') return
    dispatch(message.data)
  }

  ws.onclose = (event) => {
    if (socket !== ws) return
    socket = null
    if (!shouldReconnect) {
      setStatus('disconnected')
      return
    }
    // 4401 means the token was rejected: retrying the same credential is futile.
    if (event.code === 4401) {
      shouldReconnect = false
      activeToken = ''
      setStatus('disconnected')
      return
    }
    setStatus('connecting')
    scheduleReconnect()
  }

  // A WebSocket error is always followed by a close event; the close handler
  // decides whether to retry.
  ws.onerror = () => {}
}

export function connectRealtime(token: string | null): void {
  if (!token) {
    disconnectRealtime()
    return
  }
  if (socket && socket.readyState === WebSocket.OPEN && activeToken === token) return

  disconnectRealtime()
  shouldReconnect = true
  openSocket(token)
}

export function disconnectRealtime(): void {
  shouldReconnect = false
  activeToken = ''
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  const ws = socket
  socket = null
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    try {
      ws.close(1000)
    } catch {
      // Closing a socket that is already gone is not an error worth raising.
    }
  }
  setStatus('disconnected')
}
