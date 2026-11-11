/**
 * The public landing page's crawlable identity.
 *
 * Imported by two very different consumers, on purpose:
 *
 *  - `vite.config.ts` injects {@link landingHeadTags} and
 *    {@link landingNoScriptHtml} into `index.html` at build time, so the
 *    marketing HTML carries a title, description, canonical URL, social
 *    metadata and readable prose with JavaScript disabled.
 *  - The React landing page renders {@link LANDING_COPY} for everyone else.
 *
 * One source of truth means the crawled copy and the hydrated copy cannot drift
 * apart without someone noticing. No React, no DOM, no browser globals here —
 * this module has to run inside the Vite config under Node.
 */

export const LANDING_COPY = {
  title: 'DealFlow360 — Every deal. Clearly connected.',
  tagline: 'Where enterprise deals stop dying in email.',
  headline: 'Where enterprise deals',
  headlineAccent: 'stop dying in email.',
  promise:
    'Quotation, discount approval, customer acceptance, fulfilment and billing run as one workflow. Every screen answers the same three questions: what is happening, what is blocking it, and who acts next.',
  description:
    'DealFlow360 runs quotation, discount approval, customer acceptance, order fulfilment and billing as one connected workflow, so every deal shows what is happening, what is blocking it and who acts next.',
  ctaPrimary: 'Open the workspace',
  ctaSecondary: 'See the workflow',
} as const

/** Meta tags injected into `<head>` at build time. */
export function landingHeadTags(origin: string): string {
  const url = origin.replace(/\/$/, '')
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'DealFlow360',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: LANDING_COPY.description,
    url,
  }

  return [
    `<link rel="canonical" href="${url}/" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="DealFlow360" />`,
    `<meta property="og:title" content="${escapeAttribute(LANDING_COPY.title)}" />`,
    `<meta property="og:description" content="${escapeAttribute(LANDING_COPY.description)}" />`,
    `<meta property="og:url" content="${url}/" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttribute(LANDING_COPY.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttribute(LANDING_COPY.description)}" />`,
    `<meta name="robots" content="index,follow" />`,
    `<link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin />`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
  ].join('\n    ')
}

/**
 * The static body a crawler or a scripting-disabled browser sees.
 *
 * It is replaced the moment React mounts. It exists so the page is not an empty
 * `<div id="root">` to anything that cannot run the application — which is both
 * an SEO requirement and a plain accessibility one.
 */
export function landingNoScriptHtml(): string {
  return `<div style="max-width:46rem;margin:0 auto;padding:4rem 1.5rem;font-family:Manrope,system-ui,sans-serif;color:#172C28">
      <h1 style="font-size:2.25rem;line-height:1.15;margin:0 0 1rem">${LANDING_COPY.tagline}</h1>
      <p style="font-size:1.0625rem;line-height:1.6;color:#52615B;margin:0 0 1.5rem">${LANDING_COPY.promise}</p>
      <h2 style="font-size:1.125rem;margin:2rem 0 .5rem">How a deal moves</h2>
      <ol style="line-height:1.7;color:#52615B;padding-left:1.25rem">
        <li>A customer requests a quotation from the catalogue.</li>
        <li>A salesperson builds the terms; the server prices them and measures them against the discount policy.</li>
        <li>Terms outside policy raise a manager step, then a finance step, in that order.</li>
        <li>The salesperson adopts the terms and the customer accepts one exact version.</li>
        <li>The order is created as soon as every required gate is met.</li>
        <li>Fulfilment reserves stock; billing raises the invoice and starts any subscription.</li>
        <li>A recorded receipt is allocated across open invoices.</li>
      </ol>
      <p style="margin-top:2rem"><a href="/sign-in" style="color:#176448;font-weight:600">Sign in to the workspace</a></p>
      <p style="margin-top:.5rem;font-size:.8125rem;color:#7B8A83">Figures shown on this site are illustrative examples, not customer data.</p>
    </div>`
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
