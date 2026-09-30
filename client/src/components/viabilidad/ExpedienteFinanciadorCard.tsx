/**
 * ExpedienteFinanciadorCard.tsx — Expediente del Financiador en Viabilidad
 * (Fase C de la directiva "Audit de Impacto Integral", decisión del dueño
 * 2026-09-30: "en viabilidad estaría perfecto").
 *
 * Muestra los 5 ejes elegidos en Entrada y, SOLO para las secciones que esos
 * ejes exigen, el contenido que arma el agente creador
 * (backend/services/expedienteFinanciador.js): ruta causal de Teoría del
 * Cambio, salvaguardas ESS, plan MEL, registro de riesgos PMI y checklist
 * jurídico. Cada ítem muestra sus fuentes; lo que la IA no pudo sustentar se
 * descarta y se informa. El checklist nunca da un documento por soportado sin
 * un anexo real (lo decide el servidor).
 *
 * Estilos: SIN valores nuevos — copiados literal de DictamenIACard y
 * ComiteMirofishCard (ViabilidadPage.tsx): botón #0041a3 9px 18px radio 8,
 * bloque con borde izquierdo 3px + fondo rgba(0,0,0,0.02), títulos 10.5/700
 * en mayúsculas, listas 12.5 #191c1e, evidencia 11 #76777d.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { http } from '../../lib/apiClient';

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

type SeccionId = 'teoria_cambio' | 'salvaguardas' | 'mel' | 'riesgos_pmi' | 'checklist_juridico';
type Item = Record<string, string | number | boolean | string[] | undefined> & { fuentes?: string[] };
interface Generacion {
  estado: 'ok' | 'sin_contenido_verificable';
  contenido: { grupos: Record<string, Item[]>; fuentes_omitidas?: string[] };
  descartados: Array<{ grupo: string; item: string; motivo: string; detalle?: string }>;
  modelo: string | null;
  created_at: string;
  desactualizada: boolean;
}
interface Seccion { id: SeccionId; titulo: string; aplica: boolean; ultima: Generacion | null }
interface Expediente {
  directivas: {
    vectores: { tipoProyecto: string; fuente: string; nivel: string; metodologias: string[]; formato: string };
    esquema: 'nacional' | 'internacional' | 'sin_definir';
    conflictos: Array<{ tipo: string; detalle: string }>;
  };
  secciones: Seccion[];
}

const ESQUEMA_TEXTO: Record<Expediente['directivas']['esquema'], string> = {
  nacional: 'Régimen nacional (COP)', internacional: 'Régimen internacional', sin_definir: 'Régimen sin definir',
};
const GRUPO_TITULO: Record<string, string> = {
  impacto_largo_plazo: 'Impacto de largo plazo', resultados_intermedios: 'Resultados intermedios (outcomes)',
  precondiciones: 'Precondiciones', intervenciones: 'Intervenciones', supuestos_criticos: 'Supuestos críticos',
  categoria: 'Categoría de riesgo', estandares: 'Estándares ESS activados', indicadores: 'Indicadores MEL',
  riesgos: 'Registro de riesgos', documentos: 'Documentos de radicación',
};
const MOTIVO_DESCARTE: Record<string, string> = {
  sin_fuente: 'sin fuente', fuente_inexistente: 'fuente inexistente', cifra_no_trazable: 'cifra que no está en sus fuentes',
  valor_invalido: 'valor fuera de catálogo', campo_vacio: 'campo vacío',
};
const COLOR_OK = '#15803d', COLOR_ALERTA = '#b45309', COLOR_ERROR = '#ba1a1a', COLOR_MUTED = '#76777d', COLOR_TEXTO = '#191c1e', COLOR_PRIMARIO = '#0041a3';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** Texto de un ítem según su sección (sin cálculo salvo P×I, que es aritmética de calificaciones). */
function textoItem(seccion: SeccionId, grupo: string, it: Item): string {
  if (seccion === 'teoria_cambio') return s(it.texto);
  if (seccion === 'salvaguardas' && grupo === 'categoria') return `Categoría ${s(it.categoria)} — ${s(it.justificacion)}`;
  if (seccion === 'salvaguardas') return `${s(it.estandar)}: ${s(it.impacto)} → ${s(it.medida)}`;
  if (seccion === 'mel') return `${s(it.indicador)} · Línea base: ${s(it.linea_base)} · Meta: ${s(it.meta)} · ${s(it.metodo)} · ${s(it.frecuencia)} · Responsable: ${s(it.responsable)}`;
  if (seccion === 'riesgos_pmi') {
    const p = Number(it.probabilidad), i = Number(it.impacto);
    return `${s(it.evento)} (${s(it.categoria)}) · P${p} × I${i} = ${p * i} · Respuesta: ${s(it.respuesta)} · Reserva: ${s(it.reserva)}`;
  }
  const soporte = it.estado === 'soportado_por_anexo' ? `Anexo: ${s(it.anexo)}`
    : it.estado === 'anexo_propuesto_verificar' ? `Anexo propuesto (verificar): ${s(it.anexo)}`
      : 'Sin anexo que lo soporte';
  return `${s(it.documento)}${it.obligatorio ? ' (obligatorio)' : ''}${it.referencia ? ` — ${s(it.referencia)}` : ''} · ${soporte}${it.nota ? ` · ${s(it.nota)}` : ''}`;
}

function colorEstado(g: Generacion | null): string {
  if (!g) return COLOR_MUTED;
  return g.estado === 'ok' ? COLOR_OK : COLOR_ALERTA;
}
function etiquetaEstado(g: Generacion | null): string {
  if (!g) return 'SIN GENERAR';
  return g.estado === 'ok' ? 'GENERADA' : 'SIN CONTENIDO VERIFICABLE';
}

// Checklist: ✓ solo lo que el SISTEMA verificó; lo propuesto por la IA se marca para verificar.
const MARCA_CHECKLIST: Record<string, { marca: string; color: string }> = {
  soportado_por_anexo: { marca: '✓ ', color: COLOR_OK },
  anexo_propuesto_verificar: { marca: '? ', color: COLOR_ALERTA },
  no_detectado: { marca: '✗ ', color: COLOR_ERROR },
};

function CabeceraSeccion({ titulo, g, color }: { titulo: string; g: Generacion | null; color: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', background: color, padding: '2px 8px', borderRadius: 6 }}>{etiquetaEstado(g)}</span>
      <strong style={{ fontSize: 12.5, color: COLOR_TEXTO }}>{titulo}</strong>
      {g && <span style={{ fontSize: 10.5, color: COLOR_MUTED }}>{g.modelo || 'IA'} · {new Date(g.created_at).toLocaleString('es-CO', { hour12: false })}</span>}
      {g?.desactualizada && <span style={{ fontSize: 10.5, color: COLOR_ALERTA, fontWeight: 700 }}>Las fuentes cambiaron · regenerar</span>}
    </div>
  );
}

function ItemGrupo({ seccionId, grupo, it }: { seccionId: SeccionId; grupo: string; it: Item }) {
  const marca = seccionId === 'checklist_juridico' ? (MARCA_CHECKLIST[s(it.estado)] ?? MARCA_CHECKLIST.no_detectado) : null;
  return (
    <li style={marca ? { color: marca.color } : undefined}>
      {marca?.marca}{textoItem(seccionId, grupo, it)}
      {it.fuentes && it.fuentes.length > 0 && (
        <div style={{ fontSize: 11, color: COLOR_MUTED }}>Fuentes: {it.fuentes.join(' · ')}</div>
      )}
    </li>
  );
}

function GrupoSeccion({ seccionId, grupo, items }: { seccionId: SeccionId; grupo: string; items: Item[] }) {
  // Clave estable por contenido (los ítems no traen id; dos idénticos se muestran una vez).
  const unicos = [...new Map(items.map(it => [JSON.stringify(it), it])).entries()];
  return (
    <div>
      <p style={{ margin: '0 0 6px', fontSize: 10.5, fontWeight: 700, color: COLOR_PRIMARIO, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{GRUPO_TITULO[grupo] || grupo}</p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: COLOR_TEXTO }}>
        {unicos.map(([clave, it]) => <ItemGrupo key={clave} seccionId={seccionId} grupo={grupo} it={it} />)}
      </ul>
    </div>
  );
}

function NotasSeccion({ g }: { g: Generacion }) {
  return (
    <>
      {g.descartados.length > 0 && (
        <div style={{ fontSize: 11, color: COLOR_MUTED }} title={g.descartados.map(d => `${d.item || d.grupo}: ${MOTIVO_DESCARTE[d.motivo] || d.motivo}${d.detalle ? ` (${d.detalle})` : ''}`).join('\n')}>
          {g.descartados.length} ítem(s) de la IA descartados por no poder sustentarse en las fuentes del proyecto.
        </div>
      )}
      {g.contenido.fuentes_omitidas && g.contenido.fuentes_omitidas.length > 0 && (
        <div style={{ fontSize: 11, color: COLOR_MUTED }}>
          No cupieron en el análisis (límite de tamaño): {g.contenido.fuentes_omitidas.join(', ')}.
        </div>
      )}
    </>
  );
}

function SeccionBloque({ seccion, cargando, bloqueado, error, onGenerar }: { seccion: Seccion; cargando: boolean; bloqueado: boolean; error: string | null; onGenerar: () => void }) {
  const g = seccion.ultima;
  const color = colorEstado(g);
  const grupos = g ? Object.entries(g.contenido.grupos || {}).filter(([, items]) => items.length > 0) : [];
  return (
    <div data-testid={`expediente-${seccion.id}`} style={{ padding: '8px 12px', borderRadius: 8, borderLeft: `3px solid ${color}`, background: 'rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <CabeceraSeccion titulo={seccion.titulo} g={g} color={color} />
      <button
        onClick={onGenerar}
        disabled={bloqueado}
        style={{
          alignSelf: 'flex-start', padding: '9px 18px', borderRadius: 8, border: 'none',
          background: COLOR_PRIMARIO, color: '#fff', fontWeight: 700, fontSize: 13,
          cursor: bloqueado ? 'not-allowed' : 'pointer', opacity: bloqueado ? 0.6 : 1,
        }}
      >
        {cargando ? 'Generando con IA… (puede tardar varios segundos)' : g ? 'Volver a generar' : 'Generar sección'}
      </button>
      {error && <div style={{ color: COLOR_ERROR, fontSize: 12.5 }} role="alert">{error}</div>}
      {g && g.estado === 'sin_contenido_verificable' && (
        <div style={{ fontSize: 12.5, color: COLOR_ALERTA }}>
          Las fuentes del proyecto no alcanzan para sustentar esta sección. Adjunta en Anexos los documentos del financiador (términos de referencia, estudios) y vuelve a generar.
        </div>
      )}
      {grupos.map(([grupo, items]) => <GrupoSeccion key={grupo} seccionId={seccion.id} grupo={grupo} items={items} />)}
      {g && <NotasSeccion g={g} />}
    </div>
  );
}

export default function ExpedienteFinanciadorCard() {
  const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
  const [expediente, setExpediente] = useState<Expediente | null>(null);
  const [cargandoSeccion, setCargandoSeccion] = useState<SeccionId | null>(null);
  const [errores, setErrores] = useState<Partial<Record<SeccionId, string>>>({});
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const enCursoRef = useRef(false);

  const cargar = useCallback(async (vigente: () => boolean = () => true) => {
    if (!proyectoId) return;
    try {
      const r = await http.get<{ data: Expediente }>(`/api/proyectos/${proyectoId}/expediente`);
      if (vigente()) { setExpediente(r.data); setErrorCarga(null); }
    } catch (e) {
      if (vigente()) setErrorCarga(e instanceof Error ? e.message : 'No se pudo cargar el expediente');
    }
  }, [proyectoId]);

  useEffect(() => {
    let activo = true;
    void cargar(() => activo);
    return () => { activo = false; };
  }, [cargar]);

  const generar = async (seccion: SeccionId) => {
    if (!proyectoId || enCursoRef.current) return;
    enCursoRef.current = true;
    setCargandoSeccion(seccion);
    setErrores(prev => ({ ...prev, [seccion]: undefined }));
    try {
      await http.post(`/api/proyectos/${proyectoId}/expediente/${seccion}`, {});
      await cargar();
    } catch (e) {
      setErrores(prev => ({ ...prev, [seccion]: e instanceof Error ? e.message : 'No se pudo generar la sección' }));
    } finally {
      enCursoRef.current = false;
      setCargandoSeccion(null);
    }
  };

  if (!proyectoId) return null;
  const d = expediente?.directivas;
  const aplican = expediente?.secciones.filter(x => x.aplica) ?? [];
  const noAplican = expediente?.secciones.filter(x => !x.aplica) ?? [];

  return (
    <div className="viab__card" style={{ gridColumn: '1 / -1' }}>
      <div className="viab__card-header">
        <span className="material-symbols-outlined">folder_special</span>
        Expediente del Financiador — según los ejes elegidos en Entrada
      </div>
      <div className="viab__card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {errorCarga && <div style={{ color: COLOR_ERROR, fontSize: 12.5 }} role="alert">{errorCarga}</div>}
        {d && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: COLOR_TEXTO }}>
            <span style={{ fontWeight: 700, color: d.esquema === 'sin_definir' ? COLOR_ALERTA : COLOR_PRIMARIO }}>{ESQUEMA_TEXTO[d.esquema]}</span>
            <span>Fuente: {d.vectores.fuente || 'sin definir'}</span>
            <span>Formato: {d.vectores.formato || 'sin definir'}</span>
            <span>Metodologías: {d.vectores.metodologias.join(', ') || 'sin definir'}</span>
            <span style={{ color: COLOR_MUTED }}>Tipo: {d.vectores.tipoProyecto || 'sin definir'} · Nivel: {d.vectores.nivel || 'sin definir'}</span>
          </div>
        )}
        {d?.conflictos.map(c => (
          <div key={c.tipo} style={{ color: COLOR_ERROR, fontSize: 12.5 }} role="alert">Ejes incoherentes: {c.detalle}</div>
        ))}
        {aplican.map(sec => (
          <SeccionBloque key={sec.id} seccion={sec} cargando={cargandoSeccion === sec.id} bloqueado={cargandoSeccion !== null} error={errores[sec.id] ?? null} onGenerar={() => void generar(sec.id)} />
        ))}
        {noAplican.length > 0 && (
          <div style={{ fontSize: 11, color: COLOR_MUTED }}>
            No exigidas por los ejes elegidos: {noAplican.map(x => x.titulo).join(' · ')}. Se activan al marcarlas en Entrada (Metodologías / Fuente de Financiación).
          </div>
        )}
      </div>
    </div>
  );
}
