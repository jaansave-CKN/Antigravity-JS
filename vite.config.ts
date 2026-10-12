import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isProd = mode === 'production';
  // Fallback seguro a localhost:8000 (puerto del backend local)
  // Forzar IPv4 — en Windows, "localhost" resuelve a ::1 (IPv6) pero Express escucha en 127.0.0.1
  const apiTarget = (env.VITE_API_URL || 'http://localhost:8000').replace('localhost', '127.0.0.1');

  return {
    plugins: [react()],
    root: resolve(configDir, 'client'),
    base: '/',
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      ...(isProd ? { 'console.log': 'function(){}' } : {}),
    },
    build: {
      outDir: resolve(configDir, 'dist'),
      emptyOutDir: true,
      minify: isProd ? 'esbuild' : false,
      sourcemap: !isProd,
      cssMinify: true,
      // Mermaid's generated ABNF parser is one lazy upstream module (909.94 kB raw / 184.5 kB gzip).
      // All eager and other manual chunks remain below 600 kB; keep this cap measured, not blanket-silenced.
      chunkSizeWarningLimit: 1024,
      rollupOptions: {
        input: resolve(configDir, 'client', 'index.html'),
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
            const moduleId = id.replaceAll('\\', '/');
            if (!moduleId.includes('/node_modules/')) return undefined;
            if (/\/node_modules\/@mermaid-js\/parser\//.test(moduleId)) return 'vendor-mermaid-parser';
            const mermaidInternal = moduleId.match(/\/node_modules\/mermaid\/dist\/chunks\/mermaid\.core\/([^/]+)\.mjs$/);
            if (mermaidInternal) return `vendor-mermaid-${mermaidInternal[1]}`;
            if (/\/node_modules\/mermaid\//.test(moduleId)) return 'vendor-mermaid-core';
            if (/\/node_modules\/(?:react-router-dom|react|react-dom)\//.test(moduleId)) return 'vendor-core';
            if (/\/node_modules\/leaflet\//.test(moduleId)) return 'vendor-leaflet';
            if (/\/node_modules\/xlsx\//.test(moduleId)) return 'vendor-xlsx';
            if (/\/node_modules\/jspdf(?:-autotable)?\//.test(moduleId)) return 'vendor-jspdf';
            if (/\/node_modules\/@sentry\//.test(moduleId)) return 'vendor-sentry';
            if (/\/node_modules\/framer-motion\//.test(moduleId)) return 'vendor-motion';
            if (/\/node_modules\/recharts\//.test(moduleId)) return 'vendor-recharts';
            if (/\/node_modules\/posthog-js\//.test(moduleId)) return 'vendor-posthog';
            if (/\/node_modules\/lucide-react\//.test(moduleId)) return 'vendor-icons';
            if (/\/node_modules\/dompurify\//.test(moduleId)) return 'vendor-dompurify';
            if (/\/node_modules\/cytoscape-fcose\//.test(moduleId)) return 'vendor-cytoscape-fcose';
            if (/\/node_modules\/cytoscape-cose-bilkent\//.test(moduleId)) return 'vendor-cytoscape-cose-bilkent';
            if (/\/node_modules\/cytoscape\//.test(moduleId)) return 'vendor-cytoscape-core';
            if (/\/node_modules\/(?:cose-base|layout-base)\//.test(moduleId)) return 'vendor-cytoscape-layout';
            if (/\/node_modules\/d3(?:-[^/]+)?\//.test(moduleId)) return 'vendor-d3';
            if (/\/node_modules\/(?:katex|marked|roughjs|dagre-d3-es|dayjs|khroma|stylis|ts-dedent)\//.test(moduleId)) {
              return `vendor-${moduleId.split('/node_modules/')[1].split('/')[0]}`;
            }
            return undefined;
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
