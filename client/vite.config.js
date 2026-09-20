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
      // In production the frontend fetches VITE_API_BASE_URL/api/* directly.
      proxy: {
        '/api': {
          target: env.VITE_API_BASE_URL || 'http://localhost:5000',
          changeOrigin: false,
          // 300 s — well above the max transcription wait (60 polls × 3 s = 180 s).
          // Without this, the Vite proxy socket times out during transcription
          // and the browser receives ECONNRESET, causing "Transcribing ❌".
          proxyTimeout: 300_000,
          timeout: 300_000,
        },
      },
    },
  }
})
