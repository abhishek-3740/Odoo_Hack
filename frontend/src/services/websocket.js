import { Client } from '@stomp/stompjs';
import { getStoredToken } from './api';

// STOMP over the native WebSocket at /ws (proxied by Vite in dev).
// Token travels in the CONNECT frame, never in the URL. Clients only ever
// subscribe to their own private queue; every business command is a REST call.

let stompClient = null;
let activeToken = '';
let status = 'disconnected'; // 'connected' | 'connecting' | 'disconnected'

const eventListeners = new Set();
const statusListeners = new Set();

// Redelivery after a crash between send and mark is possible on the server
// side, so frames are deduplicated on their event id here.
const seenEventIds = [];
const seenEventSet = new Set();
const SEEN_LIMIT = 500;

function rememberEvent(id) {
  if (!id) return true;
  if (seenEventSet.has(id)) return false;
  seenEventSet.add(id);
  seenEventIds.push(id);
  if (seenEventIds.length > SEEN_LIMIT) {
    const oldest = seenEventIds.shift();
    seenEventSet.delete(oldest);
  }
  return true;
}

function setStatus(next) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((cb) => {
    try {
      cb(next);
    } catch (e) {
      console.error('Error in connection status listener:', e);
    }
  });
}

export function getConnectionStatus() {
  return status;
}

export function subscribeToConnectionStatus(callback) {
  statusListeners.add(callback);
  return () => {
    statusListeners.delete(callback);
  };
}

export function subscribeToDealEvents(callback) {
  eventListeners.add(callback);
  return () => {
    eventListeners.delete(callback);
  };
}

function notifyListeners(event) {
  eventListeners.forEach((callback) => {
    try {
      callback(event);
    } catch (e) {
      console.error('Error in deal event listener:', e);
    }
  });
}

export function initWebSocket(token) {
  const authToken = token || getStoredToken();
  if (!authToken) {
    disconnectWebSocket();
    return;
  }

  // Already live for this exact token: nothing to do.
  if (stompClient && stompClient.active && activeToken === authToken) {
    return;
  }

  disconnectWebSocket();
  activeToken = authToken;

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const brokerURL = `${wsProtocol}//${window.location.host}/ws`;

  setStatus('connecting');

  stompClient = new Client({
    brokerURL,
    connectHeaders: {
      Authorization: `Bearer ${authToken}`,
    },
    reconnectDelay: 5000,
    heartbeatIncoming: 10000,
    heartbeatOutgoing: 10000,
    debug: () => {},
    beforeConnect: () => {
      setStatus('connecting');
    },
    onConnect: () => {
      setStatus('connected');
      stompClient.subscribe('/user/queue/deal-events', (message) => {
        try {
          const event = JSON.parse(message.body);
          if (rememberEvent(event.eventId)) {
            notifyListeners(event);
          }
        } catch (err) {
          console.error('Failed to parse STOMP message payload:', err);
        }
      });
    },
    onStompError: (frame) => {
      console.warn('STOMP Broker Error:', frame.headers['message'], frame.body);
      setStatus('disconnected');
    },
    onWebSocketClose: () => {
      // StompJS reconnects on its own; report the gap so the UI can say so.
      setStatus(stompClient && stompClient.active ? 'connecting' : 'disconnected');
    },
    onWebSocketError: () => {
      setStatus(stompClient && stompClient.active ? 'connecting' : 'disconnected');
    },
  });

  try {
    stompClient.activate();
  } catch (err) {
    console.warn('STOMP activation error:', err);
    setStatus('disconnected');
  }
}

export function disconnectWebSocket() {
  if (stompClient) {
    try {
      stompClient.deactivate();
    } catch {
      // ignore
    }
    stompClient = null;
  }
  activeToken = '';
  setStatus('disconnected');
}
