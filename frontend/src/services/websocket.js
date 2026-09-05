import { Client } from '@stomp/stompjs';
import { getStoredToken } from './api';

let stompClient = null;
const listeners = new Set();
let reconnectTimer = null;

export function subscribeToDealEvents(callback) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function notifyListeners(event) {
  listeners.forEach((callback) => {
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

  // If already active with same token, skip
  if (stompClient && stompClient.active) {
    return;
  }

  disconnectWebSocket();

  // Determine WebSocket URL (via proxy or direct to 8081)
  const isHttps = window.location.protocol === 'https:';
  const wsProtocol = isHttps ? 'wss:' : 'ws:';
  // Use Vite proxy at current origin or fallback to port 8081
  const brokerURL = `${wsProtocol}//${window.location.host}/ws`;

  stompClient = new Client({
    brokerURL,
    connectHeaders: {
      Authorization: `Bearer ${authToken}`,
    },
    reconnectDelay: 5000,
    heartbeatIncoming: 10000,
    heartbeatOutgoing: 10000,
    debug: (str) => {
      // debug logs suppressed for production cleanliness
    },
    onConnect: (frame) => {
      // Subscribe to user specific deal events queue
      stompClient.subscribe('/user/queue/deal-events', (message) => {
        try {
          const event = JSON.parse(message.body);
          notifyListeners(event);
        } catch (err) {
          console.error('Failed to parse STOMP message payload:', err);
        }
      });
    },
    onStompError: (frame) => {
      console.warn('STOMP Broker Error:', frame.headers['message'], frame.body);
    },
    onWebSocketClose: () => {
      // Reconnect handled automatically by StompJS
    },
  });

  try {
    stompClient.activate();
  } catch (err) {
    console.warn('STOMP activation error:', err);
  }
}

export function disconnectWebSocket() {
  if (stompClient) {
    try {
      stompClient.deactivate();
    } catch (e) {
      // ignore
    }
    stompClient = null;
  }
}
