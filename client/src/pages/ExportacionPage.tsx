/**
 * ExportacionPage — Fase 5: Exportación a MGA / BID / OXI
 * Descarga PDFs generados server-side a partir de los datos reales del
 * proyecto activo (ficha técnica, árbol de objetivos, indicadores, TdC,
 * presupuesto, logística). Sin fuente Stitch — paleta consistente con el
 * resto del Formulador.
 */
import { useState } from 'react';
import { getAuthHeaders } from '../lib/apiClient';

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

const T = {
  bg: '#f7f9fb', card: '#ffffff', border: '#e0e3e5', text: '#191c1e',
  textMuted: 'rgba(25,28,30,0.55)', primary: '#0058be', primarySoft: 'rgba(0,88,190,0.08)',
  error: '#ba1a1a', font: "'Manrope', sans-serif",
};

interface Formato { key: 'mga' | 'bid' | 'oxi'; label: string; hint: string; }
const FORMATOS: Formato[] = [
  { key: 'mga', label: 'MGA', hint: 'Metodología General Ajustada (DNP Colombia) — 4 módulos: Identificación, Preparación, Evaluación, Programación.' },
  { key: 'bid', label: 'BID', hint: 'Matriz de Marco Lógico 4×4: Fin / Propósito / Componentes / Actividades con indicadores y supuestos.' },
  { key: 'oxi', label: 'OXI', hint: 'Obras por Impuestos (ART/DNP) — resumen MGA + checklist de viabilidad + estructura de costos.' },
];

export default function ExportacionPage() {
  const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
  const [descargando, setDescargando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const descargar = async (formato: Formato) => {
    if (!proyectoId) return;
    setDescargando(formato.key);
    setError(null);
    try {
      const res = await fetch(`/api/proyectos/${proyectoId}/exportar/${formato.key}`, {
        headers: { ...getAuthHeaders() },
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Error al exportar (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${formato.key.toUpperCase()}_${proyectoId}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : `No se pudo exportar a ${formato.label}`);
    } finally {
      setDescargando(null);
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
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Exportación de Proyecto</h1>
      <p style={{ margin: 0, fontSize: 12.5, color: T.textMuted, maxWidth: 680 }}>
        Genera el documento del proyecto según la estructura pública de cada metodología, usando los datos ya
        capturados en el Formulador. Estos documentos siguen la estructura verificada de cada metodología pero
        no son el formulario oficial exacto — revísalos contra la plantilla oficial vigente antes de radicar.
      </p>

      {error && (
        <div style={{ background: 'rgba(186,26,26,0.08)', border: '1px solid rgba(186,26,26,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12.5, color: T.error }} role="alert">
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {FORMATOS.map(f => (
          <div key={f.key} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: T.primary, margin: 0 }}>{f.label}</h2>
            <p style={{ fontSize: 12, color: T.textMuted, margin: 0, flex: 1 }}>{f.hint}</p>
            <button
              onClick={() => descargar(f)}
              disabled={descargando === f.key}
              style={{
                padding: '10px 18px', background: T.primary, border: 'none', borderRadius: 8,
                color: '#fff', fontWeight: 700, fontSize: 13,
                cursor: descargando === f.key ? 'not-allowed' : 'pointer',
                opacity: descargando === f.key ? 0.6 : 1,
              }}
            >
              {descargando === f.key ? 'Generando…' : `Exportar a ${f.label}`}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
