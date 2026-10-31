import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * The build's version in error reports (src/lib/telemetry.ts): VITE_APP_VERSION when the build sets it,
 * otherwise the build's UTC time, e.g. 20261005.1342.
 */
function buildVersion(): string {
  const given = (process.env.VITE_APP_VERSION || '').trim()
  if (/^[A-Za-z0-9._+-]{1,40}$/.test(given)) return given
  const stamp = new Date().toISOString()
  return `${stamp.slice(0, 10).replace(/-/g, '')}.${stamp.slice(11, 16).replace(':', '')}`
}

export default defineConfig({
  define: {
    __MELDY_BUILD__: JSON.stringify(buildVersion()),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // A new release waits until no open page can be disturbed (src/sw.js, lib/appUpdate.ts); autoUpdate
      // reloaded every open page a second after the browser found a release.
      registerType: 'prompt',
      injectRegister: 'auto',
      injectManifest: {
        maximumFileSizeToCacheInBytes: 5000000,
        // The 3D games' chunk (three.js and the kit, src/lib/live/three/internal/game3d.ts) loads only on the game's
        // screens: precaching it would send it to every visitor with each release. Its hashed name keeps it in the
        // browser's cache (nginx: /assets/ for a year), like the models in public/game (docs/live/KIT_3D.md).
        globIgnores: ['**/game3d-*.js'],
      },
      devOptions: {
        enabled: true, // Enable for testing in dev
        type: 'module',
      },
      // start_url and scope stay the plugin's defaults («/»), as in every release so far: an installed
      // app keeps its identity. The PNG icons are rendered from pwa-512x512.svg by scripts/og/render.mjs
      // and come first, so a platform that picks by size takes them; the SVGs stay (manifest icons are
      // precached).
      manifest: {
        name: 'Meldy — подготовка к экзамену и конструктор тестов',
        short_name: 'Meldy',
        description: 'Meldy сделает из лекции конспект и тест. Вопросы к экзамену разложит по дням. Свой тест вы соберёте сами и отправите по ссылке.',
        lang: 'ru',
        theme_color: '#f3f3f0',
        background_color: '#f3f3f0',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
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
