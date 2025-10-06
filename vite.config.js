import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react({
    jsxRuntime: 'classic'
  })],
  server: {
    port: 5175,
    strictPort: true,
    host: true,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    proxy: {
      '/health': {
        target: 'http://localhost:4322',
        changeOrigin: true,
      },
      '/trends': {
        target: 'http://localhost:4322',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:4322',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});


