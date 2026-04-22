import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5176,
    proxy: {
      '/api':    'http://localhost:3452',
      '/auth':   'http://localhost:3452',
      '/db':     'http://localhost:3452',
      '/socket.io': { target: 'http://localhost:3452', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
