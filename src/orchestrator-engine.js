// =============================================================================
// ORCHESTRATOR-ENGINE.JS — Radar Formulador 360 v9.0
// Motor central de la Fase 1. Orquesta AGT-052 / AGT-053 / AGT-054 / AGT-056.
// Corre solo server-side (FormuladorPgController.js). Llama al backend via
// /api/chat (Claude / Anthropic). Traspasos con contrato: Handoffs.js
// (dictamen RadFor-360 2026-10-04, F1-2, F1-3, F3-1, F3-3).
// =============================================================================

import {
  obtenerContextoAgt052Schema, construirPromptAgt052, SalidaAgt052Schema,
  SECTORES_052, validarHandoff, ponerEnCuarentena,
} from './shared/contracts/Handoffs.js';
import { dlq, cuarentenaPorFallo } from './shared/infrastructure/DeadLetterQueue.js';

// Browser: relativa (el propio origen de la app). Node (Oleada 1, Grupo Elite,
// 2026-08-06): este motor ahora también corre server-side desde
// FormuladorPgController.js — `fetch` de Node no acepta URLs relativas sin base,
// así que se resuelve a localhost:PORT cuando no hay `window`.
const AI_ENDPOINT = typeof window !== 'undefined'
  ? '/api/chat'
  : `http://localhost:${process.env.PORT || 5000}/api/chat`;

// ── Hash estable de la ficha (integridad diseño↔ejecución, sin dependencias Node) ──
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function hashFicha(ficha) {
  const str = stableStringify(ficha);
  let hash = 0x811c9dc5; // FNV-1a 32-bit
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

// ── Normativas por sector (referencia MGA/POT) ─────────────────────────────────
const NORMATIVA_MAP = {
  educacion:    'Ley 715/2001, Decreto 1075/2015, NTC 4595',
  salud:        'Ley 1438/2011, Resolución 3100/2019, NSR-10',
  vivienda:     'Ley 1537/2012, Decreto 1077/2015, NSR-10 Cap.E',
  transporte:   'Ley 105/1993, Invías Manual Diseño Geométrico 2008',
  agropecuario: 'Ley 160/1994, CONPES 3866/2016',
  agua_potable: 'Ley 373/1997, RAS 2000, Resolución 0330/2017',
  cultura:      'Ley 397/1997, Ley 1185/2008',
  deporte:      'Ley 181/1995, Ley 1445/2011',
  general:      'Ley 152/1994 (LOPD), Decreto 111/1996, CONPES vigente',
};

// ── Token de auth para las llamadas server-side a /api/chat ───────────────────
// /api/chat exige Firebase Bearer token (gate universal, server.js:76-84) — sin esto,
// callAI() SIEMPRE caía silenciosamente al fallback local (hallazgo real, Oleada 1,
// Grupo Elite 2026-08-06: esta llamada nunca llevó Authorization, en navegador ni
// server, así que el texto "generado por IA" de AGT-052 nunca fue IA real).
//
// BUG CRÍTICO corregido 2026-08-14 (PROTOCOLO TITÁN ∞, segunda ronda): esto
// ANTES vivía como `_serverAuthToken`, una variable mutable a nivel de módulo,
// escrita por setServerAuthToken() antes de invocar run(). Confirmado
// reproducible al 100% bajo concurrencia real (Node es single-threaded; entre
// el `setServerAuthToken()` de una request y el primer `await` real de I/O en
// callAI() hay ventana de microtask suficiente para que otra request pise el
// token antes de que la primera lo use) — un usuario podía recibir contenido
// generado con el token de OTRO usuario, consumir su cuota de IA (checkQuota),
// o que su request fallara con 401 por un token ajeno ya revocado. Eliminado
// el estado global: el token ahora viaja como parámetro explícito en toda la
// cadena de llamadas (callAI -> AgentAdministrativo.process -> Orchestrator000.run),
// sin ningún estado compartido entre requests concurrentes.

// ── Llamada unificada al proxy de IA: timeout estricto + circuit breaker ───────
// Dictamen F3-3 (orden del dueño 2026-10-04): sin AbortSignal la llamada
// podía colgarse indefinidamente. 15 s duros por llamada; tras 3 fallos
// consecutivos el circuito se abre 60 s y AGT-052 conmuta directo a su
// plantilla local sin tocar la red. Estado a nivel de módulo: compartido
// entre requests a propósito (protege al proveedor, no guarda identidad).
export const CALLAI_TIMEOUT_MS = 15_000;
const CIRCUITO_UMBRAL = 3;
const CIRCUITO_COOLDOWN_MS = 60_000;
const circuitoIA = { fallos: 0, abiertoHasta: 0 };

export function estadoCircuitoAgt052() {
  return { ...circuitoIA, abierto: Date.now() < circuitoIA.abiertoHasta };
}

export function reiniciarCircuitoAgt052() {
  circuitoIA.fallos = 0;
  circuitoIA.abiertoHasta = 0;
}

// Devuelve { texto } o { texto: null, error, circuitoAbierto }; nunca lanza.
async function callAI(systemPrompt, userContent, { maxTokens = 1200, authToken = null, timeoutMs = CALLAI_TIMEOUT_MS } = {}) {
  if (Date.now() < circuitoIA.abiertoHasta) {
    return { texto: null, circuitoAbierto: true, error: new Error(`circuito AGT-052 abierto hasta ${new Date(circuitoIA.abiertoHasta).toISOString()}`) };
  }
  try {
    const res = await fetch(AI_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userContent  },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const texto = data.choices?.[0]?.message?.content ?? null;
    if (!texto) throw new Error('respuesta sin contenido');
    circuitoIA.fallos = 0;
    return { texto };
  } catch (err) {
    circuitoIA.fallos += 1;
    if (circuitoIA.fallos >= CIRCUITO_UMBRAL) {
      circuitoIA.abiertoHasta = Date.now() + CIRCUITO_COOLDOWN_MS;
      circuitoIA.fallos = 0;
    }
    const error = err?.name === 'TimeoutError' ? new Error(`timeout de ${timeoutMs} ms`) : err;
    console.warn('[Orchestrator] callAI → plantilla local.', error.message);
    return { texto: null, circuitoAbierto: false, error };
  }
}

// =============================================================================
// AGT-052 — Componente Administrativo y Legal
// =============================================================================
class AgentAdministrativo {
  constructor({ timeoutMs = CALLAI_TIMEOUT_MS } = {}) {
    this.timeoutMs = timeoutMs;
  }

  async process(ficha, authToken = null) {
    // Valores cerrados derivados de la ficha: sector y mecanismo nunca viajan
    // como texto libre del usuario (dictamen F1-2).
    const sectorFicha = String(ficha.metadata?.sector || '');
    const sector      = SECTORES_052.includes(sectorFicha) ? sectorFicha : 'general';
    const mecanismo   = ficha.metadata?.mecanismo === 'oxi' || ficha.metadata?.is_oxi === true ? 'oxi' : 'inversion_directa';
    const terFicha    = ficha.geography?.territorialidad || {};
    const ter = {
      zomac:               terFicha.zomac === true,
      pdet:                terFicha.pdet === true,
      frontera:            terFicha.frontera === true,
      territorio_indigena: terFicha.territorio_indigena === true,
    };
    const normativa  = NORMATIVA_MAP[sector] || NORMATIVA_MAP.general;

    const territorialidad = [
      ter.zomac               && 'ZOMAC',
      ter.pdet                && 'PDET',
      ter.frontera            && 'Zona de Frontera',
      ter.territorio_indigena && 'Territorio Indígena',
    ].filter(Boolean).join(' · ') || 'Territorio estándar';

    const mecanismoLabel = mecanismo === 'oxi'
      ? 'Obras por Impuestos — Art. 238 Ley 1819/2016'
      : 'Inversión Directa (SGR / SGP)';

    // Traspaso ficha → AGT-052: municipio y departamento contra el catálogo
    // DIVIPOLA; el modelo recibe solo el contexto validado, como JSON.
    const esquema = obtenerContextoAgt052Schema();
    const candidato = {
      sector, mecanismo,
      user_type:    String(ficha.metadata?.user_type || 'Entidad pública'),
      departamento: String(ficha.geography?.departamento || ''),
      municipio:    String(ficha.geography?.municipio || ''),
      territorialidad: ter,
    };
    const contexto = esquema
      ? validarHandoff(esquema, candidato, { origen: 'ficha_usuario', destino: 'AGT-052', dlq })
      : { ok: false, registro: ponerEnCuarentena({ origen: 'ficha_usuario', destino: 'AGT-052', motivo: 'catalogo_divipola_no_disponible', errores: ['catálogo DIVIPOLA no cargado'], muestra: candidato, dlq }) };

    let justificacion_legal = null;
    let origen_justificacion = 'plantilla';
    if (contexto.ok) {
      const { system, user } = construirPromptAgt052(contexto.data, normativa);
      const ia = await callAI(system, user, { authToken, timeoutMs: this.timeoutMs });
      if (ia.texto) {
        const salida = validarHandoff(SalidaAgt052Schema, { justificacion_legal: ia.texto, origen: 'ia' }, { origen: 'AGT-052', destino: 'borrador_ficha', dlq });
        if (salida.ok) {
          justificacion_legal = salida.data.justificacion_legal;
          origen_justificacion = 'ia';
        }
      } else {
        cuarentenaPorFallo({
          origen: 'AGT-052', destino: 'api_chat',
          motivo: ia.circuitoAbierto ? 'circuito_abierto' : 'ia_no_disponible',
          error: ia.error, muestra: { sector, mecanismo, municipio: contexto.data.municipio },
        });
      }
    }

    // Plantilla local: solo usa valores validados o cerrados, nunca el texto
    // crudo del usuario si no pasó el contrato.
    const lugar = contexto.ok ? contexto.data.municipio : 'el territorio de intervención';
    justificacion_legal ??=
      `El proyecto se enmarca en los lineamientos del Plan Nacional de Desarrollo y ` +
      `la normativa sectorial vigente (${normativa}), garantizando la inversión eficiente ` +
      `de recursos públicos en ${lugar}, con ` +
      `énfasis en ${territorialidad} y cumplimiento pleno del mecanismo de ${mecanismoLabel}.`;

    return {
      titulo:              'Componente Administrativo y Legal',
      sector:              sector.charAt(0).toUpperCase() + sector.slice(1),
      normativa_aplicable: normativa,
      mecanismo:           mecanismoLabel,
      territorialidad,
      justificacion_legal,
      origen_justificacion,
    };
  }
}

// =============================================================================
// AGT-053 — Componente Operativo y Financiero
// =============================================================================
class AgentOperativo {
  async process(ficha) {
    const insumos = ficha.technical_core?.bill_of_materials ?? [];

    const costo_directo = insumos.reduce((acc, item) => {
      return acc + ((item.cantidad || 0) * (item.precio_unitario || 0));
    }, 0);

    // Estructura financiera colombiana estándar: AIU 25% + IVA 19% sobre AIU
    const aiu_25        = Math.round(costo_directo * 0.25);
    const iva_sobre_aiu = Math.round(aiu_25 * 0.19);
    const presupuesto_total = costo_directo + aiu_25 + iva_sobre_aiu;

    return {
      titulo: 'Componente Operativo y Financiero',
      resumen_financiero: { costo_directo, aiu_25, iva_sobre_aiu, presupuesto_total },
    };
  }
}

// =============================================================================
// AGT-054 — Componente de Riesgos y Sostenibilidad
// =============================================================================
class AgentRiesgos {
  async process(ficha) {
    const ter    = ficha.geography?.territorialidad || {};
    const hasOxi = ficha.metadata?.is_oxi || false;
    const zonaAlta = ter.zomac || ter.pdet || ter.frontera;

    const riesgos = [
      {
        categoria:    'Financiero',
        tipo:         'Insuficiencia presupuestal',
        probabilidad: 'Media',
        impacto:      'Alto',
        nivel_riesgo: 'ALTO',
        mitigacion:   'Gestión de contrapartidas y reserva técnica del 10%.',
      },
      {
        categoria:    'Social',
        tipo:         'Oposición comunitaria',
        probabilidad: zonaAlta ? 'Alta' : 'Baja',
        impacto:      'Medio',
        nivel_riesgo: zonaAlta ? 'ALTO' : 'MEDIO',
        mitigacion:   'Talleres de socialización y acta de voluntad comunitaria previa.',
      },
      {
        categoria:    'Legal',
        tipo:         hasOxi ? 'Incumplimiento OxI / CONFIS' : 'Cambio normativo',
        probabilidad: 'Baja',
        impacto:      'Alto',
        nivel_riesgo: 'MEDIO',
        mitigacion:   hasOxi
          ? 'Verificación anticipada de cupo CONFIS y asesoría jurídica permanente.'
          : 'Monitoreo continuo de normativa sectorial y cláusulas de ajuste.',
      },
      {
        categoria:    'Ambiental',
        tipo:         'Licencias y permisos CAR/ANLA',
        probabilidad: 'Media',
        impacto:      'Medio',
        nivel_riesgo: 'MEDIO',
        mitigacion:   'Gestión anticipada de permisos ambientales.',
      },
    ];

    const weights = { ALTO: 3, MEDIO: 2, BAJO: 1 };
    const riesgo_global = riesgos.reduce((max, r) =>
      (weights[r.nivel_riesgo] || 0) > (weights[max] || 0) ? r.nivel_riesgo : max
    , 'BAJO');

    return {
      titulo: 'Componente de Riesgos y Sostenibilidad',
      riesgo_global,
      riesgos,
    };
  }
}

// =============================================================================
// AGT-056 — Evaluador de Viabilidad
// =============================================================================
class AgentEvaluador {
  async evaluate(ficha, _borrador) {
    const tc  = ficha.technical_core ?? {};
    const geo = ficha.geography      ?? {};
    const pop = ficha.population     ?? {};
    const att = ficha.attachments    ?? {};

    const checks = [
      {
        test: 'Sector y tipo de proponente definidos',
        pass: !!(ficha.metadata?.sector && ficha.metadata?.user_type),
        msg:  !ficha.metadata?.sector ? 'Sector requerido' : null,
      },
      {
        test: 'Ubicación geográfica completa',
        pass: !!(geo.departamento && geo.municipio),
        msg:  !geo.municipio ? 'Municipio requerido' : null,
      },
      {
        test: 'Diagnóstico: problema, causa y efecto',
        pass: !!(tc.problem_statement && tc.root_cause && tc.expected_effect),
        msg:  !tc.problem_statement ? 'Declaración del problema requerida' : null,
      },
      {
        test: 'Indicadores SMART registrados',
        pass: (tc.smart_indicators?.length ?? 0) > 0,
        msg:  'Agregue al menos un indicador SMART',
      },
      {
        test: 'Población objetivo cuantificada',
        pass: (pop.beneficiarios_directos ?? 0) > 0,
        msg:  'Defina el número de beneficiarios directos',
      },
      {
        test: 'BOM / Insumos técnicos cargados',
        pass: (tc.bill_of_materials?.length ?? 0) > 0,
        msg:  'Agregue ítems al presupuesto de insumos',
      },
      {
        test: 'Documentación legal mínima adjunta',
        pass: !!(att.tenencia || att.personeria),
        msg:  'Adjunte certificado de tenencia o personería jurídica',
      },
      {
        test: 'Certificado CONFIS (obligatorio para OxI)',
        pass: !ficha.metadata?.is_oxi || !!att.confis_certificate,
        msg:  ficha.metadata?.is_oxi && !att.confis_certificate
          ? '⛔ Cupo CONFIS obligatorio para Obras por Impuestos' : null,
      },
    ];

    const passed         = checks.filter(c => c.pass).length;
    const total          = checks.length;
    const puntaje        = passed * 12;
    const puntaje_maximo = total  * 12;
    const porcentaje     = Math.round((passed / total) * 100);
    const aprobado       = porcentaje >= 75;

    return {
      titulo:          'Evaluación de Viabilidad — AGT-056',
      aprobado,
      porcentaje,
      veredicto:       aprobado
        ? 'VIABLE — Ficha técnica lista para radicación'
        : 'OBSERVACIONES — Corrija los puntos marcados antes de radicar',
      puntaje,
      puntaje_maximo,
      checks,
    };
  }
}

// =============================================================================
// ORCHESTRATOR000 — Exportación pública
// =============================================================================
export class Orchestrator000 {
  constructor({ timeoutIAms = CALLAI_TIMEOUT_MS } = {}) {
    this.version = '9.0';
    this._agents = {
      AGT_052: new AgentAdministrativo({ timeoutMs: timeoutIAms }),
      AGT_053: new AgentOperativo(),
      AGT_054: new AgentRiesgos(),
      AGT_056: new AgentEvaluador(),
    };
  }

  // ── GATE DE ARQUITECTURA — validar primero, ejecutar después ─────────────────
  // AGT-056 solo depende de `ficha` (nunca leyó `_borrador`), así que la misma
  // evaluación de completitud que antes corría DESPUÉS de generar el borrador
  // puede — y debe — correr ANTES, como condición de entrada a run().
  async validarDiseno(ficha) {
    if (!ficha || typeof ficha !== 'object') {
      return { aprobado: false, porcentaje: 0, checks: [], firma: null,
        error: 'Ficha inválida: se requiere un objeto con los datos de Fase 1.' };
    }
    const evaluation = await this._agents.AGT_056.evaluate(ficha);
    return {
      aprobado:   evaluation.aprobado,
      porcentaje: evaluation.porcentaje,
      checks:     evaluation.checks,
      firma:      hashFicha(ficha),
      timestamp:  Date.now(),
    };
  }

  async run(ficha, disenoAprobado, authToken = null) {
    try {
      if (!ficha || typeof ficha !== 'object') {
        throw new Error('Ficha inválida: se requiere un objeto con los datos de Fase 1.');
      }

      // GATE — sin diseño aprobado y vigente, no se invoca a ningún agente generador.
      if (!disenoAprobado || disenoAprobado.aprobado !== true) {
        throw new Error(
          'GATE_ARQUITECTURA: la ficha no tiene un diseño aprobado. ' +
          'Llama a Orchestrator000.validarDiseno(ficha) y solo invoca run() si aprobado === true.'
        );
      }
      if (disenoAprobado.firma !== hashFicha(ficha)) {
        throw new Error(
          'GATE_ARQUITECTURA: la ficha cambió después de la validación de diseño. ' +
          'Vuelve a llamar validarDiseno(ficha) con los datos actuales antes de ejecutar.'
        );
      }

      // Diseño aprobado y firma vigente ⇒ AGT-052, 053, 054 corren en paralelo.
      // authToken se pasa explícito por parámetro (no estado global) — cierra
      // la race condition de identidad cruzada bajo concurrencia, ver nota en
      // la definición de callAI() más arriba.
      const [comp_admin, comp_operativo, comp_riesgos] = await Promise.all([
        this._agents.AGT_052.process(ficha, authToken),
        this._agents.AGT_053.process(ficha),
        this._agents.AGT_054.process(ficha),
      ]);

      const borrador = {
        componente_administrativo: comp_admin,
        componente_operativo:      comp_operativo,
        componente_riesgos:        comp_riesgos,
      };

      // Evaluación final del borrador ya generado (informe de salida, no gate de entrada).
      const evaluation = await this._agents.AGT_056.evaluate(ficha, borrador);

      console.log(`[Orchestrator000 v${this.version}] Pipeline Fase 1 completado.`, {
        aprobado:   evaluation.aprobado,
        porcentaje: evaluation.porcentaje + '%',
      });

      return { success: true, borrador, evaluation };

    } catch (err) {
      console.error('[Orchestrator000] Error crítico en pipeline:', err);
      return { success: false, error: err.message, borrador: null, evaluation: null };
    }
  }
}
