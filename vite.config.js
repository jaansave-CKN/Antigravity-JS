import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync, readdirSync, cpSync } from 'fs';

const copyStaticPlugin = () => ({
  name: 'copy-static',
  closeBundle() {
    const pub  = resolve(__dirname, 'public');
    const dist = resolve(__dirname, 'dist');

    if (!existsSync(dist)) mkdirSync(dist, { recursive: true });

    // JSON y datos
    ['municipios_index.json', 'data.js', 'styles.css'].forEach(file => {
      const src = resolve(pub, file);
      if (existsSync(src)) { copyFileSync(src, resolve(dist, file)); console.log('✓', file); }
    });

    // Todas las páginas HTML estáticas (excepto index.html que ya genera Vite
    // y archivos de debug/test, que no deben quedar públicamente accesibles en
    // producción — hallazgo auditoría PROTOCOLO TITÁN 2026-08-12, Capa 5).
    const DEBUG_HTML_EXCLUDE = ['test_auth.html'];
    readdirSync(pub)
      .filter(f => f.endsWith('.html') && f !== 'index.html' && !DEBUG_HTML_EXCLUDE.includes(f))
      .forEach(file => {
        copyFileSync(resolve(pub, file), resolve(dist, file));
        console.log('✓', file);
      });

    // Carpeta assets/ (imágenes, logos)
    const assetsSrc = resolve(pub, 'assets');
    if (existsSync(assetsSrc)) {
      cpSync(assetsSrc, resolve(dist, 'assets-static'), { recursive: true });
      console.log('✓ assets/ copiado a dist/assets-static/');
    }
  }
});

export default defineConfig({
  root: 'public',
  publicDir: false,
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    host: 'localhost',
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  plugins: [react(), copyStaticPlugin()],
});
