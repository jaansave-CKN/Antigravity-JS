import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = 'http://localhost:8000'; // proxy target fijo

  return {
    plugins: [react()],
    root: resolve(__dirname, 'client'),
    base: '/',
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    build: {
      outDir: resolve(__dirname, 'dist'),
      cssMinify: true,
      rollupOptions: {
        input: resolve(__dirname, 'client', 'index.html'),
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
    server: {
      host: true,
      port: 5173,
      allowedHosts: true,
      watch: { usePolling: true, interval: 100 },
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on('error', (err, _req, res) => {
              if (err.code === 'ECONNREFUSED') {
                console.warn('Proxy ECONNREFUSED – backend aún no listo');
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Backend en espera' }));
              }
            });
          },
        },
      },
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://unpkg.com; connect-src 'self' https://generativelanguage.googleapis.com https://api.groq.com ${apiTarget} ${apiTarget.replace('http', 'ws')} wss://* https://*.googleapis.com;`,
      },
    },
  };
});
