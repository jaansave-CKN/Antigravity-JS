// =============================================================================
// ORCHESTRATOR-ENGINE.JS — Radar Formulador 360 v9.0
// Motor central de la Fase 1. Orquesta AGT-052 / AGT-053 / AGT-054 / AGT-056.
// Corre en el navegador (ESM puro). Llama al backend via /api/chat (Claude / Anthropic).
// =============================================================================

const AI_ENDPOINT = '/api/chat';

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

// ── Llamada unificada al proxy de IA con fallback local ───────────────────────
async function callAI(systemPrompt, userContent, { maxTokens = 1200 } = {}) {
  try {
    const res = await fetch(AI_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userContent  },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    console.warn('[Orchestrator] callAI → fallback local.', err.message);
    return null;
  }
}

// =============================================================================
// AGT-052 — Componente Administrativo y Legal
// =============================================================================
class AgentAdministrativo {
  async process(ficha) {
    const sector     = ficha.metadata?.sector     || 'general';
    const mecanismo  = ficha.metadata?.mecanismo  || 'inversion_directa';
    const userType   = ficha.metadata?.user_type  || 'Entidad pública';
    const depto      = ficha.geography?.departamento || '';
    const municipio  = ficha.geography?.municipio    || '';
    const ter        = ficha.geography?.territorialidad || {};
    const normativa  = NORMATIVA_MAP[sector] || NORMATIVA_MAP.general;

    const territorialidad = [
      ter.zomac            && 'ZOMAC',
      ter.pdet             && 'PDET',
      ter.frontera         && 'Zona de Frontera',
      ter.territorio_indigena && 'Territorio Indígena',
    ].filter(Boolean).join(' · ') || 'Territorio estándar';

    const mecanismoLabel = mecanismo === 'oxi'
      ? 'Obras por Impuestos — Art. 238 Ley 1819/2016'
      : 'Inversión Directa (SGR / SGP)';

    const systemPrompt =
      'Eres el Agente Administrativo AGT-052 del sistema Radar Formulador 360. ' +
      'Generas justificaciones legales concisas (máx. 120 palabras) para proyectos ' +
      'de inversión pública en Colombia. Solo responde con el texto, sin prefijos.';

    const userContent =
      `Sector: ${sector}. Mecanismo: ${mecanismoLabel}. Proponente: ${userType}. ` +
      `Ubicación: ${municipio}, ${depto}. Territorialidad: ${territorialidad}. ` +
      `Normativa: ${normativa}. Genera la justificación legal institucional.`;

    const justificacion_legal = await callAI(systemPrompt, userContent) ??
      `El proyecto se enmarca en los lineamientos del Plan Nacional de Desarrollo y ` +
      `la normativa sectorial vigente (${normativa}), garantizando la inversión eficiente ` +
      `de recursos públicos en ${municipio || 'el territorio de intervención'}, con ` +
      `énfasis en ${territorialidad} y cumplimiento pleno del mecanismo de ${mecanismoLabel}.`;

    return {
      titulo:              'Componente Administrativo y Legal',
      sector:              sector.charAt(0).toUpperCase() + sector.slice(1),
      normativa_aplicable: normativa,
      mecanismo:           mecanismoLabel,
      territorialidad,
      justificacion_legal,
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
  constructor() {
    this.version = '9.0';
    this._agents = {
      AGT_052: new AgentAdministrativo(),
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

  async run(ficha, disenoAprobado) {
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
      const [comp_admin, comp_operativo, comp_riesgos] = await Promise.all([
        this._agents.AGT_052.process(ficha),
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
