import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    // The renderer is the entry point's main dependency and compresses to under 175 kB.
    chunkSizeWarningLimit: 700,
  },
});