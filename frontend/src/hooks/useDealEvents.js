import { useEffect, useRef } from 'react';
import { subscribeToDealEvents } from '../services/websocket';

/**
 * Runs `handler` for every deal event that passes `filterFn`.
 * Both callbacks are kept in refs (updated inside an effect) so callers can
 * pass inline functions without re-subscribing on every render.
 */
export function useDealEvents(filterFn, handler) {
  const filterRef = useRef(filterFn);
  const handlerRef = useRef(handler);

  useEffect(() => {
    filterRef.current = filterFn;
    handlerRef.current = handler;
  });

  useEffect(() => {
    return subscribeToDealEvents((event) => {
      const accept = filterRef.current ? filterRef.current(event) : true;
      if (accept && handlerRef.current) {
        handlerRef.current(event);
      }
    });
  }, []);
}
