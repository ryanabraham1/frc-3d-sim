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
      // Same API as the compat build (types still come from it) with a SIMD solver: ~27% less physics time per step.
      '@dimforge/rapier3d-compat': fileURLToPath(new URL('./node_modules/@dimforge/rapier3d-simd-compat', import.meta.url)),
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
          rapier: ['@dimforge/rapier3d-simd-compat'],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Physics suites fire hundreds of real shots per test; the 5 s default times out on slower machines.
    testTimeout: 120_000,
    setupFiles: ['tests/setup.ts'],
  },
});
