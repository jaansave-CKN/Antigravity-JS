import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  title: 'RADAR FONDOS 360',
  plugins: [react()],
  build: {
    cssMinify: 'esbuild',
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
    },
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://generativelanguage.googleapis.com https://api.groq.com http://localhost:8000 ws://localhost:8000 wss://* 'unsafe-eval'",
    },
    watch: {
      usePolling: true,
      interval: 500,
    },
    hmr: {
      clientPort: 5173,
    },
  },
});
