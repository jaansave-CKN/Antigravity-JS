/**
 * BunkerApisPanel.tsx — diagnóstico de proveedores de IA dentro del "Búnker de
 * Conexiones" de PanelPage (decisión del dueño 2026-09-28; dictamen architect
 * APROBADO CON CAMBIOS).
 *
 * - SOLO admin, en dos capas: el cliente no consulta nada si !isAdmin, y el
 *   servidor valida de verdad (authenticateToken + requireAdmin). Cualquier
 *   respuesta distinta de 200 → no se renderiza nada: cero cambio visual para
 *   el resto de usuarios.
 * - Nunca recibe ni muestra llaves: solo estados.
 * - Toggles SOLO con bandera real de servidor (flagDisponible): OpenRouter
 *   (sale de la cascada de llmProveedor.js) y NVIDIA (nimCliente.js). Sin
 *   actualización optimista: el interruptor refleja lo que el servidor confirmó.
 * - Estilos: toggle copiado del "Motor Gemini" de PanelPage; cada bloque usa
 *   los valores del nodo Stitch status_indicator_box (padding 12px, radius
 *   8px, fondo #F0FDF4 → rgba(82,232,124,0.10) según el mapa de PanelPage).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { http } from '../../lib/apiClient';
import { useAuth } from '../../contexts/AuthContextNew';

// Subconjunto del mapa T de PanelPage.tsx (mismos valores).
const T = {
  outline:     '#3e484f',
  surfaceHigh: '#222a3e',
  textMuted:   '#bdc8d1',
  textDim:     '#87929a',
  tertiary:    '#52e87c',
  tertiaryCont:'#2ccb63',
} as const;
// Colores ya usados en PanelPage.tsx (QuotaTelemetry, modo Respaldo).
const NARANJA = '#fb923c';
const FONDO_OK = 'rgba(82,232,124,0.10)';
const FONDO_ALERTA = 'rgba(251,146,60,0.10)';

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6, letterSpacing: '0.02em',
};

type ProveedorFlag = 'openrouter' | 'nvidia';
interface EstadoProveedor {
  configurada?: boolean; habilitada?: boolean; flagDisponible?: boolean; integrado?: boolean;
  estado: string; saldoUsd?: number; cobertura?: { con: number; total: number };
}
type ApisEstado = Record<'openrouter' | 'tavily' | 'nvidia' | 'embeddings', EstadoProveedor>;

const BLOQUES: { id: keyof ApisEstado; nombre: string; uso: string; funcion: string; alApagar?: string }[] = [
  { id: 'openrouter', nombre: 'OpenRouter (Claude Sonnet 5 / Principal)', uso: 'Módulo B — Formulador, Copiloto, Viabilidad, Árbol de Objetivos',
    funcion: 'Motor principal de razonamiento jurídico y estructuración MGA.', alApagar: 'Apagado: la IA del Formulador usa el pool Gemini del servidor.' },
  { id: 'tavily', nombre: 'Tavily Search (Rastreo)', uso: 'Módulo A — Agente M1, Scraper de Convocatorias',
    funcion: 'Búsqueda y extracción en tiempo real en portales .gov.co.' },
  { id: 'nvidia', nombre: 'NVIDIA NIM (DeepSeek Flash)', uso: 'Módulo B — Agente Estructurador MGA',
    funcion: 'Procesamiento masivo de la Metodología General Ajustada.', alApagar: 'Apagado: el Formulador MGA responde "no disponible" (sin respaldo).' },
  { id: 'embeddings', nombre: 'Motor de Embeddings (Vectorización)', uso: 'Módulos A y B — Búsqueda Semántica, Barrido de Proyectos',
    funcion: 'Conversión matemática para el catálogo de convocatorias (usa las llaves Gemini del servidor).' },
];

const usd = (n: number) => `USD ${n.toFixed(2)}`;

function textoEstado(p: EstadoProveedor): { texto: string; ok: boolean | null } {
  if (p.integrado === false) return { texto: 'No integrado', ok: null };
  if (p.habilitada === false) return { texto: 'Deshabilitado por admin', ok: null };
  switch (p.estado) {
    case 'activo':
      if (p.cobertura) return { texto: `Activo · ${p.cobertura.con}/${p.cobertura.total}`, ok: true };
      return { texto: p.saldoUsd !== undefined ? `Configurada en servidor · ${usd(p.saldoUsd)}` : 'Configurada en servidor', ok: true };
    case 'configurada_no_verificada': return { texto: 'Configurada en servidor (sin verificación)', ok: true };
    case 'sin_saldo': return { texto: p.saldoUsd !== undefined ? `Sin saldo · ${usd(p.saldoUsd)}` : 'Sin saldo', ok: false };
    case 'sin_tope': return { texto: 'Sin tope de gasto configurado', ok: false };
    case 'pausado': return { texto: 'Pausado tras rechazo del proveedor', ok: false };
    case 'llave_rechazada': return { texto: 'Llave rechazada', ok: false };
    case 'faltante': return { texto: 'Faltante', ok: false };
    case 'sin_vectores': return { texto: p.cobertura ? `Sin vectores · ${p.cobertura.con}/${p.cobertura.total}` : 'Sin vectores', ok: false };
    case 'no_verificable_bd_degradada': return { texto: 'No verificable (BD degradada)', ok: false };
    case 'saldo_no_verificable': return { texto: 'Saldo no verificable', ok: false };
    default: return { texto: 'Sin verificar', ok: false };
  }
}

export default function BunkerApisPanel() {
  const { isAdmin } = useAuth();
  const [estado, setEstado] = useState<ApisEstado | null>(null);
  const [guardando, setGuardando] = useState<ProveedorFlag | null>(null);
  const [error, setError] = useState('');
  const guardandoRef = useRef(false);

  const cargar = useCallback(async () => {
    try {
      const r = await http.get<{ success: boolean; data: ApisEstado }>('/api/admin/apis-estado');
      setEstado(r.data);
    } catch {
      setEstado(null);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void cargar();
    else setEstado(null);
  }, [isAdmin, cargar]);

  async function alternar(proveedor: ProveedorFlag, habilitado: boolean) {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(proveedor);
    setError('');
    try {
      await http.put('/api/admin/apis-flags', { proveedor, habilitado });
      await cargar();
    } catch {
      setError('No se pudo cambiar el interruptor en el servidor; no se cambió nada.');
    } finally {
      guardandoRef.current = false;
      setGuardando(null);
    }
  }

  if (!isAdmin || !estado) return null;

  return (
    <div style={{ borderTop: `1px solid ${T.outline}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ fontSize: 9, fontWeight: 700, color: T.textDim, letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0 }}>
        🔒 Proveedores de IA — Diagnóstico en servidor (solo admin)
      </p>
      {BLOQUES.map(b => {
        const p = estado[b.id];
        if (!p) return null;
        const { texto, ok } = textoEstado(p);
        const color = ok === true ? T.tertiary : ok === false ? NARANJA : T.textDim;
        const fondo = ok === true ? FONDO_OK : ok === false ? FONDO_ALERTA : T.surfaceHigh;
        const conFlag = !!p.flagDisponible && (b.id === 'openrouter' || b.id === 'nvidia');
        const activo = p.habilitada !== false;
        const idToggle = `panel-toggle-${b.id}`;
        return (
          <div key={b.id} style={{ background: fondo, padding: '12px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {conFlag && (
                  <button
                    id={idToggle}
                    type="button" role="switch" aria-checked={activo}
                    disabled={guardando !== null}
                    onClick={() => alternar(b.id as ProveedorFlag, !activo)}
                    style={{
                      width: 36, height: 20, borderRadius: 9999, padding: 0, border: 'none',
                      background: activo ? T.tertiaryCont : T.surfaceHigh,
                      cursor: guardando !== null ? 'not-allowed' : 'pointer', position: 'relative', flexShrink: 0,
                      transition: 'background 0.2s', boxShadow: activo ? `0 0 6px ${T.tertiaryCont}88` : 'none',
                      opacity: guardando === b.id ? 0.6 : 1,
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 2, left: activo ? 18 : 2,
                      width: 16, height: 16, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                    }} />
                  </button>
                )}
                {conFlag
                  ? <label htmlFor={idToggle} style={{ ...labelStyle, margin: 0, color: activo ? T.textMuted : T.textDim }}>{b.nombre}</label>
                  : <span style={{ ...labelStyle, margin: 0, color: T.textMuted }}>{b.nombre}</span>}
              </div>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 600, color, whiteSpace: 'nowrap' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                {texto}
              </span>
            </div>
            <p style={{ fontSize: 10, color: T.textDim, margin: 0, lineHeight: 1.5 }}>
              {b.funcion} Uso: {b.uso}.{conFlag && !activo && b.alApagar ? ` ${b.alApagar}` : ''}
            </p>
          </div>
        );
      })}
      {error && <p role="alert" style={{ fontSize: 10, color: NARANJA, margin: 0 }}>{error}</p>}
    </div>
  );
}
