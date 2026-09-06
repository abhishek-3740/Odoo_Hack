import { useEffect, useRef, useState } from 'react';

/** Synchronous read of the OS reduced-motion preference (safe during render). */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Fade-and-rise an element once it enters the viewport.
 * Returns [ref, visible] — attach the ref, gate your classes on `visible`.
 */
export function useReveal(threshold = 0.12) {
  const ref = useRef(null);
  // Reduced motion: reveal immediately, never animate.
  const [visible, setVisible] = useState(prefersReducedMotion);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, visible]);

  return [ref, visible];
}

/**
 * Attach to a `.ld-card` as onMouseMove so its border glow follows the cursor.
 * Writes CSS variables instead of React state — no re-render per pointer move.
 */
export function trackCardPointer(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--ld-mx', `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty('--ld-my', `${event.clientY - rect.top}px`);
}

/** Tracks the OS reduced-motion preference and reacts to changes. */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
