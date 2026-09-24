import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],

    server: {
      // Dev-server proxy: forwards /api/* to the local Express server.
      // Only active during development (vite dev).
      proxy: {
        '/api': {
          target:       env.VITE_API_BASE_URL || 'http://localhost:5000',
          changeOrigin: false,
          proxyTimeout: 300_000,
          timeout:      300_000,
        },
      },
    },

    // ── Vitest configuration ───────────────────────────────────────────────
    test: {
      environment:   'jsdom',
      globals:       true,
      setupFiles:    ['./src/tests/setup.js'],
      include:       ['src/tests/**/*.test.{js,jsx}'],
      css:           false,
    },
  }
})
