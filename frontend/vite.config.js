import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
 const env = loadEnv(mode, process.cwd(), '');
 const target = env.API_PROXY_TARGET || 'http://127.0.0.1:8080';
 return {
  plugins: [react(), tailwindcss(), {
    name: 'dealflow-backend-status',
    configureServer(server) {
      server.httpServer?.once('listening', async () => {
        server.config.logger.info(`DealFlow API and WebSocket proxy: ${target}`);
        try {
          const response = await fetch(`${target}/actuator/health`, { signal: AbortSignal.timeout(5000) });
          if (!response.ok) server.config.logger.warn(`Backend health returned HTTP ${response.status}. Check the backend terminal.`);
        } catch {
          server.config.logger.warn(`Backend unavailable at ${target}. Start Spring Boot in ../backend, or set API_PROXY_TARGET in .env.local to its actual port. npm run dev starts the frontend only.`);
        }
      });
    },
  }],
  server: {
    port: 3000,
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      '/api': {
        target,
        changeOrigin: true,
      },
      '/ws': {
        target,
        ws: true,
        changeOrigin: true,
      },
    },
  },
}; })
