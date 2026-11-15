import { defineConfig, type ProxyOptions } from 'vite';
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

// La API Rust (`cargo run --bin api_server` en `src/core-engine`) y las teselas de Mars Trek
// se sirven por proxy tanto en desarrollo (`npm run dev`) como con la aplicación compilada
// (`npm run preview`). Un alojamiento estático necesita el mismo proxy y la redirección de las
// rutas de la aplicación a `index.html`.
const proxy: Record<string, ProxyOptions> = {
  '/api': {
    target: 'http://127.0.0.1:3001',
    changeOrigin: true,
  },
  '/mars-trek': {
    target: 'https://trek.nasa.gov',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/mars-trek/, '/tiles/Mars/EQ'),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), geojsonPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@data': path.resolve(__dirname, '../../data'),
    },
    dedupe: ['three'],
  },
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/controls/OrbitControls.js',
      'three/examples/jsm/lines/Line2.js',
      'three/examples/jsm/lines/LineGeometry.js',
      'three/examples/jsm/lines/LineMaterial.js',
    ],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    proxy,
    fs: {
      allow: [path.resolve(__dirname, '../..')],
    },
  },
  preview: {
    proxy,
  },
});
