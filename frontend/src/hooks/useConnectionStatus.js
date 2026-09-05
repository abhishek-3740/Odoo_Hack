import { useEffect, useState } from 'react';
import { getConnectionStatus, subscribeToConnectionStatus } from '../services/websocket';

/** 'connected' | 'connecting' | 'disconnected' for the live-updates socket. */
export function useConnectionStatus() {
  const [status, setStatus] = useState(getConnectionStatus());
  useEffect(() => subscribeToConnectionStatus(setStatus), []);
  return status;
}
