/**
 * ExportacionPage — Reporte Maestro (PDF certificado, SSR) + Exportaciones MGA/BID/OXI
 *
 * Cirugía 2026-08-08 (Operación Blindaje Final, hallazgo 1 de la radiografía
 * 360): el comentario original de este archivo (ver git blame) afirmaba que
 * `/api/proyectos/:id/exportar/:formato` "era fantasma — no existe en el
 * backend". Verificado en esta sesión que es falso: `backend/routes/
 * exportacion.routes.js` registra los 3 endpoints reales (mga/bid/oxi, cada
 * uno con su propio generador en `exportGenerator.js`) y `registerExportacionRoutes`
 * SÍ se invoca en `server.js` — solo estaban huérfanos de UI. Se restauran
 * los 3 botones junto al Reporte Maestro, sin tocar el backend (ya funcional).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthHeaders, http } from '../lib/apiClient';

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

const T = {
  bg: '#f7f9fb', card: '#ffffff', border: '#e0e3e5', text: '#191c1e',
  textMuted: 'rgba(25,28,30,0.55)', primary: '#0058be', primarySoft: 'rgba(0,88,190,0.08)',
  error: '#ba1a1a', font: "'Manrope', sans-serif",
};

interface FormatoExportacion {
  id: string;
  titulo: string;
  descripcion: string;
  endpoint: (proyectoId: string) => string;
  archivo: (proyectoId: string) => string;
}

const FORMATOS: FormatoExportacion[] = [
  {
    id: 'maestro',
    titulo: 'Reporte Maestro (PDF)',
    descripcion: 'Ficha técnica + presupuesto + sello de cross-check, generado en el servidor.',
    endpoint: (id) => `/api/modulo9/reporte/${id}`,
    archivo: (id) => `RadarFondos_${id.slice(0, 8)}_reporte.pdf`,
  },
  {
    id: 'mga',
    titulo: 'Formato MGA',
    descripcion: 'Metodología General Ajustada — árbol de objetivos e indicadores en estructura MGA.',
    endpoint: (id) => `/api/proyectos/${id}/exportar/mga`,
    archivo: (id) => `MGA_${id}.pdf`,
  },
  {
    id: 'bid',
    titulo: 'Formato BID',
    descripcion: 'Marco lógico en estructura BID (árbol de objetivos + indicadores).',
    endpoint: (id) => `/api/proyectos/${id}/exportar/bid`,
    archivo: (id) => `BID_${id}.pdf`,
  },
  {
    id: 'oxi',
    titulo: 'Formato OXI',
    descripcion: 'Ficha de proyecto en estructura OXI (contexto + logística + marco lógico).',
    endpoint: (id) => `/api/proyectos/${id}/exportar/oxi`,
    archivo: (id) => `OXI_${id}.pdf`,
  },
];

// ── Fase 3: Formulador MGA (consolidación con IA) ──────────────────────────
// R8 (architect 2026-09-26): no hay nodo de Stitch para esta sección — usa
// SOLO los tokens T de esta página y las medidas de las tarjetas existentes.
interface ParrafoMga { texto: string; fuentes: string[] }
interface ConsolidacionMga {
  id: string;
  estado: 'ok' | 'no_disponible';
  motivo: string | null;
  bloques: Record<string, { estado: string; parrafos: ParrafoMga[] }> | null;
  descartados: Array<{ bloque: string; motivo: string }>;
  modelo: string | null;
  created_at: string;
}
interface EstadoMga { ultima_ok: ConsolidacionMga | null; ultimo_intento: ConsolidacionMga | null; desactualizada: boolean }

const BLOQUES_MGA: Array<[string, string]> = [
  ['identificacion_problema', 'Identificación del Problema'],
  ['poblacion_beneficiaria', 'Población Beneficiaria'],
  ['justificacion_tecnica', 'Justificación Técnica'],
  ['analisis_riesgos', 'Análisis de Riesgos'],
];
const MOTIVOS_NO_DISPONIBLE: Record<string, string> = {
  sin_llave_nvidia: 'el servidor no tiene configurada la llave de NVIDIA (NVIDIA_API_KEY)',
  llave_rechazada: 'NVIDIA rechazó la llave del servidor',
  cuota_nvidia: 'se agotó la cuota de NVIDIA',
  modelo_saturado: 'el modelo está saturado; intenta en unos minutos',
  respuesta_truncada: 'la respuesta del modelo llegó cortada',
  respuesta_vacia: 'el modelo no devolvió contenido',
  respuesta_invalida: 'el modelo no devolvió el formato esperado',
  sin_contenido_verificable: 'ningún párrafo pasó la verificación de fuentes y cifras',
};
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', hourCycle: 'h23' });

function BloquesMga({ consolidacion }: { consolidacion: ConsolidacionMga }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: T.textMuted, margin: 0 }}>
        Generada {fechaHora(consolidacion.created_at)}{consolidacion.modelo ? ` · ${consolidacion.modelo}` : ''}
        {consolidacion.descartados.length > 0 && ` · ${consolidacion.descartados.length} párrafo(s) descartado(s) por no poder verificarse`}
      </p>
      {BLOQUES_MGA.map(([clave, titulo]) => {
        const parrafos = consolidacion.bloques?.[clave]?.parrafos ?? [];
        return (
          <div key={clave} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: T.text, margin: 0 }}>{titulo}</h3>
            {parrafos.length ? parrafos.map((p) => (
              <div key={`${clave}:${p.texto}`}>
                <p style={{ fontSize: 12.5, color: T.text, margin: 0 }}>{p.texto}</p>
                <p style={{ fontSize: 12, color: T.textMuted, margin: 0 }}>Fuentes: {p.fuentes.join(', ')}</p>
              </div>
            )) : (
              <p style={{ fontSize: 12, color: T.textMuted, margin: 0 }}>Sin contenido verificable en las fuentes.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FormuladorMgaPanel({ proyectoId }: { proyectoId: string }) {
  const [estado, setEstado] = useState<EstadoMga | null>(null);
  const [consolidando, setConsolidando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El estado de React no se actualiza entre dos clics del mismo tick: un ref sí.
  // Sin esto, un doble clic enviaba 2 POST = 2 consultas cobradas a NVIDIA.
  const enCursoRef = useRef(false);

  const cargar = useCallback(async () => {
    try {
      const r = await http.get<{ data: EstadoMga }>(`/api/proyectos/${proyectoId}/formulador-mga`);
      setEstado(r.data);
    } catch { /* sin consolidaciones previas o sin conexión: el botón sigue disponible */ }
  }, [proyectoId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const consolidar = async () => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    setConsolidando(true);
    setError(null);
    try {
      await http.post(`/api/proyectos/${proyectoId}/formulador-mga`, {});
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo consolidar la redacción MGA.');
    } finally {
      enCursoRef.current = false;
      setConsolidando(false);
    }
  };

  const ok = estado?.ultima_ok;
  const intento = estado?.ultimo_intento;
  const intentoFallidoReciente = intento && intento.estado === 'no_disponible' && (!ok || intento.created_at > ok.created_at);

  return (
    <section data-testid="formulador-mga" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 960 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: T.primary, margin: 0 }}>Redacción MGA consolidada (IA)</h2>
      <p style={{ fontSize: 12, color: T.textMuted, margin: 0 }}>
        Ordena en los 4 bloques de la MGA lo que ya generaron Entrada, Viabilidad y el Comité MIROFISH. No redacta desde cero:
        cada párrafo cita sus fuentes y las cifras vienen del cálculo del sistema (Montecarlo y APU). El PDF MGA la incluye.
      </p>
      {error && (
        <div style={{ background: 'rgba(186,26,26,0.08)', border: '1px solid rgba(186,26,26,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: T.error }} role="alert">
          {error}
        </div>
      )}
      {estado?.desactualizada && (
        <div style={{ background: T.primarySoft, borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: T.primary }} role="status">
          Los datos del proyecto cambiaron después de esta consolidación: vuelve a consolidar antes de exportar.
        </div>
      )}
      {intentoFallidoReciente && (
        <p style={{ fontSize: 12, color: T.textMuted, margin: 0 }}>
          Último intento ({fechaHora(intento.created_at)}) no disponible: {MOTIVOS_NO_DISPONIBLE[intento.motivo || ''] || intento.motivo}.
        </p>
      )}
      <div>
        <button
          onClick={consolidar}
          disabled={consolidando}
          style={{
            padding: '10px 18px', background: T.primary, border: 'none', borderRadius: 8,
            color: '#fff', fontWeight: 700, fontSize: 13,
            cursor: consolidando ? 'not-allowed' : 'pointer',
            opacity: consolidando ? 0.6 : 1,
          }}
        >
          {consolidando ? 'Consolidando…' : ok ? 'Volver a consolidar' : 'Consolidar con IA'}
        </button>
      </div>
      {ok?.bloques && <BloquesMga consolidacion={ok} />}
    </section>
  );
}

export default function ExportacionPage() {
  const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
  const [descargandoId, setDescargandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const descargar = async (formato: FormatoExportacion) => {
    if (!proyectoId) return;
    setDescargandoId(formato.id);
    setError(null);
    try {
      const res = await fetch(formato.endpoint(proyectoId), {
        headers: { ...getAuthHeaders() },
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Error al generar ${formato.titulo} (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = formato.archivo(proyectoId);
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : `No se pudo generar ${formato.titulo}.`);
    } finally {
      setDescargandoId(null);
    }
  };

  if (!proyectoId) {
    return (
      <div style={{ padding: 32, fontFamily: T.font, color: T.textMuted }}>
        No hay un proyecto activo — completa el módulo Entrada primero para poder exportar.
      </div>
    );
  }

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: T.font, minHeight: 'calc(100vh - 48px)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Exportación</h1>
      <p style={{ margin: 0, fontSize: 12.5, color: T.textMuted, maxWidth: 680 }}>
        Genera el documento del proyecto a partir de los datos ya capturados en el Formulador. Estos documentos
        siguen la estructura interna del proyecto — no son formularios oficiales descargables de una entidad;
        revísalos contra la plantilla oficial vigente antes de radicar.
      </p>

      {error && (
        <div style={{ background: 'rgba(186,26,26,0.08)', border: '1px solid rgba(186,26,26,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: T.error }} role="alert">
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, maxWidth: 960 }}>
        {FORMATOS.map((formato) => (
          <div key={formato.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: T.primary, margin: 0 }}>{formato.titulo}</h2>
            <p style={{ fontSize: 12, color: T.textMuted, margin: 0, flex: 1 }}>
              {formato.descripcion}
            </p>
            <button
              onClick={() => descargar(formato)}
              disabled={descargandoId !== null}
              style={{
                padding: '10px 18px', background: T.primary, border: 'none', borderRadius: 8,
                color: '#fff', fontWeight: 700, fontSize: 13,
                cursor: descargandoId !== null ? 'not-allowed' : 'pointer',
                opacity: descargandoId !== null ? 0.6 : 1,
              }}
            >
              {descargandoId === formato.id ? 'Generando…' : 'Generar y descargar PDF'}
            </button>
          </div>
        ))}
      </div>

      <FormuladorMgaPanel proyectoId={proyectoId} />
    </div>
  );
}
