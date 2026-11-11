import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

import { landingHeadTags, landingNoScriptHtml } from './src/features/marketing/seo'

/**
 * Writes the public landing route's SEO head and a static, no-JavaScript
 * summary into `index.html` at build time.
 *
 * The plan requires the marketing HTML to carry a title, description, canonical
 * URL and social metadata that survive with scripting disabled. A single-page
 * app cannot get that from Vite on its own, so it is injected here from the same
 * source of truth the React landing page renders from — the copy cannot drift
 * between the crawled HTML and the hydrated page without failing a build.
 */
function prerenderLanding(siteOrigin: string): Plugin {
  return {
    name: 'dealflow-prerender-landing',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html
          .replace('<!--seo-head-->', landingHeadTags(siteOrigin))
          .replace('<!--seo-body-->', landingNoScriptHtml())
      },
    },
  }
}

/** Prints the backend the dev proxy actually points at, rather than assuming one. */
function announceBackend(target: string): Plugin {
  return {
    name: 'dealflow-backend-status',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', async () => {
        server.config.logger.info(`  ➜  DealFlow API + WebSocket proxy: ${target}`)
        try {
          const response = await fetch(`${target}/actuator/health`, {
            signal: AbortSignal.timeout(5000),
          })
          if (!response.ok) {
            server.config.logger.warn(
              `  ➜  Backend health returned HTTP ${response.status}. Check the backend terminal.`,
            )
          }
        } catch {
          server.config.logger.warn(
            `  ➜  No backend at ${target}. Start FastAPI in ../backend_fastapi, or set API_PROXY_TARGET ` +
              `in .env.local. "npm run dev" starts the frontend only — it never starts a backend for you.`,
          )
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.API_PROXY_TARGET || 'http://127.0.0.1:8080'
  const siteOrigin = env.SITE_ORIGIN || 'https://dealflow360.example'

  return {
    plugins: [
      react(),
      tailwindcss(),
      announceBackend(target),
      prerenderLanding(siteOrigin),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 3001,
      host: '127.0.0.1',
      strictPort: true,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/ws': { target, ws: true, changeOrigin: true },
      },
    },
    preview: {
      port: 3001,
      strictPort: true,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/ws': { target, ws: true, changeOrigin: true },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        output: {
          // Keep the shared entry small: charts and the marketing diagram are
          // large and are only ever needed on one screen each.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            // These two are behind `cn()`, which every component calls, so they
            // must land in an eagerly-loaded chunk. Left to Rollup they were
            // folded in beside Recharts, and because the entry needs them the
            // entry then imported that chunk statically — 110 KB of charting
            // downloaded on the landing page. Measured, not guessed.
            if (id.includes('/clsx/') || id.includes('/tailwind-merge/')) return 'react'
            if (id.includes('recharts') || id.includes('d3-')) return 'charts'
            if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/'))
              return 'react'
            return undefined
          },
        },
      },
    },
  }
})
