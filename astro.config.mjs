import { defineConfig } from 'astro/config';

export default defineConfig({
  outDir: './dist',
  server: {
    // `astro` (optional HMR server) will fall back to 4322 when the main
    // Express server already owns 4321 — /api and /images still proxy correctly.
    port: 4321,
    host: false,
  },
  build: {
    format: 'directory',
  },
  vite: {
    server: {
      proxy: {
        '/api': 'http://localhost:4321',
        '/images': 'http://localhost:4321',
      },
    },
  },
});
