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
                console.warn('Proxy ECONNREFUSED � backend a�n no listo');
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
        // connect-src incluye localhost Y 127.0.0.1 explícitamente (http y ws):
        // el navegador los trata como orígenes distintos para CSP aunque
        // apunten a la misma máquina, y VITE_API_URL/apiTarget puede usar
        // cualquiera de los dos según cómo se configure — bloqueaba fetch()
        // reales del navegador aunque curl (que no aplica CSP) funcionara bien.
        'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://unpkg.com; connect-src 'self' https://generativelanguage.googleapis.com https://api.groq.com http://localhost:8000 http://127.0.0.1:8000 ws://localhost:8000 ws://127.0.0.1:8000 wss://* https://*.googleapis.com;`,
      },
    },
  };
});
