/**
 * planGateCargaDirecta.test.mjs — regresión del 2026-09-29 (verificada en
 * producción): recargar /entrada, /checklist, /busqueda-semantica… mandaba a
 * /planes a usuarios CON plan, porque PlanGate veía loading=false y el plan
 * 'free' por defecto antes de que se pidiera la suscripción. En DEV PlanGate
 * se salta, así que ningún e2e lo cubre: esta prueba fija la estructura del
 * arreglo (el comportamiento real se verificó con el build de producción).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ctx = fs.readFileSync(new URL('../../client/src/contexts/SubscriptionContext.tsx', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../../client/src/main.tsx', import.meta.url), 'utf8');

test('la suscripción queda "pendiente" en el render hasta resolverse para la sesión actual', () => {
  assert.match(ctx, /const pendiente = claveSesion !== null && claveSesion !== resueltaPara;/);
  assert.match(ctx, /finally \{[\s\S]{0,80}setResueltaPara\(claveSesion\);/, 'se marca resuelta pase lo que pase');
  assert.match(ctx, /loading: loading \|\| pendiente,/, 'PlanGate recibe loading=true mientras está pendiente');
  assert.match(ctx, /AbortSignal\.timeout\(15_000\)/, 'la petición nunca deja el gate colgado');
});

test('PlanGate espera a loading antes de decidir la redirección a /planes', () => {
  const gate = main.slice(main.indexOf('function PlanGate'), main.indexOf('function RouteLoadingFallback'));
  const iLoading = gate.indexOf('if (loading)');
  const iNavigate = gate.indexOf('<Navigate to="/planes"');
  assert.ok(iLoading > 0 && iNavigate > iLoading, 'el spinner de loading va antes de cualquier Navigate a /planes');
});
