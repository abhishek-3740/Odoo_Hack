import React, { useEffect } from 'react';
import '../../styles/landing.css';
import { LandingNav } from '../../components/landing/LandingNav';
import { LandingHero } from '../../components/landing/LandingHero';
import {
  ProductValue,
  HowItWorks,
  FeatureShowcase,
} from '../../components/landing/LandingSections';
import {
  LiveSystemStrip,
  Personas,
  Integrity,
  StackStrip,
  FinalCTA,
  LandingFooter,
} from '../../components/landing/LandingExtras';

/**
 * Landing — the public marketing page at `/`.
 * The live storefront (catalogue + quote cart) is at `/catalog`.
 */
export function LandingPage() {
  // Scope the dark scrollbar to this page only.
  useEffect(() => {
    document.documentElement.classList.add('ld-active');
    return () => document.documentElement.classList.remove('ld-active');
  }, []);

  return (
    <div className="ld-root min-h-screen bg-[#05060a] font-sans text-slate-100 antialiased">
      <LandingNav />
      <main>
        <LandingHero />
        <LiveSystemStrip />
        <ProductValue />
        <HowItWorks />
        <FeatureShowcase />
        <Personas />
        <Integrity />
        <StackStrip />
        <FinalCTA />
      </main>
      <LandingFooter />
    </div>
  );
}
