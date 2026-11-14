import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

function geojsonPlugin() {
  return {
    name: 'geojson-json-loader',
    transform(code: string, id: string) {
      if (id.endsWith('.geojson')) {
        return {
          code: `export default ${code};`,
          map: null,
        };
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), geojsonPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@data': path.resolve(__dirname, '../../data'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/nasa-rss': {
        target: 'https://mars.nasa.gov',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/nasa-rss/, '/rss/api/'),
      },
      '/nasa-raw-img': {
        target: 'https://mars.nasa.gov',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/nasa-raw-img/, '/mars2020-raw-images'),
      },
    },
    fs: {
      allow: [path.resolve(__dirname, '../..')],
    },
  },
});
