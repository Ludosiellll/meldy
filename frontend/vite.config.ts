import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: {
        maximumFileSizeToCacheInBytes: 5000000,
      },
      devOptions: {
        enabled: true, // Enable for testing in dev
        type: 'module',
      },
      manifest: {
        name: 'Meldy — помощник для учёбы',
        short_name: 'Meldy',
        description: 'Конспекты, карточки и тесты из ваших учебных материалов.',
        lang: 'ru',
        theme_color: '#f3f3f0',
        background_color: '#f3f3f0',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          },
          {
            src: 'pwa-512x512.svg',
            sizes: '512x512',
            type: 'image/svg+xml'
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        // Screens share many tiny modules (icons, helpers); split one by one they became dozens of
        // files of a few hundred bytes, and on a slow line each request costs a round trip. Rollup
        // merges a chunk under this size that has no side effects into one loaded with it.
        experimentalMinChunkSize: 10_000,
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
