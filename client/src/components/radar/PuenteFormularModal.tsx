/**
 * PuenteFormularModal.tsx — Puente Radar → Formulador (Master Prompt 2 de
 * Stitch, autorización OMEGA-7 opción c, 2026-09-29; dictamen architect
 * C8-C11). POST /api/bridge/transfer → Gerente de Proyecto (relee la
 * convocatoria del CATÁLOGO, crea el proyecto y responde redirect_to).
 *
 * - Sin reintento automático (retries: 0) + guarda de reentrada: cada POST
 *   crea un proyecto nuevo, un reenvío duplicaría.
 * - Stepper honesto: "Validando acceso" y "Creando proyecto" ocurren dentro
 *   del MISMO request, así que se muestran "en curso" mientras dura (no se
 *   simulan tiempos); "Abriendo Check-List" es la redirección real de 2 s.
 * - Tras el éxito guarda el proyecto activo y su nombre (los del servidor) y
 *   avisa con StorageEvent, igual que ProyectoSelectorModal.
 */
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { http, ApiError } from '../../lib/apiClient';
import AvisoApiError from '../ui/AvisoApiError';
import { formatoMonto } from './formatoMonto';

export interface ConvocatoriaPuente {
  id: string | number;
  titulo: string;
  donante?: string | null;
  descripcion?: string | null;
  monto_min?: number | null;
  monto_max?: number | null;
  moneda?: string | null;
  fecha_limite?: string | null;
}

const C = {
  primario: '#0058be', texto: '#191c1e', secundario: '#45464d', tenue: '#76777d',
  borde: '#c6c6cd', bordeSuave: '#e6e8ea', blanco: '#ffffff', fondo: '#f7f9fb',
  exito: '#059669', error: '#ba1a1a',
};
const UI = "'Hanken Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

type Fase = 'confirmar' | 'en_curso' | 'exito' | 'error';
type EstadoPaso = 'pendiente' | 'en_curso' | 'hecho' | 'fallido';
interface Exito { proyecto_id: string; nombre: string; redirect_to: string }

const PASOS = ['Validando acceso', 'Creando proyecto', 'Abriendo Check-List'];

function Stepper({ estados }: { estados: EstadoPaso[] }) {
  return (
    <ol aria-label="Progreso de la formulación" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 8 }}>
      {PASOS.map((p, i) => {
        const e = estados[i];
        const color = e === 'hecho' ? C.exito : e === 'fallido' ? C.error : e === 'en_curso' ? C.primario : C.bordeSuave;
        return (
          <li key={p} aria-current={e === 'en_curso' ? 'step' : undefined} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ height: 4, borderRadius: 2, background: color, display: 'block' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: e === 'pendiente' ? C.tenue : color, fontFamily: UI }}>
              {e === 'hecho' ? '✓ ' : e === 'fallido' ? '✗ ' : ''}{p}{e === 'en_curso' ? '…' : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

interface Props { conv: ConvocatoriaPuente; onCerrar: () => void }

export default function PuenteFormularModal({ conv, onCerrar }: Props) {
  const navigate = useNavigate();
  const [fase, setFase] = useState<Fase>('confirmar');
  const [error, setError] = useState<unknown>(null);
  const [exito, setExito] = useState<Exito | null>(null);
  const [verMas, setVerMas] = useState(false);
  const enVueloRef = useRef(false);
  const titulo = String(conv.titulo || '');
  const nombreProyecto = `Formulación: ${titulo.slice(0, 80)}`;

  const cerrar = useCallback(() => { if (!enVueloRef.current) onCerrar(); }, [onCerrar]);

  // Escape cierra; useEffectEvent lee siempre el cerrar vigente sin
  // re-suscribir el listener en cada render.
  const alTeclear = useEffectEvent((e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => alTeclear(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const irAlDestino = useCallback((d: Exito) => {
    onCerrar();
    navigate(d.redirect_to || '/checklist');
  }, [navigate, onCerrar]);

  // Redirección real de 2 s tras el éxito; el temporizador no se reinicia si
  // cambia la identidad de onCerrar/navigate.
  const alCumplirse = useEffectEvent((d: Exito) => irAlDestino(d));
  useEffect(() => {
    if (fase !== 'exito' || !exito) return undefined;
    const id = setTimeout(() => alCumplirse(exito), 2000);
    return () => clearTimeout(id);
  }, [fase, exito]);

  async function crear() {
    if (enVueloRef.current) return;
    enVueloRef.current = true;
    setFase('en_curso');
    setError(null);
    try {
      const r = await http.post<{ success: boolean; data: Exito }>(
        '/api/bridge/transfer', { convocatoria_id: String(conv.id) }, undefined, { retries: 0 },
      );
      const d = r.data;
      localStorage.setItem('rf360_proyecto_activo', d.proyecto_id);
      if (d.nombre) localStorage.setItem('rf360_proyecto_nombre', d.nombre);
      window.dispatchEvent(new StorageEvent('storage', { key: 'rf360_proyecto_activo' }));
      setExito(d);
      setFase('exito');
    } catch (e) {
      setError(e);
      setFase('error');
    } finally {
      enVueloRef.current = false;
    }
  }

  const code = error instanceof ApiError ? error.code : undefined;
  const status = error instanceof ApiError ? error.status : undefined;
  const esRed = fase === 'error' && !(error instanceof ApiError);
  const estados: EstadoPaso[] =
    fase === 'en_curso' ? ['en_curso', 'en_curso', 'pendiente']
    : fase === 'exito' ? ['hecho', 'hecho', 'en_curso']
    : fase === 'error' ? (status === 403 ? ['fallido', 'pendiente', 'pendiente'] : status === 404 ? ['hecho', 'fallido', 'pendiente'] : ['fallido', 'fallido', 'pendiente'])
    : ['pendiente', 'pendiente', 'pendiente'];

  const boton = (primario: boolean): React.CSSProperties => ({
    height: 40, padding: '0 18px', borderRadius: 8, fontSize: 14, fontWeight: 700, fontFamily: UI, cursor: 'pointer',
    background: primario ? C.primario : C.blanco, color: primario ? C.blanco : C.texto,
    border: primario ? 'none' : `1px solid ${C.borde}`,
  });

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 2500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      role="presentation"
      onClick={cerrar}
    >
      <div
        role="dialog" aria-modal="true" aria-labelledby="puente-titulo"
        onClick={e => e.stopPropagation()}
        style={{ background: C.blanco, borderRadius: 12, width: 560, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16, fontFamily: UI, color: C.texto }}
      >
        <h2 id="puente-titulo" style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Iniciar formulación</h2>

        {fase === 'confirmar' && (
          <>
            <section style={{ background: C.fondo, border: `1px solid ${C.bordeSuave}`, borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.tenue }}>Contexto que se trasladará</p>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{titulo}</p>
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 4, fontSize: 13 }}>
                <dt style={{ color: C.secundario }}>Donante</dt><dd style={{ margin: 0 }}>{conv.donante || '—'}</dd>
                <dt style={{ color: C.secundario }}>Monto</dt><dd style={{ margin: 0, fontFamily: MONO }}>{formatoMonto(conv.monto_min, conv.monto_max, conv.moneda)}</dd>
                <dt style={{ color: C.secundario }}>Fecha límite</dt><dd style={{ margin: 0, fontFamily: MONO }}>{conv.fecha_limite ? String(conv.fecha_limite).slice(0, 10) : 'Sin fecha de cierre'}</dd>
              </dl>
              {conv.descripcion && (
                <div>
                  <p style={{ margin: 0, fontSize: 13, color: C.secundario, lineHeight: 1.5, ...(verMas ? {} : { display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}>
                    {conv.descripcion}
                  </p>
                  <button type="button" onClick={() => setVerMas(v => !v)} style={{ background: 'none', border: 'none', padding: 0, marginTop: 4, color: C.primario, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: UI }}>
                    {verMas ? 'Ver menos' : 'Ver más'}
                  </button>
                </div>
              )}
              <p style={{ margin: 0, fontSize: 12, color: C.tenue }}>Los datos se toman del catálogo oficial del Radar, no se pueden editar aquí.</p>
            </section>
            <p style={{ margin: 0, fontSize: 13, color: C.secundario }}>
              Proyecto que se creará: <strong style={{ color: C.texto }}>{nombreProyecto}</strong>
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={cerrar} style={boton(false)}>Cancelar</button>
              <button type="button" onClick={crear} style={boton(true)}>Crear proyecto y continuar</button>
            </div>
          </>
        )}

        {fase !== 'confirmar' && <Stepper estados={estados} />}

        {fase === 'en_curso' && (
          <p role="status" style={{ margin: 0, fontSize: 13, color: C.secundario }}>Validando tu acceso y creando el proyecto en el servidor…</p>
        )}

        {fase === 'exito' && exito && (
          <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.exito }}>✓ Proyecto creado</p>
            <p style={{ margin: 0, fontSize: 14 }}>{exito.nombre}</p>
            <p style={{ margin: 0, fontSize: 13, color: C.secundario }}>
              Te llevamos a tu Check-List…{' '}
              <button type="button" onClick={() => irAlDestino(exito)} style={{ background: 'none', border: 'none', padding: 0, color: C.primario, fontWeight: 700, cursor: 'pointer', fontFamily: UI, fontSize: 13 }}>Ir ahora</button>
            </p>
          </div>
        )}

        {fase === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {code === 'NO_ACCESS_FORMULADOR' ? (
              <AvisoApiError error={error} />
            ) : status === 404 ? (
              <AvisoApiError error={new ApiError('Esta convocatoria ya no está en el catálogo (pudo cerrarse o retirarse).', 404, 'CONVOCATORIA_NO_ENCONTRADA')} />
            ) : esRed ? (
              <AvisoApiError
                error={error}
                onReintentar={crear}
                textoReintentar="Reintentar (revisa antes tus proyectos: pudo haberse creado)"
              />
            ) : (
              <AvisoApiError error={error} onReintentar={status === 503 || status === 429 ? undefined : crear} />
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={cerrar} style={boton(false)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
