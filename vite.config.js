import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs. GitHub Pages serves this site from /<repo>/, and a leading slash would miss that folder.
  base: './',
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
