import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isProd = mode === 'production';
  // Fallback seguro a localhost:3000
  const apiTarget = env.VITE_API_URL || 'http://localhost:3000';

  return {
    plugins: [react()],
    root: resolve(__dirname, 'client'),
    base: '/',
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      ...(isProd ? { 'console.log': 'function(){}' } : {}),
    },
    build: {
      outDir: resolve(__dirname, 'dist'),
      minify: isProd ? 'esbuild' : false,
      sourcemap: !isProd,
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
      // allowedHosts habilitado para entornos como Replit/Cloud IDEs
      allowedHosts: true,
      watch: {
        usePolling: true,
        interval: 100,
      },
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
          // Mejora: Ignorar errores de conexión y permitir el reintento automático
          ws: true,
          configure: (proxy, _options) => {
            proxy.on('error', (err, _req, res) => {
              console.error('Proxy Error:', err.message);
              // Si el backend aún no responde, devolvemos un 503 controlable
              if ((err as any).code === 'ECONNREFUSED') {
                (res as any).writeHead(503, { 'Content-Type': 'application/json' });
                (res as any).end(JSON.stringify({
                  success: false,
                  message: 'Servidor en espera. Por favor, intenta de nuevo en unos segundos.'
                }));
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
        // CSP ajustada para permitir APIs externas y evitar bloqueos de seguridad
        'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://unpkg.com; connect-src 'self' https://generativelanguage.googleapis.com https://api.groq.com ${apiTarget} ${apiTarget.replace('http', 'ws')} wss://* https://*.googleapis.com;`,
      },
    },
  };
});
