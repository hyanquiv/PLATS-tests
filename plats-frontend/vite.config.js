import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    proxy: { '/plats': { target: 'http://localhost:8080', changeOrigin: true } }
  }
});
