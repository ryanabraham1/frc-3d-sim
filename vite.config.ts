import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { relayPlugin } from './server/vitePlugin';

export default defineConfig({
  // Multiplayer relay at /ws on `npm run dev` / `npm run preview` (see docs/MULTIPLAYER.md).
  plugins: [relayPlugin()],
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@seasons': fileURLToPath(new URL('./src/seasons', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    // Rapier ships its WASM inlined (~2 MB gzipped); it is lazy-loaded when a match starts.
    chunkSizeWarningLimit: 4500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Physics suites fire hundreds of real shots per test; the 5 s default times out on slower machines.
    testTimeout: 120_000,
  },
});
