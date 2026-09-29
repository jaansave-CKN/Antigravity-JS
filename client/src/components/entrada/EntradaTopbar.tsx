// Topbar de EntradaPage + alerta de sincronización con el servidor.
// JSX copiado literal de pages/EntradaPage.tsx (refactor 2026-09-28).
interface Props {
  limpiado: boolean;
  sinGuardar: boolean;
  guardando: boolean;
  errorEntradaCompleta: string | null;
  onLimpiar: () => void;
  onGuardar: () => void;
}

export default function EntradaTopbar({ limpiado, sinGuardar, guardando, errorEntradaCompleta, onLimpiar, onGuardar }: Props) {
  return (
    <>
      <header className="entr__topbar">
        <h1 className="entr__h1">Datos de Entrada</h1>
        <div className="entr__topbar-right">
          <button
            className={`entr__clear${limpiado ? ' entr__clear--done' : ''}`}
            onClick={onLimpiar}
          >
            {limpiado ? '✓ LIMPIADO' : 'LIMPIAR'}
          </button>
          <button
            className={`entr__save${sinGuardar ? ' entr__save--dirty' : ' entr__save--saved'}`}
            onClick={onGuardar}
            disabled={guardando}
            style={{ opacity: guardando ? 0.6 : 1, cursor: guardando ? 'not-allowed' : 'pointer' }}
            title={sinGuardar ? 'Hay cambios sin guardar' : undefined}
          >
            {guardando ? 'Guardando…' : sinGuardar ? 'SAVE' : '✓ GUARDADO'}
          </button>
        </div>
      </header>
      {errorEntradaCompleta && (
        <div role="alert" style={{ fontSize: 11, color: '#dc2626', padding: '4px 24px' }}>{errorEntradaCompleta}</div>
      )}
    </>
  );
}
