import { T, type RadicarResponse } from './checklistModulos';

// Panel de radicación — copiado tal cual de ChecklistPage. Hoy no se alcanza
// en la práctica: Ficha/Árbol/Exportación/Compliance siempre dan percent 0,
// así que progress === 100 no ocurre (no se "arregla" en un refactor puro).
export function RadicarPanel({ proyectoId, radicando, radicarError, onRadicar }: {
  proyectoId: string | null; radicando: boolean; radicarError: string | null; onRadicar: () => void;
}) {
  return (
    <div style={{ background: T.successSoft, border: `1px solid ${T.successBorder}`, borderRadius: 12, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13, color: T.success, fontWeight: 700, letterSpacing: '0.02em', textAlign: 'center' }}>
        ✓ Proyecto completo en todos los módulos
      </p>
      {!proyectoId ? (
        <p style={{ margin: 0, fontSize: 12, color: T.textMuted, textAlign: 'center' }}>
          No hay un proyecto activo — selecciona uno en Entrada para poder radicarlo.
        </p>
      ) : (
        <>
          <button
            onClick={onRadicar}
            disabled={radicando}
            style={{
              alignSelf: 'center', padding: '10px 24px', borderRadius: 8, border: 'none',
              background: T.success, color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: T.font,
              cursor: radicando ? 'not-allowed' : 'pointer', opacity: radicando ? 0.6 : 1,
            }}
          >
            {radicando ? 'Radicando… (verificando Cross-Check)' : 'Radicar Proyecto'}
          </button>
          {radicarError && (
            <p style={{ margin: 0, fontSize: 12, color: '#ba1a1a', textAlign: 'center', maxWidth: 480, alignSelf: 'center' }} role="alert">
              {radicarError}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// Sello de radicación emitido.
export function RadicadoSello({ radicarOk }: { radicarOk: RadicarResponse }) {
  return (
    <div style={{ background: T.successSoft, border: `1px solid ${T.successBorder}`, borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 14, color: T.success, fontWeight: 800, letterSpacing: '0.02em' }}>
        ✓ Proyecto radicado — sello de auditoría Cross-Check emitido
      </p>
      <p style={{ margin: 0, fontSize: 11.5, color: T.textMuted, fontFamily: "'Inter', sans-serif" }}>
        Sello: <code>{radicarOk.sello.auditId}</code> · Emitido: {new Date(radicarOk.sello.pasado_en).toLocaleString('es-CO')}
      </p>
    </div>
  );
}
