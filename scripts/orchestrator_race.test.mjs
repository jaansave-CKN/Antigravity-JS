// orchestrator_race.test.mjs — regresión del BUG CRÍTICO de identidad cruzada
// bajo concurrencia (PROTOCOLO TITÁN ∞, segunda ronda, 2026-08-14):
// _serverAuthToken era una variable mutable a nivel de módulo en
// src/orchestrator-engine.js, escrita por setServerAuthToken() justo antes
// de invocar Orchestrator000.run() (mismo patrón síncrono que
// FormuladorPgController.js:224 usaba). Bajo concurrencia real (Node es
// single-threaded; hay ventana de microtask entre el set y el primer await
// real de I/O en callAI()), una request podía recibir el token de OTRO
// usuario — confirmado reproducible al 100% con ataques de hasta 60 requests
// concurrentes. Corregido pasando el token como parámetro explícito en toda
// la cadena de llamadas (run -> AGT_052.process -> callAI), sin estado
// compartido entre requests.
//
// Este test reproduce el mismo ataque que lo confirmó: N usuarios
// concurrentes, cada uno con su propio token, contra un servidor HTTP falso
// que hace eco del header Authorization recibido — si algún usuario recibe
// el token de otro, el test falla.
//
// Corre con: node --test scripts/orchestrator_race.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { pathToFileURL } from 'url';
import path from 'path';

const fakeServer = http.createServer((req, res) => {
  const auth = req.headers['authorization'] || 'NONE';
  const delay = Math.random() * 60; // jitter 0-60ms, simula latencia de red real
  setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: `echo:${auth}` } }] }));
  }, delay);
});

await new Promise(r => fakeServer.listen(0, r));
const port = fakeServer.address().port;
process.env.PORT = String(port);

const rutaOrchestrator = path.join(import.meta.dirname, '..', 'src', 'orchestrator-engine.js');
const { Orchestrator000 } = await import(pathToFileURL(rutaOrchestrator).href);

const fichaBase = {
  metadata: { sector: 'educacion', user_type: 'Entidad pública' },
  geography: { departamento: 'Cundinamarca', municipio: 'Chía', territorialidad: {} },
  technical_core: {
    problem_statement: 'x', root_cause: 'y', expected_effect: 'z',
    smart_indicators: ['ind1'], bill_of_materials: [{ cantidad: 1, precio_unitario: 100 }],
  },
  population: { beneficiarios_directos: 10 },
  attachments: { tenencia: true },
};

async function simulateRequest(userId) {
  const token = `TOKEN-USER-${userId}`;
  const orchestrator = new Orchestrator000();
  const diseno = await orchestrator.validarDiseno(fichaBase);
  const { borrador } = await orchestrator.run(fichaBase, diseno, token);
  const textoIA = borrador?.componente_administrativo?.justificacion_legal || '';
  const authRecibido = textoIA.startsWith('echo:') ? textoIA.replace('echo:Bearer ', '') : null;
  return { userId, token, authRecibido };
}

test('Orchestrator000.run(): 30 usuarios concurrentes, cada uno recibe SU PROPIO token, sin contaminación cruzada', async () => {
  const numUsers = 30;
  const promises = Array.from({ length: numUsers }, (_, u) => simulateRequest(u));
  const resultados = await Promise.all(promises);

  const contaminadas = resultados.filter(r => r.authRecibido !== null && r.authRecibido !== r.token);
  assert.equal(
    contaminadas.length, 0,
    `${contaminadas.length}/${numUsers} requests recibieron el token de otro usuario: ` +
    contaminadas.map(c => `esperaba ${c.token} recibió ${c.authRecibido}`).join('; ')
  );
  assert.equal(resultados.filter(r => r.authRecibido !== null).length, numUsers, 'todas las requests deben haber llegado al fakeServer con Authorization real');
});

test.after(() => fakeServer.close());
