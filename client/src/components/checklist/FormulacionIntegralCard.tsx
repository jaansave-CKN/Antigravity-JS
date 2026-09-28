import { T, ORDEN_PASOS_FORMULACION, LABEL_PASO_FORMULACION, type ProgresoFormulacion } from './checklistModulos';
import type { useFormulacionIntegral } from '../../hooks/useFormulacionIntegral';

type Props = ReturnType<typeof useFormulacionIntegral>;

// Barra de los 3 pasos (Entrada → Árbol → Viabilidad).
function PasosFormulacion({ progresoForm, ejecutandoForm }: { progresoForm: ProgresoFormulacion | null; ejecutandoForm: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {ORDEN_PASOS_FORMULACION.map((paso, i) => {
        const est = progresoForm?.pasos[paso]?.estado || 'pendiente';
        const enCurso = ejecutandoForm && progresoForm?.paso_actual === paso && est === 'pendiente';
        const barColor = est === 'completado' ? T.success : est === 'fallido' ? '#ba1a1a' : enCurso ? T.primary : T.border;
        const labelColor = est === 'completado' ? T.success : est === 'fallido' ? '#ba1a1a' : T.textMuted;
        return (
          <div key={paso} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ height: 6, borderRadius: 3, background: barColor, display: 'block' }} />
            <span style={{ fontSize: 10, color: labelColor, fontWeight: 600 }}>
              {i + 1}. {LABEL_PASO_FORMULACION[paso]} {est === 'completado' ? '✓' : est === 'fallido' ? '✗' : enCurso ? '…' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function etiquetaBoton(progresoForm: ProgresoFormulacion | null, ejecutandoForm: boolean): string {
  return progresoForm?.pasos.viabilidad.estado === 'completado'
    ? '✓ Formulación integral completa'
    : ejecutandoForm
      ? `Formulando… (${LABEL_PASO_FORMULACION[progresoForm?.paso_actual || 'entrada']})`
      : progresoForm && Object.values(progresoForm.pasos).some(p => p.estado !== 'pendiente')
        ? 'Reanudar Formulación Integral'
        : 'Iniciar Formulación Integral';
}

// Formulación Integral con IA — cadena Entrada→Árbol→Viabilidad.
export default function FormulacionIntegralCard({
  progresoForm, cargandoEstadoForm, ejecutandoForm, objetivoCentralInput, setObjetivoCentralInput,
  errorForm, ejecutarFormulacionIntegral,
}: Props) {
  const bloqueado = ejecutandoForm || progresoForm?.pasos.viabilidad.estado === 'completado';
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 9999, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: T.primarySoft, border: `1px solid ${T.primaryBorder}`,
          color: T.primary, fontSize: 10, fontWeight: 700, fontFamily: "'Inter', sans-serif",
        }}>IA</span>
        <h2 style={{ margin: 0, fontSize: 18, lineHeight: '26px', fontWeight: 700, color: T.primary, letterSpacing: '0.01em' }}>
          Formulación Integral con IA
        </h2>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: T.textHint }}>
        Encadena automáticamente Contexto/Entrada → Árbol de Objetivos → Viabilidad en un solo clic. Motor Dialéctico, Ficha Técnica y Logística se editan manualmente en sus propios módulos.
      </p>

      {cargandoEstadoForm ? (
        <p style={{ margin: 0, fontSize: 12, color: T.textMuted }}>Cargando estado…</p>
      ) : (
        <>
          <PasosFormulacion progresoForm={progresoForm} ejecutandoForm={ejecutandoForm} />

          {progresoForm?.pasos.arbol.estado !== 'completado' && !progresoForm?.objetivo_central_usado && (
            <input
              type="text"
              value={objetivoCentralInput}
              onChange={e => setObjetivoCentralInput(e.target.value)}
              placeholder="Objetivo Central (requerido para el Árbol de Objetivos)…"
              aria-label="Objetivo Central"
              disabled={ejecutandoForm}
              style={{
                padding: '10px 14px', borderRadius: 8, border: `1px solid ${T.border}`,
                fontSize: 13, fontFamily: T.font, color: T.text, background: T.bg,
              }}
            />
          )}

          <button
            onClick={ejecutarFormulacionIntegral}
            disabled={bloqueado}
            style={{
              alignSelf: 'flex-start', padding: '10px 22px', borderRadius: 8, border: 'none',
              background: T.primary, color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: T.font,
              cursor: bloqueado ? 'not-allowed' : 'pointer',
              opacity: bloqueado ? 0.6 : 1,
            }}
          >
            {etiquetaBoton(progresoForm, ejecutandoForm)}
          </button>

          {errorForm && (
            <p style={{ margin: 0, fontSize: 12, color: '#ba1a1a' }} role="alert">{errorForm}</p>
          )}
        </>
      )}
    </div>
  );
}
