import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './DialecticaPage.css';
import { http } from '../lib/apiClient';

const STORAGE_KEY   = 'radar360_dialectica_config';
const DNA_FICHA_KEY = 'radar360_ficha_dna';
const CLAVE_ACCESO  = '1234';
const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

interface MotorDialecticoApi {
  tono?: string; lista_oro?: string; lista_negra?: string;
  interlocutor?: string; enfoque?: string; humanizacion?: string; adicionales?: string;
}

type AccionPendiente =
  | { tipo: 'eliminarGrupo'; lista: 'listaOro' | 'listaNegra'; cat: string }
  | { tipo: 'restaurarLista'; lista: 'listaOro' | 'listaNegra' }
  | null;

interface Categoria { id: string; titulo: string; opciones: string[]; cols: number; defecto: string; multi?: boolean }

const CATEGORIAS: Categoria[] = [
  { id: 'interlocutor', titulo: 'INTERLOCUTOR', opciones: ['Municipal','Embajada','ONG','Corporativo','Multilateral ONU/Banca'],                                    cols: 5, defecto: 'Municipal'      },
  { id: 'tono',         titulo: 'TONO',         opciones: ['Diplomatico','Institucional','Tecnico','Inspirador','Ejecutivo'],                                         cols: 5, defecto: 'Institucional'  },
  { id: 'enfoque',      titulo: 'ENFOQUE',      opciones: ['(ODS) y sostenible','Social y comunitario','Tecnico-estructural','Analítico','Financiero y Eficiente'],  cols: 5, defecto: 'Analítico'      },
  { id: 'humanizacion', titulo: 'HUMANIZACION', opciones: ['Formal','Conversacional','Relatable','Indetectable'],                                                      cols: 4, defecto: 'Conversacional' },
  { id: 'adicional',    titulo: 'ADICIONAL',    opciones: ['Economía Verde','Reglas de oro','Economía Circular','Enfoque de Género'],                                  cols: 4, defecto: '', multi: true  },
];

interface Grupo { categoria: string; items: string[] }
interface ConfigState {
  selecciones: Record<string, string>;
  adicionales: string[];
  listaOro: Grupo[];
  listaNegra: Grupo[];
}

// ── Datos por defecto ──────────────────────────────────────────────────────────
const ORO_DEFAULT: Grupo[] = [
  { categoria: 'Resultados y medición', items: [
    'Indicador SMART con fórmula explícita','Línea base (fecha + valor) definida','Meta cuantificada con plazo',
    'Fuente de verificación independiente','Frecuencia de medición establecida','Desagregación (sexo/edad/territorio)',
    'Costo por resultado logrado','Beneficiarios directos definidos y verificables','Atribución del resultado al proyecto','Unidad de medida clara',
  ]},
  { categoria: 'Diseño técnico', items: [
    'Teoría del cambio validada','Cadena lógica: insumo → producto → resultado → impacto','Supuestos críticos explícitos',
    'Escenario base vs intervención','Metodología replicable','Piloto previo con evidencia','Cobertura geográfica delimitada',
    'Criterios de elegibilidad definidos','Consistencia actividades–resultados','Externalidades identificadas',
  ]},
  { categoria: 'Riesgos', items: [
    'Matriz probabilidad/impacto','Mitigación con responsable asignado','Plan de contingencia operativo',
    'Riesgos residuales definidos','Triggers de activación claros','Dependencias críticas identificadas',
    'Riesgos regulatorios/sociales/ambientales','Sistema de alerta temprana','Supuestos monitoreados','Historial de riesgos comparables',
  ]},
  { categoria: 'Finanzas', items: [
    'Presupuesto desagregado por actividad','Costeo unitario por beneficiario','Relación costo–resultado',
    'Flujo de caja proyectado','CAPEX / OPEX diferenciados','Análisis de sensibilidad',
    'Co-financiación confirmada (%)','Costos recurrentes identificados','Sostenibilidad financiera proyectada','Auditoría externa prevista',
  ]},
  { categoria: 'Ejecución y gobernanza', items: [
    'Estructura organizacional definida','Roles y responsables trazables','Cronograma con ruta crítica',
    'Hitos verificables','Manual operativo','Capacidad instalada demostrada','Equipo con experiencia verificable',
    'Gestión contractual definida','Compras transparentes','Trazabilidad documental',
  ]},
  { categoria: 'Monitoreo y evaluación (M&E)', items: [
    'Sistema M&E implementado','Indicadores de proceso/resultado/impacto','Línea base y línea final',
    'Evaluación intermedia y final','Data quality assessment','Dashboard de seguimiento',
    'Auditoría de datos','Reportes periódicos','Mecanismo de retroalimentación','Metodología reproducible',
  ]},
  { categoria: 'Sostenibilidad', items: [
    'Estrategia post-subvención clara','Cobertura de OPEX sin subsidio','Modelo autosostenible',
    'Transferencia de capacidades','Apropiación local/institucional','Plan de mantenimiento',
    'Reducción de dependencia progresiva','Alianzas activas','Escalabilidad validada','Plan de salida del financiador',
  ]},
  { categoria: 'Trazabilidad', items: [
    'Trazabilidad indicador → fuente → método → responsable','Trazabilidad costo → actividad → resultado',
    'Registro de decisiones','Control de cambios documentado','Auditoría end-to-end',
    'Evidencia documental verificable','Versionado de datos','Integridad de datos garantizada',
    'Validación cruzada','Consistencia interna verificada',
  ]},
  { categoria: 'Contexto y viabilidad', items: [
    'Mapeo de stakeholders','Análisis de actores e intereses','Alineación con política pública',
    'Compatibilidad regulatoria','Aceptación social documentada','Riesgo de captura institucional evaluado',
    'Articulación institucional','Contexto territorial claro','Viabilidad política','Alineación con ODS',
  ]},
  { categoria: 'Madurez del proyecto', items: [
    'Piloto validado','Evidencia operativa previa','Iteraciones documentadas',
    'Lecciones aprendidas incorporadas','Nivel de madurez definido','Capacidad operativa existente',
    'Modelo probado en campo','Escalamiento progresivo','Ajustes basados en datos','Riesgo tecnológico reducido',
  ]},
];

const NEGRA_DEFAULT: Grupo[] = [
  { categoria: 'Ambigüedad', items: [
    'Mejorar / fortalecer / promover','Impacto significativo','Gran cantidad','A corto/mediano plazo',
    'Se espera','Se busca','Podría','Adecuado','Suficiente','Importante',
  ]},
  { categoria: 'Promesas no auditables', items: [
    'Garantizado','Solución definitiva','Impacto total','Cobertura completa','Sin riesgo',
    'Resultados inmediatos','Escalable globalmente (sin evidencia)','Replicable fácilmente (sin prueba)',
    'Alta eficiencia (sin indicador)','Transformador (sin medición)',
  ]},
  { categoria: 'Subjetividad', items: [
    'Yo creo','Me parece','Intuición','Asumimos','Probablemente',
    'Se considera','Experiencia propia','Percepción','A juicio del equipo','Sin datos disponibles',
  ]},
  { categoria: 'Finanzas débiles', items: [
    'Costo estimado','Presupuesto global','Gastos varios','Otros costos','Se ajustará',
    'Recursos suficientes','Sin desglose','No aplica','Pendiente definir','Costo aproximado',
  ]},
  { categoria: 'Riesgos ocultos', items: [
    'No hay riesgos','Riesgo mínimo','No aplica','Sin mitigación','Sin contingencia',
    'Supuestos no declarados','Dependencias ignoradas','Sin análisis regulatorio','Sin contexto social','Riesgos no cuantificados',
  ]},
  { categoria: 'Lenguaje comercial', items: [
    'Innovador (sin evidencia)','Revolucionario','Líder del mercado','Único','Premium',
    'De clase mundial','Alta gama','De última tecnología','Superior','Competitivo',
  ]},
  { categoria: 'Manipulación', items: [
    'Inflar beneficiarios','Mezclar directos/indirectos','Redondeos sin soporte','Datos sin fuente',
    'Inconsistencias','Subestimar costos','Sobreestimar impacto','Cambiar metodología',
    'Ocultar limitaciones','Indicadores irrelevantes',
  ]},
  { categoria: 'Inconsistencia interna', items: [
    'Indicador no mide objetivo','Costos no coinciden','Cronograma incoherente','Metas irreales vs presupuesto',
    'Actividades sin resultado','Resultados sin actividades','Capacidad < alcance',
    'Riesgos mal alineados','Datos contradictorios','Falta de coherencia lógica',
  ]},
  { categoria: 'No financiable (killer flags)', items: [
    'Beneficiarios indirectos sin método','Cobertura nacional sin piloto','Modelo replicable sin evidencia',
    'Sin costos recurrentes','Dependencia total de subvención','Sin contraparte local',
    'Datos no disponibles','Información no verificable','Se definirá después','Falta de trazabilidad',
  ]},
  { categoria: 'Vacíos críticos', items: [
    'Sin línea base','Sin indicadores','Sin M&E','Sin sostenibilidad','Sin análisis financiero',
    'Sin riesgos','Sin cronograma','Sin responsables','Sin evidencia','Sin validación externa',
  ]},
];

const ESTADO_INICIAL: ConfigState = {
  selecciones: Object.fromEntries(CATEGORIAS.filter(c => !c.multi).map(c => [c.id, c.defecto])),
  adicionales: [],
  listaOro:    ORO_DEFAULT,
  listaNegra:  NEGRA_DEFAULT,
};

// Encodes single-select cats (1 digit each) + adicional bitmask as hex char
function encodeDNA(sel: Record<string, string>, adicionales: string[]): string {
  const ADICIONAL_OPS = CATEGORIAS.find(c => c.id === 'adicional')!.opciones;
  const mask = ADICIONAL_OPS.reduce((acc, op, i) =>
    adicionales.includes(op) ? acc | (1 << i) : acc, 0);
  const single = CATEGORIAS.filter(c => !c.multi).map(cat => {
    const idx = cat.opciones.indexOf(sel[cat.id]);
    return idx === -1 ? '0' : String(idx + 1);
  }).join('');
  return single + mask.toString(16).toUpperCase();
}

export default function DialecticaPage() {
  const proyectoId = useMemo(() => localStorage.getItem(ACTIVE_PROJECT_KEY), []);
  const [st, setSt] = useState<ConfigState>(ESTADO_INICIAL);
  const [copied, setCopied] = useState(false);
  const [openOro, setOpenOro]     = useState<Set<string>>(new Set(ORO_DEFAULT.map(g => g.categoria)));
  const [openNegra, setOpenNegra] = useState<Set<string>>(new Set(NEGRA_DEFAULT.map(g => g.categoria)));
  const [inputMap, setInputMap] = useState<Record<string, string>>({});
  const [accion, setAccion]       = useState<AccionPendiente>(null);
  const [pin, setPin]             = useState('');
  const [pinError, setPinError]   = useState(false);
  const [cargando, setCargando]   = useState(!!proyectoId);
  const [guardando, setGuardando] = useState(false);
  const [errorSync, setErrorSync] = useState<string | null>(null);
  const [limpiado, setLimpiado]   = useState(false);
  // ORDEN (2026-08-24, "no se puede perder ningún dato después de guardar" —
  // mismo bug real ya corregido en LogisticaPage.tsx): `cargando` pasaba a
  // `false` en el `finally` de la hidratación SIN IMPORTAR si la petición al
  // servidor tuvo éxito o falló. Si un usuario nuevo (sin caché local todavía)
  // sufre una falla de red justo en esa carga, `st` se queda en su default
  // en blanco y el auto-sync automático de abajo lo tomaría como bueno y lo
  // postearía, pisando una configuración real que sí existiera en el
  // servidor. Solo se pone en `true` tras una hidratación confirmada.
  const hidratacionOkRef = useRef(false);
  // MANDATO (2026-08-24, "indicador de cambios sin guardar", todas las
  // ventanas del Formulador) — dirty-tracking por snapshot de `st` completo
  // (selecciones+adicionales+listaOro+listaNegra), que es exactamente lo que
  // `sincronizar()` envía al backend.
  const ultimoGuardadoRef = useRef<string | null>(null);
  if (ultimoGuardadoRef.current === null) ultimoGuardadoRef.current = JSON.stringify(st);
  const sinGuardar = JSON.stringify(st) !== ultimoGuardadoRef.current;

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    let base = ESTADO_INICIAL;
    if (raw) {
      try {
        const saved = JSON.parse(raw) as Partial<ConfigState>;
        const sels: Record<string, string> = { ...ESTADO_INICIAL.selecciones, ...(saved.selecciones ?? {}) };
        for (const cat of CATEGORIAS.filter(c => !c.multi)) {
          if (sels[cat.id] !== '' && !cat.opciones.includes(sels[cat.id])) sels[cat.id] = cat.defecto;
        }
        const esGrupos = (v: unknown): v is Grupo[] =>
          Array.isArray(v) && v.length > 0 && typeof (v[0] as Grupo).categoria === 'string';
        const ADICIONAL_OPS = CATEGORIAS.find(c => c.id === 'adicional')!.opciones;
        const savedAdic = Array.isArray(saved.adicionales)
          ? (saved.adicionales as string[]).filter(x => ADICIONAL_OPS.includes(x))
          : [];
        base = {
          selecciones: sels,
          adicionales: savedAdic,
          listaOro:   esGrupos(saved.listaOro)   ? saved.listaOro   : ORO_DEFAULT,
          listaNegra: esGrupos(saved.listaNegra) ? saved.listaNegra : NEGRA_DEFAULT,
        };
        setSt(base);
        // Este `useEffect` (a diferencia de EntradaPage/ContextoPage) hidrata
        // desde localStorage DESPUÉS del primer render, no en el initializer
        // de useState — sin esto, ultimoGuardadoRef se quedaría con el
        // ESTADO_INICIAL del primer render y `base` marcaría sinGuardar=true
        // (rojo) apenas carga, sin que el usuario haya tocado nada.
        ultimoGuardadoRef.current = JSON.stringify(base);
      } catch { /* ignore */ }
    }

    // El servidor (si hay proyecto activo) es la fuente de verdad — sobrescribe
    // el cache local si ya existe una configuración guardada ahí.
    if (!proyectoId) { setCargando(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const body = await http.get<{ success: boolean; data?: MotorDialecticoApi }>(`/api/m4/config/${proyectoId}`);
        // La petición SÍ respondió — a partir de aquí ya conocemos la verdad
        // real del servidor. Solo aquí es seguro dejar que el auto-sync
        // automático (no el botón SAVE manual) vuelva a escribir al servidor.
        if (!cancelled) hidratacionOkRef.current = true;
        const row = body.data;
        if (!cancelled && row) {
          const parseArr = (v?: string) => { try { return JSON.parse(v || '[]'); } catch { return []; } };
          setSt(prev => {
            const merged = {
              selecciones: {
                ...prev.selecciones,
                tono: row.tono || prev.selecciones.tono,
                interlocutor: row.interlocutor || prev.selecciones.interlocutor,
                enfoque: row.enfoque || prev.selecciones.enfoque,
                humanizacion: row.humanizacion || prev.selecciones.humanizacion,
              },
              adicionales: row.adicionales ? parseArr(row.adicionales) : prev.adicionales,
              listaOro:   row.lista_oro   ? parseArr(row.lista_oro)   : prev.listaOro,
              listaNegra: row.lista_negra ? parseArr(row.lista_negra) : prev.listaNegra,
            };
            ultimoGuardadoRef.current = JSON.stringify(merged);
            return merged;
          });
        }
      } catch {
        setErrorSync('No se pudo cargar la configuración guardada del servidor — se muestra el cache local.');
      } finally {
        if (!cancelled) setCargando(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    localStorage.setItem(DNA_FICHA_KEY, encodeDNA(st.selecciones, st.adicionales));
  }, [st]);

  // Sincronización real al backend — extraída para reusarse tanto en el
  // debounce automático como en el botón SAVE manual.
  // Guard de secuencia: el debounce cancela TIMERS pendientes, pero no
  // peticiones HTTP ya en vuelo. Si el usuario edita de nuevo antes de que
  // la petición anterior responda, ambas quedan en curso — sin esto, la
  // respuesta más vieja podría llegar después y pisar el estado más nuevo
  // (setGuardando(false) prematuro, o un error viejo mostrado tarde).
  const syncSeqRef = useRef(0);
  const sincronizar = useCallback(async () => {
    // FIX (2026-08-24, "SAVE se queda en rojo sin ningún aviso" — mismo
    // hallazgo en EntradaPage.tsx): antes esto era un `return` mudo.
    if (!proyectoId) { setErrorSync('No hay proyecto activo — no se pudo sincronizar.'); return; }
    const mySeq = ++syncSeqRef.current;
    setGuardando(true);
    setErrorSync(null);
    try {
      await http.post(`/api/m4/config/${proyectoId}`, {
        tono: st.selecciones.tono, lista_oro: st.listaOro, lista_negra: st.listaNegra, enfasis: '',
        interlocutor: st.selecciones.interlocutor, enfoque: st.selecciones.enfoque,
        humanizacion: st.selecciones.humanizacion, adicionales: st.adicionales,
      });
      if (mySeq !== syncSeqRef.current) return; // ya hay una sincronización más nueva en curso
      ultimoGuardadoRef.current = JSON.stringify(st);
    } catch {
      if (mySeq !== syncSeqRef.current) return;
      setErrorSync('No se pudo sincronizar la configuración dialéctica con el servidor.');
    } finally {
      if (mySeq === syncSeqRef.current) setGuardando(false);
    }
  }, [proyectoId, st]);

  // Sincronización automática al backend (debounced) — antes esta pantalla
  // era 100% localStorage pese a que /api/m4/config/:proyectoId ya existía.
  useEffect(() => {
    if (!proyectoId || cargando || !hidratacionOkRef.current) return;
    const t = setTimeout(sincronizar, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, proyectoId, cargando]);

  const guardar = async () => {
    await sincronizar(); // marca guardado/ultimoGuardadoRef al terminar con éxito
  };

  // Estado realmente en blanco — a diferencia de ESTADO_INICIAL (que usa
  // cat.defecto, el valor pre-seleccionado de fábrica), aquí cada categoría
  // de selección única queda en '' (ningún botón resaltado). '' ya es un
  // valor válido de "sin selección" para este estado (ver la coerción en la
  // carga: `sels[cat.id] !== '' && !cat.opciones.includes(...)` preserva '').
  const ESTADO_BLANCO: ConfigState = {
    selecciones: Object.fromEntries(CATEGORIAS.filter(c => !c.multi).map(c => [c.id, ''])),
    adicionales: [],
    listaOro:    ORO_DEFAULT,
    listaNegra:  NEGRA_DEFAULT,
  };

  const limpiar = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSt(ESTADO_BLANCO);
    setLimpiado(true);
    setTimeout(() => setLimpiado(false), 2000);
  };

  const seleccionar = (cat: string, op: string) =>
    setSt(s => ({ ...s, selecciones: { ...s.selecciones, [cat]: op } }));

  const toggleAdicional = (op: string) =>
    setSt(s => ({
      ...s,
      adicionales: s.adicionales.includes(op)
        ? s.adicionales.filter(x => x !== op)
        : [...s.adicionales, op],
    }));

  const toggleGrupo = (lista: 'oro' | 'negra', cat: string) => {
    const set    = lista === 'oro' ? openOro : openNegra;
    const setter = lista === 'oro' ? setOpenOro : setOpenNegra;
    const next   = new Set(set);
    next.has(cat) ? next.delete(cat) : next.add(cat);
    setter(next);
  };

  const addItem = (lista: 'listaOro' | 'listaNegra', cat: string, valor: string) => {
    const v = valor.trim();
    if (!v) return;
    setSt(s => ({
      ...s,
      [lista]: s[lista].map(g =>
        g.categoria === cat && !g.items.includes(v)
          ? { ...g, items: [...g.items, v] }
          : g
      ),
    }));
    setInputMap(m => ({ ...m, [`${lista}:${cat}`]: '' }));
  };

  const removeItem = (lista: 'listaOro' | 'listaNegra', cat: string, item: string) =>
    setSt(s => ({
      ...s,
      [lista]: s[lista].map(g =>
        g.categoria === cat ? { ...g, items: g.items.filter(x => x !== item) } : g
      ),
    }));

  const removeGrupo = (lista: 'listaOro' | 'listaNegra', cat: string) =>
    setSt(s => ({ ...s, [lista]: s[lista].filter(g => g.categoria !== cat) }));

  const abrirAccion = (a: NonNullable<AccionPendiente>) => {
    setAccion(a);
    setPin('');
    setPinError(false);
  };

  const confirmarAccion = () => {
    if (pin !== CLAVE_ACCESO) { setPinError(true); return; }
    if (!accion) return;
    if (accion.tipo === 'eliminarGrupo') removeGrupo(accion.lista, accion.cat);
    if (accion.tipo === 'restaurarLista')
      setSt(s => ({ ...s, [accion.lista]: accion.lista === 'listaOro' ? ORO_DEFAULT : NEGRA_DEFAULT }));
    setAccion(null);
  };

  const cancelarAccion = () => setAccion(null);

  const dna = encodeDNA(st.selecciones, st.adicionales);

  const copiar = () => {
    navigator.clipboard?.writeText(dna);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="diax__wrap">
      {/* ── Topbar ── */}
      <header className="diax__topbar">
        <h1 className="diax__h1">Motor Dialéctico</h1>
        <div className="diax__topbar-right">
          <button
            className={`diax__clear${limpiado ? ' diax__clear--done' : ''}`}
            onClick={limpiar}
          >
            {limpiado ? '✓ LIMPIADO' : 'LIMPIAR'}
          </button>
          <button
            className={`diax__save${sinGuardar ? ' diax__save--dirty' : ' diax__save--saved'}`}
            onClick={guardar}
            disabled={guardando}
            style={{ opacity: guardando ? 0.6 : 1, cursor: guardando ? 'not-allowed' : 'pointer' }}
            title={sinGuardar ? 'Hay cambios sin guardar' : undefined}
          >
            {guardando ? 'Guardando…' : sinGuardar ? 'SAVE' : '✓ GUARDADO'}
          </button>
        </div>
      </header>

      <div className="diax__content">
      <main className="diax">

        {(cargando || guardando || errorSync) && (
          <div style={{ fontSize: 11, fontWeight: 600, color: errorSync ? '#dc2626' : '#6b7280', marginBottom: 8 }}>
            {errorSync || (cargando ? 'Cargando configuración guardada…' : 'Guardando…')}
          </div>
        )}

        {/* ── 5 bloques de menú ── */}
        <div className="diax__sections">
          {CATEGORIAS.map(cat => (
            <section key={cat.id} className="diax__section">
              <header className="diax__cat-header">{cat.titulo}</header>
              <div className="diax__row">
                <div className="diax__sel-idx">
                  {cat.multi
                    ? st.adicionales.length || '·'
                    : (() => { const i = cat.opciones.indexOf(st.selecciones[cat.id]); return i >= 0 ? i + 1 : 0; })()
                  }
                </div>
                <div className="diax__btns" style={{ gridTemplateColumns: `repeat(${cat.cols}, 1fr)` }}>
                  {cat.opciones.map(op => {
                    const isActive = cat.multi
                      ? st.adicionales.includes(op)
                      : st.selecciones[cat.id] === op;
                    return (
                      <button
                        key={op}
                        className={isActive ? 'diax__ctrl diax__ctrl--active' : 'diax__ctrl'}
                        onClick={() => cat.multi ? toggleAdicional(op) : seleccionar(cat.id, op)}
                      >{op}</button>
                    );
                  })}
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* ── ADN automático ── */}
        <div className="diax__dna">
          <span className="diax__dna-label">ADN</span>
          <span className="diax__dna-code">{dna}</span>
          <button className="diax__dna-copy" title="Copiar" onClick={copiar}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>
              {copied ? 'check' : 'content_copy'}
            </span>
          </button>
          <span className="diax__dna-hint">Vinculado a Ficha Técnica</span>
        </div>

        {/* ── Regla final (bloqueante en formulación) ── */}
        <div className="diax__regla">
          <span className="diax__regla-icon material-symbols-outlined">gavel</span>
          <div>
            <strong>Regla de bloqueo activa</strong> — Penaliza cualquier afirmación que no tenga simultáneamente:
            <span className="diax__regla-tags">
              {['número','método','fuente','responsable'].map(t => (
                <span key={t} className="diax__regla-tag">{t}</span>
              ))}
            </span>
          </div>
        </div>

        {/* ── Lista de Oro + Lista Negra ── */}
        <section className="diax__lists">

          {/* Lista de Oro */}
          <div className="diax__list diax__list--oro">
            <div className="diax__list-header">
              <h3 className="diax__list-title">LISTA DE ORO</h3>
              <span className="diax__list-count">{st.listaOro.reduce((a,g) => a + g.items.length, 0)} términos</span>
              <button className="diax__list-restore" title="Restaurar lista de oro"
                onClick={() => abrirAccion({ tipo: 'restaurarLista', lista: 'listaOro' })}>
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>restart_alt</span>
              </button>
            </div>
            <div className="diax__list-body">
              {st.listaOro.map(grupo => {
                const abierto = openOro.has(grupo.categoria);
                const inputKey = `listaOro:${grupo.categoria}`;
                return (
                  <div key={grupo.categoria} className={`diax__grupo${abierto ? ' diax__grupo--open' : ''}`}>
                    <div className="diax__grupo-header-wrap">
                      <button className="diax__grupo-header" onClick={() => toggleGrupo('oro', grupo.categoria)}>
                        <span className="diax__grupo-arrow">{abierto ? '▼' : '▶'}</span>
                        <span className="diax__grupo-titulo">{grupo.categoria}</span>
                        <span className="diax__grupo-count">{grupo.items.length}</span>
                      </button>
                      <button className="diax__grupo-del" title="Eliminar grupo"
                        onClick={() => abrirAccion({ tipo: 'eliminarGrupo', lista: 'listaOro', cat: grupo.categoria })}>×</button>
                    </div>
                    {abierto && (
                      <div className="diax__grupo-body">
                        <ul className="diax__items">
                          {grupo.items.slice().sort((a,b) => a.localeCompare(b, 'es')).map(item => (
                            <li key={item} className="diax__item">
                              <span className="diax__item-dot">•</span>
                              <span className="diax__item-txt">{item}</span>
                              <button className="diax__item-del" onClick={() => removeItem('listaOro', grupo.categoria, item)}>×</button>
                            </li>
                          ))}
                        </ul>
                        <div className="diax__add-item">
                          <input
                            className="diax__add-input"
                            placeholder="+ Agregar término..."
                            value={inputMap[inputKey] ?? ''}
                            onChange={e => setInputMap(m => ({ ...m, [inputKey]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter') addItem('listaOro', grupo.categoria, inputMap[inputKey] ?? '');
                            }}
                          />
                          <button className="diax__add-ok" onClick={() => addItem('listaOro', grupo.categoria, inputMap[inputKey] ?? '')}>+</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Lista Negra */}
          <div className="diax__list diax__list--negra">
            <div className="diax__list-header">
              <h3 className="diax__list-title">LISTA NEGRA</h3>
              <span className="diax__list-count">{st.listaNegra.reduce((a,g) => a + g.items.length, 0)} términos</span>
              <button className="diax__list-restore" title="Restaurar lista negra"
                onClick={() => abrirAccion({ tipo: 'restaurarLista', lista: 'listaNegra' })}>
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>restart_alt</span>
              </button>
            </div>
            <div className="diax__list-body">
              {st.listaNegra.map(grupo => {
                const abierto = openNegra.has(grupo.categoria);
                const inputKey = `listaNegra:${grupo.categoria}`;
                return (
                  <div key={grupo.categoria} className={`diax__grupo${abierto ? ' diax__grupo--open' : ''}`}>
                    <div className="diax__grupo-header-wrap">
                      <button className="diax__grupo-header" onClick={() => toggleGrupo('negra', grupo.categoria)}>
                        <span className="diax__grupo-arrow">{abierto ? '▼' : '▶'}</span>
                        <span className="diax__grupo-titulo">{grupo.categoria}</span>
                        <span className="diax__grupo-count">{grupo.items.length}</span>
                      </button>
                      <button className="diax__grupo-del" title="Eliminar grupo"
                        onClick={() => abrirAccion({ tipo: 'eliminarGrupo', lista: 'listaNegra', cat: grupo.categoria })}>×</button>
                    </div>
                    {abierto && (
                      <div className="diax__grupo-body">
                        <ul className="diax__items">
                          {grupo.items.slice().sort((a,b) => a.localeCompare(b, 'es')).map(item => (
                            <li key={item} className="diax__item">
                              <span className="diax__item-dot">•</span>
                              <span className="diax__item-txt">{item}</span>
                              <button className="diax__item-del" onClick={() => removeItem('listaNegra', grupo.categoria, item)}>×</button>
                            </li>
                          ))}
                        </ul>
                        <div className="diax__add-item">
                          <input
                            className="diax__add-input"
                            placeholder="+ Agregar término..."
                            value={inputMap[inputKey] ?? ''}
                            onChange={e => setInputMap(m => ({ ...m, [inputKey]: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter') addItem('listaNegra', grupo.categoria, inputMap[inputKey] ?? '');
                            }}
                          />
                          <button className="diax__add-ok" onClick={() => addItem('listaNegra', grupo.categoria, inputMap[inputKey] ?? '')}>+</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

        </section>

        {/* ── Modal de confirmación con PIN ── */}
        {accion && (
          <div className="diax__modal-overlay" onClick={cancelarAccion}>
            <div className="diax__modal" onClick={e => e.stopPropagation()}>
              <span className={`material-symbols-outlined diax__modal-icon ${accion.tipo === 'restaurarLista' ? 'diax__modal-icon--restore' : 'diax__modal-icon--delete'}`}>
                {accion.tipo === 'restaurarLista' ? 'restart_alt' : 'delete_forever'}
              </span>
              <h3 className="diax__modal-title">
                {accion.tipo === 'restaurarLista'
                  ? `Restaurar ${accion.lista === 'listaOro' ? 'Lista de Oro' : 'Lista Negra'}`
                  : `Eliminar grupo "${accion.cat}"`}
              </h3>
              <p className="diax__modal-desc">
                {accion.tipo === 'restaurarLista'
                  ? 'Esta acción reemplazará todos los grupos y términos con los valores predeterminados. Los cambios personalizados se perderán.'
                  : 'Esta acción eliminará el grupo y todos sus términos. No se puede deshacer.'}
              </p>
              <div className="diax__modal-pin-wrap">
                <label className="diax__modal-pin-label">Clave de acceso</label>
                <input
                  className={`diax__modal-pin-input${pinError ? ' diax__modal-pin-input--error' : ''}`}
                  type="password"
                  maxLength={8}
                  placeholder="••••"
                  value={pin}
                  autoFocus
                  onChange={e => { setPin(e.target.value); setPinError(false); }}
                  onKeyDown={e => { if (e.key === 'Enter') confirmarAccion(); if (e.key === 'Escape') cancelarAccion(); }}
                />
                {pinError && <span className="diax__modal-pin-error">Clave incorrecta</span>}
              </div>
              <div className="diax__modal-actions">
                <button className="diax__modal-cancel" onClick={cancelarAccion}>Cancelar</button>
                <button className={`diax__modal-confirm ${accion.tipo === 'restaurarLista' ? 'diax__modal-confirm--restore' : 'diax__modal-confirm--delete'}`} onClick={confirmarAccion}>
                  {accion.tipo === 'restaurarLista' ? 'Restaurar' : 'Eliminar'}
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
      </div>
    </div>
  );
}
