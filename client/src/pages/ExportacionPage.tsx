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
import { useState } from 'react';
import { getAuthHeaders } from '../lib/apiClient';

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
    </div>
  );
}
