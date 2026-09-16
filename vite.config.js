import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        campaign: 'index.html',
        defense: 'defense-demo.html',
      },
    },
  },
});
