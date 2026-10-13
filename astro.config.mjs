import { defineConfig } from 'astro/config';

export default defineConfig({
  outDir: './dist',
  server: {
    port: 4321,
    host: false,
  },
  build: {
    format: 'directory',
  },
  vite: {
    server: {
      proxy: {
        '/api': 'http://localhost:3000',
        '/images': 'http://localhost:3000',
      },
    },
  },
});
