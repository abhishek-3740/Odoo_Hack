import { useEffect, useRef } from 'react';
import { subscribeToDealEvents, subscribeToConnectionStatus, getConnectionStatus } from '../services/websocket';

/** Plan §11.2: poll only while the socket is down, and only every five seconds. */
const FALLBACK_POLL_MS = 5000;
/** A reconnect storm must not become a refetch storm. */
const MIN_REFRESH_GAP_MS = 4500;

/**
 * Runs `handler` for every deal event that passes `filterFn`.
 *
 * Both callbacks are kept in refs (updated inside an effect) so callers can
 * pass inline functions without re-subscribing on every render.
 *
 * Reconnects, tab focus and the disconnected fallback tick also call the
 * handler. Those carry `synthetic: true` and no entity id: while the socket is
 * down nothing tells us *which* record moved, so the filter is bypassed and the
 * screen simply refetches itself. They are throttled and skipped on a hidden
 * tab — without that, every visible panel refetched every five seconds and live
 * views flickered under the reader. A handler that shows an "updated just now"
 * cue should check `synthetic` first; a plain refetch does not need to.
 */
export function useDealEvents(filterFn, handler) {
  const filterRef = useRef(filterFn);
  const handlerRef = useRef(handler);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    filterRef.current = filterFn;
    handlerRef.current = handler;
  });

  useEffect(() => {
    const unsubscribe = subscribeToDealEvents((event) => {
      const accept = filterRef.current ? filterRef.current(event) : true;
      if (accept && handlerRef.current) {
        handlerRef.current(event);
      }
    });

    const refresh = (type) => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastRefreshRef.current < MIN_REFRESH_GAP_MS) return;
      lastRefreshRef.current = now;
      handlerRef.current?.({ type, entityType: 'Refresh', synthetic: true });
    };

    const stopStatus = subscribeToConnectionStatus((status) => {
      if (status === 'connected') refresh('RECONNECTED');
    });
    const timer = setInterval(() => {
      if (getConnectionStatus() !== 'connected') refresh('POLL');
    }, FALLBACK_POLL_MS);
    const onVisible = () => refresh('VISIBLE');
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      unsubscribe();
      stopStatus();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
