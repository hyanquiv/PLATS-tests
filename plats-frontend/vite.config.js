import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    proxy: {
      '/plats': { target: 'http://172.28.0.150:8080', changeOrigin: true }
    }
  }
});
