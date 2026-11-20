import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  publicDir: '../public',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // The renderer is the entry point's main dependency and compresses to under 175 kB.
    chunkSizeWarningLimit: 700,
  },
});