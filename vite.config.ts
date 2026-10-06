import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  // App local y cacheada como PWA: ~160 kB gzip es aceptable y no merece trocear el bundle.
  build: { chunkSizeWarningLimit: 700 },
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
