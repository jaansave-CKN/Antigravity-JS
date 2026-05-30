'use strict';
// start-tunnel.js — captura stderr/stdout de cloudflared, extrae URL y abre el navegador
// Diagnosticado: captura funciona, apertura usa explorer.exe (metodo confirmado en Windows)

const { spawn } = require('child_process');
const path      = require('path');

const CLOUDFLARED = path.join(__dirname, 'tools', 'cloudflared.exe');
const URL_REGEX   = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const intento     = process.argv[2] || '1';
const maxIntentos = process.argv[3] || '10';

console.log('');
console.log('='.repeat(49));
console.log(` [Cloudflare Tunnel] Intento ${intento} / ${maxIntentos}`);
console.log('='.repeat(49));
console.log(' Exponiendo: http://localhost:3000');
console.log(' Esperando URL publica...');
console.log('');

const cf = spawn(CLOUDFLARED, ['tunnel', '--url', 'http://localhost:3000'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

let urlCapturada = false;

const abrirNavegador = (url) => {
  console.log('');
  console.log('  >>> URL CAPTURADA: ' + url);
  console.log('  >>> Abriendo navegador con explorer.exe...');
  console.log('');

  // explorer.exe abre URLs en el navegador predeterminado de Windows
  const browser = spawn('explorer.exe', [url], {
    detached: true,
    stdio:    'ignore',
    shell:    false
  });
  browser.unref();

  browser.on('error', (err) => {
    console.log('  [!] explorer.exe fallo: ' + err.message);
    console.log('  [!] Abre manualmente: ' + url);
  });
};

const makeLineReader = () => {
  let buf = '';
  return (data) => {
    buf += data.toString();
    const lineas = buf.split('\n');
    buf = lineas.pop();
    lineas.forEach((linea) => {
      // Eliminar \r de line endings Windows
      const limpia = linea.replace(/\r$/, '');
      console.log(limpia);

      if (!urlCapturada) {
        const match = limpia.match(URL_REGEX);
        if (match) {
          urlCapturada = true;
          abrirNavegador(match[0]);
        }
      }
    });
  };
};

const lector = makeLineReader();
cf.stdout.on('data', lector);
cf.stderr.on('data', lector);

cf.on('close', (code) => {
  console.log('\n[Tunnel] Proceso terminado (exit ' + (code ?? 0) + ')');
  process.exit(code ?? 0);
});

cf.on('error', (err) => {
  console.error('[Tunnel] Error al iniciar cloudflared: ' + err.message);
  process.exit(1);
});
