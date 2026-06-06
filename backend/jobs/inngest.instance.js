/**
 * inngest.instance.js — Instancia Inngest compartida (sin imports de jobs)
 * Rompe la dependencia circular: inngest.client.js ↔ auditarFormulacion.js
 *
 * Todos los jobs importan `inngest` desde aquí, no desde inngest.client.js.
 */
import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id:         'radar-fondos-360',
  eventKey:   process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
