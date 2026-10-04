// =============================================================================
// DeadLetterQueue.js — cola de cuarentena de RadFor-360 (dictamen F3-1).
//
// Todo traspaso rechazado por contrato (Handoffs.js) y todo fallo de M1,
// AGT-052 o el Radar Cron (HTTP 500, timeout, proveedor caído, salida no
// deserializable) queda aquí en vez de morir en un console.error.
//
// Dos sumideros append-only, ambos opcionales e independientes:
//  - Archivo JSONL (DLQ_PATH, por defecto logs/dlq/cuarentena.jsonl — logs/
//    está en .gitignore, nunca se versiona). Sirve en local; en Render el
//    disco es efímero.
//  - Upstash Redis RPUSH sobre la lista "dlq:cuarentena" (durable en
//    producción). Sin LTRIM: retención append-only.
// El registro llega ya validado por RegistroCuarentenaSchema: huella SHA-256 y
// PII/credenciales redactadas ANTES de persistir (Ley 1581).
// Ningún fallo de la DLQ lanza hacia la request que la originó.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RegistroCuarentenaSchema, ponerEnCuarentena } from '../contracts/Handoffs.js';

const RUTA_DEFAULT = fileURLToPath(new URL('../../../logs/dlq/cuarentena.jsonl', import.meta.url));
export const CLAVE_REDIS_DLQ = 'dlq:cuarentena';
const REDIS_TIMEOUT_MS = 8_000;

export function crearDLQ({ ruta = process.env.DLQ_PATH || RUTA_DEFAULT, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const pendientes = new Set();
  return {
    ruta,
    registrar(registro) {
      const linea = JSON.stringify(RegistroCuarentenaSchema.parse(registro));
      try {
        fs.mkdirSync(path.dirname(ruta), { recursive: true });
        fs.appendFileSync(ruta, `${linea}\n`, { encoding: 'utf8', flag: 'a' });
      } catch (err) {
        console.error('[DLQ] Archivo no disponible:', err.message);
      }
      const url = env.UPSTASH_REDIS_REST_URL;
      const token = env.UPSTASH_REDIS_REST_TOKEN;
      if (url && token) {
        const envio = fetchImpl(`${url}/rpush/${encodeURIComponent(CLAVE_REDIS_DLQ)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: linea,
          signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
        })
          .then(r => { if (!r.ok) console.error(`[DLQ] Redis RPUSH respondió ${r.status}`); })
          .catch(err => console.error('[DLQ] Redis no disponible:', err.message))
          .finally(() => pendientes.delete(envio));
        pendientes.add(envio);
      }
    },
    leer() {
      if (!fs.existsSync(ruta)) return [];
      return fs.readFileSync(ruta, 'utf8').split('\n').filter(Boolean).map(l => RegistroCuarentenaSchema.parse(JSON.parse(l)));
    },
    // Para pruebas y apagado ordenado: espera los RPUSH en vuelo.
    async drenar() {
      await Promise.allSettled([...pendientes]);
    },
  };
}

export const dlq = crearDLQ();

// Atajo para los catch de los agentes: errores de excepción → cuarentena.
export function cuarentenaPorFallo({ origen, destino, motivo, error, muestra }) {
  return ponerEnCuarentena({
    origen, destino, motivo,
    errores: [`${error?.name || 'Error'}: ${error?.message || String(error)}`],
    muestra,
    dlq,
  });
}
