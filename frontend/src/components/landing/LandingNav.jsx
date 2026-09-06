import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  Layers,
  LogIn,
  UserPlus,
  LayoutDashboard,
  ExternalLink,
  Menu,
  X,
  ArrowRight,
} from 'lucide-react';

const LINKS = [
  { id: 'product', label: 'Product' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'personas', label: 'Personas' },
];

/** Scroll a section into view under the fixed header, and update the hash. */
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 72;
  window.scrollTo({ top, behavior: 'smooth' });
  if (window.history?.replaceState) {
    window.history.replaceState(null, '', `#${id}`);
  }
}

/**
 * Landing navbar — transparent over the hero, frosted once scrolled, with a
 * reading-progress bar and the active section highlighted.
 */
export function LandingNav() {
  const { user, loading } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;

    const apply = () => {
      frame = 0;
      const y = window.scrollY;
      setScrolled(y > 40);

      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, y / max) : 0);
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

  // Highlight whichever section currently owns the middle of the viewport.
  useEffect(() => {
    const sections = LINKS.map((l) => document.getElementById(l.id)).filter(Boolean);
    if (!sections.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.25, 0.5, 1] }
    );

    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  const onNavClick = useCallback((event, id) => {
    event.preventDefault();
    setMobileOpen(false);
    // Let the sheet unmount before scrolling.
    requestAnimationFrame(() => scrollToSection(id));
  }, []);

  const isCustomer = user?.role === 'CUSTOMER';
  const isInternal = !!user && !isCustomer;

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
          scrolled
            ? 'border-b border-white/[0.07] bg-[#05060a]/80 backdrop-blur-xl'
            : 'border-b border-transparent bg-transparent'
        }`}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-10">
          <Link to="/" className="group flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-indigo-400 to-violet-600 text-white shadow-[0_6px_16px_-6px_rgba(99,102,241,0.9)] transition-transform group-hover:scale-105">
              <Layers className="h-4 w-4" strokeWidth={2.2} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-white">
              DealFlow<span className="text-indigo-400">360</span>
            </span>
          </Link>

          <nav
            aria-label="Primary"
            className="hidden items-center gap-0.5 text-[13px] font-medium md:flex"
          >
            {LINKS.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                onClick={(e) => onNavClick(e, link.id)}
                className={`rounded-md px-3 py-2 transition-colors ${
                  active === link.id
                    ? 'text-white'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                {link.label}
              </a>
            ))}
            <Link
              to="/catalog"
              className="rounded-md px-3 py-2 text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              Catalogue
            </Link>
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            {loading ? null : isCustomer ? (
              <Link
                to="/customer"
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(99,102,241,0.9)] transition-colors hover:bg-indigo-400"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                <span>Open portal</span>
              </Link>
            ) : isInternal ? (
              <Link
                to="/admin"
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(99,102,241,0.9)] transition-colors hover:bg-indigo-400"
              >
                <span>Workspace</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-semibold text-slate-300 transition-colors hover:text-white"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>Sign in</span>
                </Link>
                <Link
                  to="/signup"
                  className="inline-flex items-center gap-1.5 rounded-md bg-indigo-500 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(99,102,241,0.9)] transition-colors hover:bg-indigo-400"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>Get started</span>
                </Link>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            className="inline-flex h-10 w-10 items-center justify-center text-slate-300 hover:text-white md:hidden"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Reading progress */}
        <div
          className="h-px origin-left bg-gradient-to-r from-indigo-400 via-violet-400 to-cyan-400 transition-transform duration-150"
          style={{ transform: `scaleX(${progress})` }}
          aria-hidden="true"
        />
      </header>

      {/* Mobile sheet */}
      <div
        className={`fixed inset-0 z-40 bg-[#05060a]/97 backdrop-blur-2xl transition-opacity duration-300 md:hidden ${
          mobileOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div className="flex h-full flex-col px-6 pb-8 pt-24">
          <nav aria-label="Mobile" className="flex-1 space-y-1">
            {LINKS.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                onClick={(e) => onNavClick(e, link.id)}
                className="block rounded-lg px-4 py-4 text-lg font-medium text-slate-200 transition-colors hover:bg-white/[0.05] hover:text-white"
              >
                {link.label}
              </a>
            ))}
            <Link
              to="/catalog"
              onClick={() => setMobileOpen(false)}
              className="block rounded-lg px-4 py-4 text-lg font-medium text-slate-200 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              Catalogue
            </Link>
          </nav>

          <div className="space-y-2.5 border-t border-white/[0.07] pt-6">
            {loading ? null : isCustomer ? (
              <Link
                to="/customer"
                onClick={() => setMobileOpen(false)}
                className="block w-full rounded-lg bg-indigo-500 px-4 py-3.5 text-center font-semibold text-white transition-colors hover:bg-indigo-400"
              >
                Open portal
              </Link>
            ) : isInternal ? (
              <Link
                to="/admin"
                onClick={() => setMobileOpen(false)}
                className="block w-full rounded-lg bg-indigo-500 px-4 py-3.5 text-center font-semibold text-white transition-colors hover:bg-indigo-400"
              >
                Workspace
              </Link>
            ) : (
              <>
                <Link
                  to="/signup"
                  onClick={() => setMobileOpen(false)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 py-3.5 font-semibold text-white transition-colors hover:bg-indigo-400"
                >
                  <span>Get started</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/login"
                  onClick={() => setMobileOpen(false)}
                  className="block w-full rounded-lg border border-white/12 px-4 py-3.5 text-center font-semibold text-slate-200 transition-colors hover:border-white/25"
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
