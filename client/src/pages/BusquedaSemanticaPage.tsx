/**
 * BusquedaSemanticaPage.tsx — Búsqueda Semántica de Convocatorias (Módulo A).
 * Construida desde el Master Prompt 1 de Stitch (autorización OMEGA-7, opción
 * c, 2026-09-29): los tokens del prompt son la fuente CALCO.
 *
 * Datos reales:
 *  - GET  /api/radar/busqueda-semantica/estado → cobertura del catálogo ABIERTO
 *    (sin gastar cuota; si no hay vectores, el buscador queda deshabilitado).
 *  - POST /api/radar/buscar-masivo → pgvector sobre convocatorias abiertas.
 *    Sin reintento automático (un reenvío pagaría dos veces el embedding).
 * Estados: inicial · cargando (skeletons) · sin resultados · catálogo sin
 * indexar · IA no disponible (503) · límite de uso (429). Regla de oro: si el
 * servidor no responde, no se muestra ningún resultado inventado.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../lib/apiClient';
import AvisoApiError from '../components/ui/AvisoApiError';
import BotonFormularConvocatoria from '../components/radar/BotonFormularConvocatoria';
import { formatoMonto } from '../components/radar/formatoMonto';

const C = {
  primario: '#0058be', texto: '#191c1e', secundario: '#45464d', tenue: '#76777d',
  borde: '#c6c6cd', bordeSuave: '#e6e8ea', blanco: '#ffffff', fondo: '#f7f9fb', bloque: '#eceef0',
  exito: '#059669', alerta: '#ca8a04', error: '#ba1a1a', info: '#0284c7',
};
const UI = "'Hanken Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";
const EJEMPLOS = [
  'Acueducto veredal con enfoque de género en el Cauca',
  'Energía solar para escuelas rurales del Pacífico',
  'Fortalecimiento de asociaciones de productores de café',
];

interface Resultado {
  id: string; titulo: string; donante?: string | null; descripcion?: string | null;
  monto_min?: number | null; monto_max?: number | null; moneda?: string | null;
  fecha_limite?: string | null; url_convocatoria?: string | null; similitud: number | string;
}
interface Cobertura { con: number; total: number }

function colorAfinidad(pct: number) {
  if (pct >= 70) return C.exito;
  if (pct >= 50) return C.info;
  return C.secundario;
}

function diasHasta(fecha?: string | null): number | null {
  if (!fecha) return null;
  const t = new Date(String(fecha).slice(0, 10) + 'T23:59:59').getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

function Ilustracion() {
  return (
    <svg width="96" height="72" viewBox="0 0 96 72" fill="none" stroke={C.borde} strokeWidth="2" aria-hidden="true">
      <rect x="6" y="10" width="56" height="44" rx="6" />
      <line x1="16" y1="24" x2="50" y2="24" /><line x1="16" y1="34" x2="44" y2="34" /><line x1="16" y1="44" x2="38" y2="44" />
      <circle cx="66" cy="44" r="14" stroke={C.primario} /><line x1="76" y1="54" x2="88" y2="66" stroke={C.primario} />
    </svg>
  );
}

const barra = (w: string, h = 12) => <span style={{ display: 'block', width: w, height: h, borderRadius: 4, background: C.bloque }} />;

const etiqueta: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.secundario, display: 'flex', flexDirection: 'column', gap: 6 };

function Skeleton() {
  return (
    <div aria-hidden="true" style={{ background: C.blanco, border: `1px solid ${C.bordeSuave}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>{barra('60%', 16)}{barra('56px', 22)}</div>
      {barra('35%')}{barra('90%')}{barra('75%')}
      <div style={{ display: 'flex', gap: 8 }}>{barra('120px', 30)}{barra('170px', 30)}</div>
    </div>
  );
}

function Tarjeta({ r }: { r: Resultado }) {
  const pct = Math.round(Number(r.similitud) * 100);
  const col = colorAfinidad(pct);
  const dias = diasHasta(r.fecha_limite);
  return (
    <article style={{ background: C.blanco, border: `1px solid ${C.bordeSuave}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.texto, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.titulo}</h3>
        <span title="Afinidad semántica con tu consulta" style={{ flexShrink: 0, fontFamily: MONO, fontSize: 13, fontWeight: 700, color: col, background: `${col}14`, border: `1px solid ${col}40`, borderRadius: 9999, padding: '2px 10px' }}>{pct}%</span>
      </div>
      {r.donante && <p style={{ margin: 0, fontSize: 13, color: C.secundario }}>{r.donante}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', fontSize: 13, color: C.secundario }}>
        <span style={{ fontFamily: MONO }}>{formatoMonto(r.monto_min, r.monto_max, r.moneda)}</span>
        <span style={{ fontFamily: MONO }}>{r.fecha_limite ? `Cierra ${String(r.fecha_limite).slice(0, 10)}` : 'Sin fecha de cierre'}</span>
        {dias !== null && dias >= 0 && dias < 15 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: C.alerta, background: 'rgba(202,138,4,0.10)', border: '1px solid rgba(202,138,4,0.30)', borderRadius: 9999, padding: '2px 8px' }}>
            {dias === 0 ? 'Cierra hoy' : `Cierra en ${dias} día${dias === 1 ? '' : 's'}`}
          </span>
        )}
      </div>
      {r.descripcion && <p style={{ margin: 0, fontSize: 13, color: C.secundario, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.descripcion}</p>}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        {r.url_convocatoria && (
          <a href={r.url_convocatoria} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: C.primario }}>Ver convocatoria original</a>
        )}
        <BotonFormularConvocatoria conv={r} variante="texto" />
      </div>
    </article>
  );
}

export default function BusquedaSemanticaPage() {
  const [cobertura, setCobertura] = useState<Cobertura | null>(null);
  const [errorEstado, setErrorEstado] = useState<unknown>(null);
  const [texto, setTexto] = useState('');
  const [limite, setLimite] = useState(25);
  const [afinidad, setAfinidad] = useState(25);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const enVueloRef = useRef(false);

  useEffect(() => {
    let vivo = true;
    http.get<{ success: boolean; data: { cobertura: Cobertura } }>('/api/radar/busqueda-semantica/estado')
      .then(r => { if (vivo) setCobertura(r.data.cobertura); })
      .catch(e => { if (vivo) setErrorEstado(e); });
    return () => { vivo = false; };
  }, []);

  const catalogoSinIndexar = cobertura !== null && cobertura.con === 0;

  const buscar = useCallback(async (consulta: string) => {
    const q = consulta.trim();
    if (!q || enVueloRef.current) return;
    enVueloRef.current = true;
    setBuscando(true);
    setError(null);
    setResultados(null);
    try {
      const r = await http.post<{ success: boolean; resultados: Resultado[]; cobertura?: Cobertura }>(
        '/api/radar/buscar-masivo', { texto: q, limit: limite, threshold: afinidad / 100 }, undefined, { retries: 0 },
      );
      setResultados(r.resultados || []);
      if (r.cobertura) setCobertura(r.cobertura);
    } catch (e) {
      setError(e);
    } finally {
      enVueloRef.current = false;
      setBuscando(false);
    }
  }, [limite, afinidad]);

  return (
    <div style={{ minHeight: 'calc(100vh - 48px)', background: C.fondo, color: C.texto, fontFamily: UI, padding: '32px 24px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em' }}>Búsqueda Semántica</h1>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: C.secundario }}>Describe tu proyecto con tus palabras y encuentra las convocatorias abiertas más afines.</p>
          </div>
          {cobertura && (
            <span data-testid="cobertura" style={{ fontSize: 12, color: C.secundario, background: C.blanco, border: `1px solid ${C.bordeSuave}`, borderRadius: 9999, padding: '4px 12px' }}>
              <span style={{ fontFamily: MONO, fontWeight: 700, color: C.texto }}>{cobertura.con}</span> de{' '}
              <span style={{ fontFamily: MONO, fontWeight: 700, color: C.texto }}>{cobertura.total}</span> convocatorias abiertas indexadas
            </span>
          )}
        </header>

        {errorEstado != null && <AvisoApiError error={errorEstado} />}
        {catalogoSinIndexar && (
          <div role="status" style={{ background: 'rgba(2,132,199,0.07)', border: '1px solid rgba(2,132,199,0.25)', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.info }}>El catálogo se está indexando.</p>
            <p style={{ margin: 0, fontSize: 13, color: C.secundario }}>La búsqueda semántica estará disponible pronto; mientras tanto usa los filtros del Radar.</p>
            <Link to="/radar" style={{ alignSelf: 'flex-start', fontSize: 13, fontWeight: 600, color: C.primario }}>Ir al Radar</Link>
          </div>
        )}

        <section aria-label="Consulta" style={{ background: C.blanco, border: `1px solid ${C.bordeSuave}`, borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label htmlFor="busq-texto" style={{ fontSize: 13, fontWeight: 700 }}>¿Qué proyecto quieres financiar?</label>
          <textarea
            id="busq-texto"
            rows={3}
            value={texto}
            onChange={e => setTexto(e.target.value)}
            placeholder="Ej.: acueducto veredal con enfoque de género en el Cauca…"
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '10px 12px', fontSize: 14, fontFamily: UI, color: C.texto, background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 8, outlineColor: C.primario }}
          />
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={etiqueta}>
              Resultados
              <select value={limite} onChange={e => setLimite(Number(e.target.value))} style={{ height: 34, padding: '0 8px', borderRadius: 8, border: `1px solid ${C.borde}`, fontFamily: UI, fontSize: 13, background: C.blanco }}>
                {[10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label style={{ ...etiqueta, minWidth: 220 }}>
              <span>Afinidad mínima <span style={{ fontFamily: MONO, color: C.texto }}>{afinidad}%</span></span>
              <input type="range" min={25} max={90} step={5} value={afinidad} onChange={e => setAfinidad(Number(e.target.value))} aria-label="Afinidad mínima" style={{ accentColor: C.primario }} />
            </label>
            <button
              type="button"
              onClick={() => buscar(texto)}
              disabled={buscando || !texto.trim() || catalogoSinIndexar}
              style={{ marginLeft: 'auto', height: 40, padding: '0 20px', borderRadius: 8, border: 'none', background: C.primario, color: C.blanco, fontSize: 14, fontWeight: 700, fontFamily: UI, cursor: buscando || !texto.trim() || catalogoSinIndexar ? 'not-allowed' : 'pointer', opacity: buscando || !texto.trim() || catalogoSinIndexar ? 0.6 : 1 }}
            >
              {buscando ? 'Buscando…' : 'Buscar convocatorias'}
            </button>
          </div>
        </section>

        {error != null && <AvisoApiError error={error} onReintentar={() => buscar(texto)} />}

        {buscando && (
          <div aria-busy="true" aria-label="Buscando convocatorias" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1, 2, 3].map(i => <Skeleton key={i} />)}
          </div>
        )}

        {!buscando && error == null && resultados === null && !catalogoSinIndexar && (
          <section aria-label="Cómo empezar" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0', textAlign: 'center' }}>
            <Ilustracion />
            <p style={{ margin: 0, fontSize: 14, color: C.secundario, maxWidth: 520 }}>Escribe el problema, la población y el territorio de tu proyecto. Buscaremos por significado, no solo por palabras exactas.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {EJEMPLOS.map(ej => (
                <button key={ej} type="button" onClick={() => { setTexto(ej); buscar(ej); }} style={{ fontSize: 13, color: C.primario, background: C.blanco, border: `1px solid ${C.borde}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: UI }}>
                  {ej}
                </button>
              ))}
            </div>
          </section>
        )}

        {!buscando && resultados !== null && resultados.length === 0 && (
          <div role="status" style={{ background: C.blanco, border: `1px solid ${C.bordeSuave}`, borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Ninguna convocatoria abierta supera la afinidad mínima.</p>
            <p style={{ margin: 0, fontSize: 13, color: C.secundario }}>Prueba bajar la afinidad mínima o describir el proyecto con otras palabras.</p>
          </div>
        )}

        {!buscando && resultados !== null && resultados.length > 0 && (
          <section aria-label="Resultados" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
              {resultados.length} {resultados.length === 1 ? 'convocatoria afín' : 'convocatorias afines'}{' '}
              <span style={{ fontSize: 12, fontWeight: 400, color: C.tenue }}>· ordenadas por afinidad semántica</span>
            </p>
            {resultados.map(r => <Tarjeta key={r.id} r={r} />)}
          </section>
        )}
      </div>
    </div>
  );
}
