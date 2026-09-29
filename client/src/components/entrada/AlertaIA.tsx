import CountdownReset from '../CountdownReset';

// Aviso de error de IA / cuota agotada (con cuenta regresiva). Dos variantes
// copiadas literal de pages/EntradaPage.tsx: 'linea' (bajo el Nombre) y
// 'bloque' (Contexto del Problema y Soluciones).
export interface AvisoIA {
  errorIA: string | null;
  retryAtIA: string | null;
  esEstimadoIA: boolean;
  mensajeCuota: string;
  onExpire: () => void;
  onReintentar: () => void;
}

export default function AlertaIA({ aviso, variante }: { aviso: AvisoIA; variante: 'linea' | 'bloque' }) {
  const { errorIA, retryAtIA, esEstimadoIA, mensajeCuota, onExpire, onReintentar } = aviso;
  if (!(errorIA || retryAtIA)) return null;
  if (variante === 'linea') {
    return (
      <span role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}>
        {errorIA || mensajeCuota}
        {retryAtIA && <><br /><CountdownReset retryAt={retryAtIA} esEstimado={esEstimadoIA} onExpire={onExpire} onReintentar={onReintentar} /></>}
      </span>
    );
  }
  return (
    <div role="alert" style={{ fontSize: 11, color: '#dc2626', background: '#fef2f2', padding: '6px 10px', borderRadius: 6, marginBottom: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <span>{errorIA || mensajeCuota}</span>
      {retryAtIA && <CountdownReset retryAt={retryAtIA} esEstimado={esEstimadoIA} onExpire={onExpire} onReintentar={onReintentar} />}
    </div>
  );
}
