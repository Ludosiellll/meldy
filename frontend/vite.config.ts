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
        theme_color: '#f6f5f4',
        background_color: '#f6f5f4',
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
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
