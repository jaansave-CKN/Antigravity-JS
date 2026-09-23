import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isProd = mode === 'production';
  // Fallback seguro a localhost:8000 (puerto del backend local)
  // Forzar IPv4 — en Windows, "localhost" resuelve a ::1 (IPv6) pero Express escucha en 127.0.0.1
  const apiTarget = (env.VITE_API_URL || 'http://localhost:8000').replace('localhost', '127.0.0.1');

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
      emptyOutDir: true,
      minify: isProd ? 'esbuild' : false,
      sourcemap: !isProd,
      cssMinify: true,
      // Nivel Dios: Eleva el límite de advertencia para evitar alertas de chunks grandes
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        input: resolve(__dirname, 'client', 'index.html'),
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
          // Fase 6 — separa vendor "core" (siempre necesario) de vendor
          // "pesado" (leaflet, xlsx, jspdf, sentry, framer-motion), que ya
          // solo se cargan cuando se visita la página que los usa gracias al
          // lazy() de main.tsx — esto es refuerzo, no sustituto de eso.
          //
          // FIX (radiografía 2026-09-07): mermaid, recharts, posthog-js,
          // lucide-react y dompurify (dependencia de mermaid) caían todos en
          // el catch-all "vendor" — un solo archivo de 4.5MB. Como
          // lucide-react se usa en casi toda la app, visitar CUALQUIER
          // página forzaba a descargar ese archivo completo, incluyendo
          // mermaid/recharts aunque esa página no los usara. Separarlos no
          // cambia CUÁNDO carga cada uno (eso ya lo decide el lazy() de
          // arriba vía import() dinámico) — solo evita que compartan un
          // mismo archivo con librerías no relacionadas.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/react-router-dom|\/react\/|\/react-dom\//.test(id)) return 'vendor-core';
            if (/leaflet/.test(id)) return 'vendor-leaflet';
            if (/xlsx/.test(id)) return 'vendor-xlsx';
            if (/jspdf/.test(id)) return 'vendor-jspdf';
            if (/@sentry/.test(id)) return 'vendor-sentry';
            if (/framer-motion/.test(id)) return 'vendor-motion';
            if (/mermaid/.test(id)) return 'vendor-mermaid';
            if (/recharts|d3-/.test(id)) return 'vendor-recharts';
            if (/posthog-js/.test(id)) return 'vendor-posthog';
            if (/lucide-react/.test(id)) return 'vendor-icons';
            if (/dompurify/.test(id)) return 'vendor-dompurify';
            return 'vendor';
          },
        },
      },
    },
    server: {
      // AUTH-001 (auditoría 2026-09-23): antes `true` (todas las interfaces).
      // El proxy /api de abajo reenvía al backend local, así que exponer el
      // dev server en la LAN exponía también el backend (y su BD real).
      host: '127.0.0.1',
      port: 5173,
      // allowedHosts habilitado para entornos como Replit/Cloud IDEs
      allowedHosts: true,
      watch: {
        usePolling: true,
        interval: 100,
      },
      proxy: {
        // '/api/' con barra final (2026-09-23): como '/api' era un PREFIJO y capturaba
        // también /apis (ruta del frontend), que terminaba proxiada al backend →
        // pantalla en blanco al recargar /apis, /importar o /settings en desarrollo.
        '/api/': {
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
        // cdn.tailwindcss.com retirado de script-src el 2026-08-03 — Tailwind ahora se compila localmente vía PostCSS, ya no se carga desde el CDN.
        //
        // FIX (Fase 1 Dual-Mode, 2026-09-06): connect-src usaba solo `apiTarget`
        // (forzado a 127.0.0.1 arriba, por la resolución IPv6 de "localhost" en
        // Windows) — correcto para el proxy interno de Vite, pero equivocado
        // aquí: el navegador ejecuta fetch() directo a `import.meta.env.VITE_API_URL`
        // TAL CUAL (AuthContextNew.tsx, Dashboard.tsx, etc.), sin pasar por ese
        // reemplazo. Si VITE_API_URL usa "localhost" (necesario para que la
        // cookie httpOnly de sesión y localhost:5173 compartan "site" — Chrome
        // trata localhost y 127.0.0.1 como sitios DISTINTOS para el bloqueo de
        // cookies de terceros, aunque apunten a la misma máquina), un connect-src
        // que solo listara 127.0.0.1 bloqueaba el fetch entero con "Failed to
        // fetch" antes de que saliera un solo byte a la red — verificado en vivo
        // (agent-browser eval + Network log: 0 requests emitidos, no un 403/CORS).
        // Se listan ambos hosts explícitos en vez de derivar de apiTarget, para
        // que el CSP no dependa de qué forma tenga VITE_API_URL en cada entorno.
        'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://unpkg.com; connect-src 'self' https://generativelanguage.googleapis.com https://api.groq.com http://localhost:8000 http://127.0.0.1:8000 ws://localhost:8000 ws://127.0.0.1:8000 wss://* https://*.googleapis.com;`,
      },
    },
  };
});
