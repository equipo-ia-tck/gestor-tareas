import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // El service worker se actualiza solo; los datos viven en IndexedDB y no se ven afectados.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Tareas',
        short_name: 'Tareas',
        description: 'Gestor de tareas personal, rápido y sin conexión.',
        lang: 'es',
        start_url: './#/today',
        scope: './',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#4f46e5',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Hoy', url: './#/today' },
          { name: 'Bandeja', url: './#/inbox' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Rutas por hash: cualquier navegación sirve index.html desde la caché.
        navigateFallback: 'index.html',
      },
    }),
  ],
  base: './',
  // App local y cacheada como PWA: ~220 kB gzip es aceptable y no merece trocear el bundle.
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
