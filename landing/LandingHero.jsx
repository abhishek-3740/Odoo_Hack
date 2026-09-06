import React, { useRef, useEffect, useState, Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, GitBranch, Fingerprint } from 'lucide-react';
import { usePrefersReducedMotion } from './useReveal';

const HeroScene = lazy(() =>
  import('../3d/HeroScene').then((m) => ({ default: m.HeroScene }))
);

/** One-shot WebGL capability probe, safe to run while initialising state. */
function hasWebgl() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

const PROOFS = [
  { icon: ShieldCheck, label: 'Policy-driven approval' },
  { icon: GitBranch, label: 'Atomic finalisation' },
  { icon: Fingerprint, label: 'Hash-verified acceptance' },
];

/**
 * Hero — a pinned cinematic.
 *
 * The outer section is only scroll *distance*; everything visible lives in the
 * sticky h-screen child, so the headline stays centred in the viewport and the
 * scroll hint stays on screen. `--hero-p` (0 → 1) is written from the scroll
 * handler and drives the content fade in CSS, avoiding React re-renders.
 */
export function LandingHero() {
  const mouseRef = useRef([0, 0]);
  const scrollRef = useRef(0);
  const sectionRef = useRef(null);
  const stageRef = useRef(null);
  const [webglOk] = useState(hasWebgl);
  const reducedMotion = usePrefersReducedMotion();

  // Pointer parallax + spotlight position.
  useEffect(() => {
    const onMove = (e) => {
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = (e.clientY / window.innerHeight) * 2 - 1;
      mouseRef.current = [x, y];

      const stage = stageRef.current;
      if (stage) {
        stage.style.setProperty('--ld-mx', `${(e.clientX / window.innerWidth) * 100}%`);
        stage.style.setProperty('--ld-my', `${(e.clientY / window.innerHeight) * 100}%`);
      }
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Scroll progress across the hero, exposed as a CSS variable.
  useEffect(() => {
    let frame = 0;

    const apply = () => {
      frame = 0;
      const el = sectionRef.current;
      const stage = stageRef.current;
      if (!el || !stage) return;

      const rect = el.getBoundingClientRect();
      const total = Math.max(1, rect.height - window.innerHeight);
      const progress = Math.min(Math.max(-rect.top, 0), total) / total;

      scrollRef.current = progress;
      stage.style.setProperty('--hero-p', progress.toFixed(4));
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="ld-grain relative h-[185vh]"
      aria-label="DealFlow360"
    >
      <div
        ref={stageRef}
        className="sticky top-0 h-screen w-full overflow-hidden"
        style={{ '--hero-p': 0 }}
      >
        {/* 3D backdrop */}
        {webglOk ? (
          <Suspense
            fallback={
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(79,70,229,0.22),transparent_65%)]" />
            }
          >
            <HeroScene
              mouseRef={mouseRef}
              scrollRef={scrollRef}
              reducedMotion={reducedMotion}
            />
          </Suspense>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(79,70,229,0.22),transparent_65%)]" />
        )}

        {/* Atmosphere: pointer spotlight, vignette, floor fade */}
        <div
          className="pointer-events-none absolute inset-0 z-[2]"
          style={{
            background:
              'radial-gradient(560px circle at var(--ld-mx,50%) var(--ld-my,35%), rgba(99,102,241,0.09), transparent 60%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 z-[2] bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(5,6,10,0.72)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-56 bg-gradient-to-b from-transparent to-[#05060a]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-40 bg-gradient-to-b from-[#05060a]/85 to-transparent" />

        {/* Content */}
        <div className="relative z-[3] h-full">
          <div
            className="mx-auto flex h-full max-w-7xl items-center px-6 lg:px-10"
            style={{
              opacity: 'clamp(0, calc(1 - var(--hero-p) * 2.1), 1)',
              transform: 'translateY(calc(var(--hero-p) * -34px))',
            }}
          >
            <div className="max-w-3xl pt-8">
              <div className="mb-7 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-1.5 pr-4 backdrop-blur-sm">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/20 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-300">
                  <span className="ld-dot h-1.5 w-1.5 rounded-full bg-indigo-400" />
                  Live
                </span>
                <span className="text-[12px] font-medium tracking-wide text-slate-300">
                  Quotation-to-cash, end to end
                </span>
              </div>

              <h1 className="text-[2.75rem] font-bold leading-[1.03] tracking-[-0.035em] text-white sm:text-6xl lg:text-[4.5rem]">
                Where enterprise deals
                <br />
                <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-cyan-300 bg-clip-text text-transparent">
                  stop dying in email.
                </span>
              </h1>

              <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-slate-400">
                DealFlow360 is a governed deal desk for hardware, services and
                subscriptions. Browse live pricing, negotiate on the line, clear
                policy-driven approval, and finalise stock and invoice in one
                transaction — every figure computed by the running system, never
                a mock-up.
              </p>

              <div className="mt-10 flex flex-wrap items-center gap-3">
                <Link
                  to="/catalog"
                  className="group inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(99,102,241,0.8)] transition-all hover:-translate-y-0.5 hover:bg-indigo-400 hover:shadow-[0_14px_36px_-10px_rgba(99,102,241,0.95)]"
                >
                  <span>Browse live catalogue</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/12 px-6 py-3.5 text-sm font-semibold text-slate-200 transition-all hover:border-white/25 hover:text-white"
                >
                  <span>See how it works</span>
                </a>
              </div>

              {/* Verifiable guarantees — each one is enforced in the backend */}
              <ul className="mt-11 flex flex-wrap items-center gap-x-6 gap-y-3">
                {PROOFS.map(({ icon: Icon, label }) => (
                  <li
                    key={label}
                    className="flex items-center gap-2 text-[12.5px] font-medium text-slate-500"
                  >
                    <Icon className="h-3.5 w-3.5 text-indigo-400/80" strokeWidth={2} />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Scroll hint — pinned with the stage so it is always visible */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-8 z-[3] flex flex-col items-center gap-2.5"
            style={{ opacity: 'clamp(0, calc(1 - var(--hero-p) * 5), 1)' }}
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-slate-600">
              Scroll
            </span>
            <span className="relative h-10 w-px overflow-hidden bg-white/10">
              <span className="absolute inset-x-0 top-0 h-4 animate-[ld-trace_2s_ease-in-out_infinite] bg-gradient-to-b from-indigo-400 to-transparent" />
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ld-trace {
          0%   { transform: translateY(-100%); opacity: 0; }
          40%  { opacity: 1; }
          100% { transform: translateY(250%); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [class*="animate-[ld-trace"] { animation: none; }
        }
      `}</style>
    </section>
  );
}
