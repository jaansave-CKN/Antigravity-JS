/**
 * ExportacionPage — Reporte Maestro (PDF certificado, SSR)
 *
 * Reconectado 2026-08-06 (Grupo Elite, Operación Sinaosis Fase 2): el endpoint
 * anterior (`/api/proyectos/:id/exportar/:formato`, con 3 botones MGA/BID/OXI)
 * era fantasma — no existe en el backend. El endpoint real y verificado es
 * `GET /api/modulo9/reporte/:proyectoId` (`backend/routes/reporte.routes.js`),
 * que genera UN solo PDF consolidado ("Reporte Maestro") a partir de ficha
 * técnica + presupuesto + sello de cross-check — no hay 3 formatos reales
 * distintos en el backend, así que el UI ya no finge que los hay.
 */
import { useState } from 'react';
import { getAuthHeaders } from '../lib/apiClient';

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

const T = {
  bg: '#f7f9fb', card: '#ffffff', border: '#e0e3e5', text: '#191c1e',
  textMuted: 'rgba(25,28,30,0.55)', primary: '#0058be', primarySoft: 'rgba(0,88,190,0.08)',
  error: '#ba1a1a', font: "'Manrope', sans-serif",
};

export default function ExportacionPage() {
  const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const descargar = async () => {
    if (!proyectoId) return;
    setDescargando(true);
    setError(null);
    try {
      const res = await fetch(`/api/modulo9/reporte/${proyectoId}`, {
        headers: { ...getAuthHeaders() },
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Error al generar el reporte (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `RadarFondos_${proyectoId.slice(0, 8)}_reporte.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el Reporte Maestro.');
    } finally {
      setDescargando(false);
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
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Reporte Maestro</h1>
      <p style={{ margin: 0, fontSize: 12.5, color: T.textMuted, maxWidth: 680 }}>
        Genera el PDF certificado del proyecto (ficha técnica, presupuesto y sello de verificación cruzada) a partir
        de los datos ya capturados en el Formulador. Este documento sigue la estructura interna del proyecto — no es
        un formulario oficial descargable de una entidad (MGA/BID/OXI); revísalo contra la plantilla oficial vigente
        antes de radicar.
      </p>

      {error && (
        <div style={{ background: 'rgba(186,26,26,0.08)', border: '1px solid rgba(186,26,26,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: T.error }} role="alert">
          {error}
        </div>
      )}

      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.primary, margin: 0 }}>Reporte Maestro (PDF)</h2>
        <p style={{ fontSize: 12, color: T.textMuted, margin: 0 }}>
          Ficha técnica + presupuesto + sello de cross-check, generado en el servidor.
        </p>
        <button
          onClick={descargar}
          disabled={descargando}
          style={{
            padding: '10px 18px', background: T.primary, border: 'none', borderRadius: 8,
            color: '#fff', fontWeight: 700, fontSize: 13,
            cursor: descargando ? 'not-allowed' : 'pointer',
            opacity: descargando ? 0.6 : 1,
          }}
        >
          {descargando ? 'Generando…' : 'Generar y descargar PDF'}
        </button>
      </div>
    </div>
  );
}
