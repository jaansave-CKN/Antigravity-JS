import { useState, useEffect, useRef } from 'react';
import './ViabilidadPage.css';
import { ejecutarFormulador, estadoVacio, type AnalisisViabilidad, type EstadoFormulador } from '../agents/000_formulador';
import { runViabilidadIA, type ViabilidadIAResultado } from '../agents/NN_Viability_Agent';

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

const DICTAMEN_COLOR: Record<ViabilidadIAResultado['estado_auditoria'], string> = {
  APROBADO_TECNICAMENTE: '#15803d', OBSERVACION_CRITICA: '#b45309', RECHAZADO_INCOHERENCIA: '#ba1a1a',
};
const DICTAMEN_LABEL: Record<ViabilidadIAResultado['estado_auditoria'], string> = {
  APROBADO_TECNICAMENTE: 'APROBADO TÉCNICAMENTE', OBSERVACION_CRITICA: 'OBSERVACIÓN CRÍTICA', RECHAZADO_INCOHERENCIA: 'RECHAZADO POR INCOHERENCIA',
};

// ── Dictamen real de IA sobre el proyecto (Gemini o heurística de respaldo) ──
function DictamenIACard() {
  const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
  const [resultado, setResultado] = useState<ViabilidadIAResultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evaluar = async () => {
    if (!proyectoId) return;
    setCargando(true);
    setError(null);
    try {
      const r = await runViabilidadIA(proyectoId);
      setResultado(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo calcular la viabilidad con IA');
    } finally {
      setCargando(false);
    }
  };

  if (!proyectoId) {
    return (
      <div className="viab__card" style={{ gridColumn: '1 / -1' }}>
        <div className="viab__card-header">
          <span className="material-symbols-outlined">smart_toy</span>
          Dictamen de Viabilidad IA (Gemini)
        </div>
        <div className="viab__card-body" style={{ fontSize: 12.5, color: '#76777d' }}>
          No hay un proyecto activo — completa Entrada primero para poder generar el dictamen de IA.
        </div>
      </div>
    );
  }

  return (
    <div className="viab__card" style={{ gridColumn: '1 / -1' }}>
      <div className="viab__card-header">
        <span className="material-symbols-outlined">smart_toy</span>
        Dictamen de Viabilidad IA (Gemini) — sobre este proyecto específico
      </div>
      <div className="viab__card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          onClick={evaluar}
          disabled={cargando}
          style={{
            alignSelf: 'flex-start', padding: '9px 18px', borderRadius: 8, border: 'none',
            background: '#0041a3', color: '#fff', fontWeight: 700, fontSize: 13,
            cursor: cargando ? 'not-allowed' : 'pointer', opacity: cargando ? 0.6 : 1,
          }}
        >
          {cargando ? 'Evaluando con IA… (puede tardar varios segundos)' : resultado ? 'Volver a evaluar' : 'Evaluar viabilidad con IA'}
        </button>

        {error && <div style={{ color: '#ba1a1a', fontSize: 12.5 }} role="alert">{error}</div>}

        {resultado && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: DICTAMEN_COLOR[resultado.estado_auditoria] }}>
                {resultado.score_viabilidad}<span style={{ fontSize: 14, fontWeight: 600 }}>/100</span>
              </div>
              <span style={{
                padding: '5px 12px', borderRadius: 9999, fontSize: 11.5, fontWeight: 800,
                color: '#fff', background: DICTAMEN_COLOR[resultado.estado_auditoria], letterSpacing: '0.03em',
              }}>
                {DICTAMEN_LABEL[resultado.estado_auditoria]}
              </span>
              <span style={{
                fontSize: 10.5, fontWeight: 700, color: resultado.fuente === 'heuristica' ? '#b45309' : '#0041a3',
                background: resultado.fuente === 'heuristica' ? 'rgba(180,83,9,0.1)' : 'rgba(0,65,163,0.08)',
                padding: '3px 10px', borderRadius: 6,
              }} title={resultado.fuente === 'heuristica' ? 'Gemini no estaba disponible (cuota/API key) — este dictamen es un cálculo heurístico de respaldo, no un análisis de IA real.' : 'Calculado por Gemini en tiempo real.'}>
                {resultado.fuente === 'heuristica' ? '⚠ MODO RESPALDO (sin IA real)' : `✓ ${resultado.fuente}`}
              </span>
            </div>

            {resultado.analisis_escala_poblacion.veredicto_escala && (
              <div style={{
                fontSize: 12.5, color: '#191c1e', lineHeight: 1.5, padding: '8px 12px', borderRadius: 8,
                background: resultado.analisis_escala_poblacion.proporcion_logica ? 'rgba(21,128,61,0.06)' : 'rgba(186,26,26,0.06)',
                borderLeft: `3px solid ${resultado.analisis_escala_poblacion.proporcion_logica ? '#15803d' : '#ba1a1a'}`,
              }}>
                <strong style={{ display: 'block', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                  Escala Población/Problema/Meta
                </strong>
                {resultado.analisis_escala_poblacion.veredicto_escala}
                {resultado.analisis_escala_poblacion.alerta && (
                  <div style={{ marginTop: 4, color: '#ba1a1a', fontWeight: 600 }}>{resultado.analisis_escala_poblacion.alerta}</div>
                )}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <div>
                <p style={{ margin: '0 0 6px', fontSize: 10.5, fontWeight: 700, color: '#0041a3', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cruce de Anexos</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#191c1e' }}>
                  <li>Respaldo financiero: {resultado.cruce_anexos.respaldo_financiero_detectado ? '✓ detectado' : '✗ no detectado'}</li>
                  <li>Marco normativo: {resultado.cruce_anexos.marco_normativo_validado ? '✓ validado' : '✗ no validado'}</li>
                  {resultado.cruce_anexos.brechas_detectadas.map((b) => <li key={b} style={{ color: '#ba1a1a' }}>{b}</li>)}
                </ul>
              </div>
              <div>
                <p style={{ margin: '0 0 6px', fontSize: 10.5, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Supuestos (Teoría del Cambio)</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#191c1e' }}>
                  {resultado.teoria_del_cambio_generada.supuestos.length > 0
                    ? resultado.teoria_del_cambio_generada.supuestos.map((s) => <li key={s}>{s}</li>)
                    : <li style={{ color: '#76777d', fontStyle: 'italic' }}>Sin supuestos registrados aún</li>}
                </ul>
              </div>
              <div>
                <p style={{ margin: '0 0 6px', fontSize: 10.5, fontWeight: 700, color: '#6b4fbb', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Resultados Esperados</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#191c1e' }}>
                  {resultado.teoria_del_cambio_generada.resultados_esperados.length > 0
                    ? resultado.teoria_del_cambio_generada.resultados_esperados.map((r) => <li key={r}>{r}</li>)
                    : <li style={{ color: '#76777d', fontStyle: 'italic' }}>Sin resultados registrados aún</li>}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Distribución de confianza estática (banda ilustrativa alrededor del score real) ──
// FIX (DIRECTIVA REMEDIACIÓN TOTAL, 2026-09-06): antes `sigma` se animaba con
// Math.sin(tick*0.6) en un loop de requestAnimationFrame — daba la falsa
// impresión de una simulación Montecarlo recalculándose en vivo, cuando en
// realidad no hay ningún motor estadístico detrás. Ahora es una banda fija,
// derivada únicamente del score real recibido por props.
function MontecarloChart({ score }: { score: number }) {
  const W = 500; const H = 170;
  const sigma = 0.22;
  const mu = W * (0.2 + (score / 10) * 0.6);

  const curve = (s: number) => {
    const pts: string[] = [];
    for (let i = 0; i <= 250; i++) {
      const x = (i / 250) * W;
      const z = (x - mu) / (s * W);
      const y = H - Math.exp(-0.5 * z * z) * H * 0.82;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join(' L ');
  };

  const p1 = curve(sigma);
  const p2 = curve(sigma * 1.4);
  const p3 = curve(sigma * 1.9);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#4338ca" />
          <stop offset="50%" stopColor="#0891b2" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id="g2" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#0041a3" stopOpacity="0.1" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Grid */}
      {[0.25, 0.5, 0.75].map(v => (
        <line key={v} x1={0} y1={H * v} x2={W} y2={H * v}
          stroke="#c4c5d7" strokeWidth="0.5" strokeDasharray="4,6" />
      ))}
      {/* Confidence intervals */}
      <path d={`M ${p3} L ${W},${H} L 0,${H} Z`} fill="url(#g1)" opacity="0.08" />
      <path d={`M ${p2} L ${W},${H} L 0,${H} Z`} fill="url(#g1)" opacity="0.18" />
      <path d={`M ${p1} L ${W},${H} L 0,${H} Z`} fill="url(#g2)" opacity="0.6" />
      {/* Main curve line */}
      {/* points de <polyline> no admite la sintaxis de path (" L "): con ella el
          navegador descartaba el atributo y la línea principal nunca se dibujaba
          (error de consola verificado 2026-09-23). Los <path> de arriba sí la usan. */}
      <polyline points={p1.split(' L ').join(' ')} fill="none" stroke="url(#g1)" strokeWidth="2.5"
        strokeLinejoin="round" filter="url(#glow)" />
      {/* Score marker */}
      <line x1={mu} y1={0} x2={mu} y2={H} stroke="#0041a3" strokeWidth="1.5" strokeDasharray="5,4" opacity="0.7" />
      <circle cx={mu} cy={H * 0.08} r={5} fill="#0041a3" />
      <text x={mu + 9} y={H * 0.08 + 5} fontSize="12" fill="#0041a3"
        fontFamily="'Public Sans',sans-serif" fontWeight="800">{score.toFixed(1)}</text>
      {/* Axis */}
      <line x1={0} y1={H} x2={W} y2={H} stroke="#c4c5d7" strokeWidth="1" />
    </svg>
  );
}

// ── AI Prediction Network — imagen Stitch como fondo + animación overlay ──────

function MiroFishNetwork() {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef     = useRef<number>(0);
  const t0Ref      = useRef<number>(0);
  const imgRef     = useRef<HTMLImageElement | null>(null);
  const imgReady   = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const DPR = window.devicePixelRatio || 1;

    // Carga imagen Stitch AI (fondo real, fidelidad 99.99%)
    const bg = new Image();
    bg.src = '/ai-prediction-bg.jpg';
    imgRef.current = bg;
    bg.onload = () => { imgReady.current = true; };

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * DPR;
      canvas.height = canvas.offsetHeight * DPR;
      ctx.scale(DPR, DPR);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const getSize = () => ({ W: canvas.offsetWidth, H: canvas.offsetHeight });

    // ── Partículas sobre los streams de la imagen ─────────────────────────────
    type Particle = { si:number; prog:number; spd:number; sz:number };
    const STREAM_COUNT = 10;
    const particles: Particle[] = Array.from({ length: 180 }, (_, i) => ({
      si: i % STREAM_COUNT, prog: i/180, spd:.0012+(i*7%13)*.00022, sz:1.2+(i%5)*.48,
    }));

    const loop = (ts: number) => {
      if (!t0Ref.current) t0Ref.current = ts;
      const t = (ts - t0Ref.current) * 0.001;
      const { W, H } = getSize();
      ctx.clearRect(0, 0, W, H);

      // ── FONDO: imagen Stitch AI — cover mode sin distorsión ──────────────
      if (imgReady.current && imgRef.current) {
        const img = imgRef.current;
        const iW = img.naturalWidth, iH = img.naturalHeight;
        const imgRatio = iW / iH;
        const canRatio = W / H;
        let sx = 0, sy = 0, sw = iW, sh = iH;
        if (canRatio > imgRatio) {
          sh = iW / canRatio; sy = (iH - sh) / 2;
        } else {
          sw = iH * canRatio; sx = (iW - sw) / 2;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
      } else {
        ctx.fillStyle = '#010818'; ctx.fillRect(0, 0, W, H);
      }

      // Posición del orbe central (calibrada a la imagen: 48% x, 52% y)
      const cx = W * 0.48, cy = H * 0.52;

      // Streams (coordenadas relativas calibradas a la imagen Stitch)
      type StreamDef = [number,number,number,number,number,number,number,number];
      const STREAMS: StreamDef[] = [
        [cx,cy, cx-W*.10,cy-H*.05, cx-W*.28,cy-H*.08, cx-W*.48,cy-H*.12],
        [cx,cy, cx-W*.06,cy+H*.05, cx-W*.20,cy+H*.10, cx-W*.44,cy+H*.16],
        [cx,cy, cx+W*.10,cy-H*.05, cx+W*.28,cy-H*.08, cx+W*.48,cy-H*.12],
        [cx,cy, cx+W*.06,cy+H*.05, cx+W*.20,cy+H*.10, cx+W*.44,cy+H*.16],
        [cx,cy, cx-W*.03,cy-H*.12, cx-W*.10,cy-H*.28, cx-W*.14,cy-H*.44],
        [cx,cy, cx+W*.03,cy-H*.12, cx+W*.10,cy-H*.28, cx+W*.14,cy-H*.44],
        [cx,cy, cx-W*.05,cy+H*.12, cx-W*.06,cy+H*.28, cx+W*.02,cy+H*.45],
        [cx,cy, cx+W*.05,cy+H*.12, cx+W*.06,cy+H*.28, cx+W*.02,cy+H*.45],
        [cx,cy, cx-W*.18,cy-H*.02, cx-W*.40,cy+H*.05, cx-W*.48,cy+H*.22],
        [cx,cy, cx+W*.18,cy-H*.02, cx+W*.40,cy+H*.05, cx+W*.48,cy+H*.22],
      ];

      // ── Partículas animadas sobre streams ─────────────────────────────────
      particles.forEach(p => {
        p.prog = (p.prog + p.spd) % 1;
        const [ax,ay,c1x,c1y,c2x,c2y,ex,ey] = STREAMS[p.si % STREAMS.length];
        const s = p.prog;
        const q0x=ax+(c1x-ax)*s, q0y=ay+(c1y-ay)*s;
        const q1x=c1x+(c2x-c1x)*s, q1y=c1y+(c2y-c1y)*s;
        const q2x=c2x+(ex-c2x)*s, q2y=c2y+(ey-c2y)*s;
        const r0x=q0x+(q1x-q0x)*s, r0y=q0y+(q1y-q0y)*s;
        const r1x=q1x+(q2x-q1x)*s, r1y=q1y+(q2y-q1y)*s;
        const px=r0x+(r1x-r0x)*s, py=r0y+(r1y-r0y)*s;
        const psz = p.sz * 2.6;
        const gr = ctx.createRadialGradient(px,py,0,px,py,psz);
        gr.addColorStop(0,'rgba(255,255,255,0.96)');
        gr.addColorStop(0.4,'rgba(80,240,255,0.72)');
        gr.addColorStop(1,'transparent');
        ctx.beginPath(); ctx.arc(px, py, psz, 0, Math.PI*2);
        ctx.fillStyle = gr; ctx.fill();
      });

      // ── Pulso del orbe central (anillos expansivos) ───────────────────────
      const orbR = Math.min(W,H) * 0.072;
      for (let ri = 0; ri < 4; ri++) {
        const ph = (t * 0.55 + ri * 0.25) % 1;
        const rr = orbR * (1.05 + ph * 3.6);
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(0,245,255,${0.22*(1-ph)})`;
        ctx.lineWidth = 1.4; ctx.stroke();
      }

      // ── Panel dinámico: AI PREDICTION CORE + PREDICTION REPORT ──────────
      const panX = W*.695, panY = H*.048, panW = W*.278, panH = H*.50;
      ctx.save();
      ctx.globalAlpha = 0.80;
      ctx.fillStyle = 'rgba(0,4,18,0.82)';
      ctx.beginPath(); ctx.roundRect(panX, panY, panW, panH, 8); ctx.fill();
      ctx.strokeStyle = 'rgba(0,180,255,0.28)'; ctx.lineWidth = 1; ctx.stroke();

      // Título "AI PREDICTION CORE"
      ctx.globalAlpha = 0.96;
      ctx.fillStyle = '#00d8ff';
      ctx.font = `bold ${Math.min(11,panW*.088)}px 'Public Sans',sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('AI PREDICTION CORE', panX+9, panY+9);

      // ── Estado honesto del panel (radiografía 2026-09-07) ─────────────────
      // Antes aquí se dibujaban 2 curvas + 8 barras "PREDICTION REPORT" + un
      // gauge circular, todos calculados con Math.sin()/Math.cos() del reloj
      // `t` — sin ningún dato real detrás (ni siquiera `score`), presentados
      // bajo el rótulo "AI PREDICTION CORE" como si fueran analítica en vivo.
      // Se retira la simulación; el fondo Stitch, las partículas, el orbe y
      // el marco del panel (diseño real aprobado) quedan intactos — solo se
      // reemplaza el contenido fabricado por un estado honesto, reusando los
      // mismos tokens de color/fuente ya usados en este panel.
      const bodyX = panX+9, bodyW = panW-18, bodyY = panY+29, bodyH = panH-38;
      ctx.globalAlpha = 0.62; ctx.fillStyle = '#80d0ff';
      ctx.font = `${Math.min(9.5,panW*.082)}px 'Public Sans',sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const msg = 'Módulo de predicción IA en espera de datos reales de ejecución.';
      const words = msg.split(' ');
      let line = '', ly2 = bodyY + bodyH*0.38;
      const lineH = 13;
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > bodyW && line) {
          ctx.fillText(line, bodyX, ly2);
          line = w; ly2 += lineH;
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, bodyX, ly2);

      ctx.restore();
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width:'100%', height:'100%', display:'block' }}
    />
  );
}

// ── Score ring ────────────────────────────────────────────────────────────────
function ScoreRing({ score, color }: { score: number; color: string }) {
  const r = 42; const circ = 2 * Math.PI * r;
  const dash = (score / 10) * circ;
  return (
    <svg width={100} height={100} viewBox="0 0 100 100">
      <circle cx={50} cy={50} r={r} fill="none" stroke="#eceef0" strokeWidth={8} />
      <circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 50 50)"
        style={{ transition: 'stroke-dasharray 1s ease' }} />
      <text x={50} y={46} textAnchor="middle" fontSize="18" fontWeight="800"
        fill={color} fontFamily="'Public Sans',sans-serif">{score.toFixed(1)}</text>
      <text x={50} y={62} textAnchor="middle" fontSize="10" fill="#76777d"
        fontFamily="'Public Sans',sans-serif">/10</text>
    </svg>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ViabilidadPage() {
  const [selecciones, setSelecciones] = useState<Record<string, string>>({});
  const [analisis, setAnalisis] = useState<AnalisisViabilidad>(() => estadoVacio());
  const [estado, setEstado] = useState<EstadoFormulador | null>(null);

  useEffect(() => {
    const est = ejecutarFormulador();
    setSelecciones(est.config.selecciones);
    setAnalisis(est.analisis);
    setEstado(est);
  }, []);

  return (
    <div className="viab__wrap">
      <div className="viab__header">
        <h1 className="viab__title">
          <span className="material-symbols-outlined">analytics</span>
          Viabilidad del Proyecto
        </h1>
        <div className="viab__dna-badge">
          ADN activo: <strong>
            {['interlocutor', 'tono', 'enfoque', 'humanizacion', 'adicional'].map((id, i) => {
              const cats = [
                ['Municipal','Embajada','ONG','Corporativo','Multilateral ONU/Banca'],
                ['Diplomatico','Institucional','Tecnico','Inspirador','Ejecutivo'],
                ['(ODS) y sostenible','Social y comunitario','Tecnico-estructural','Analítico','Financiero y Eficiente'],
                ['Formal','Conversacional','Relatable','Indetectable'],
                ['Economía Verde','Reglas de oro','Economía Circular','Enfoque de Género'],
              ];
              const idx = cats[i].indexOf(selecciones[id]);
              return idx === -1 ? '0' : String(idx + 1);
            }).join('')}
          </strong>
        </div>
      </div>

      <div className="viab__grid">
        {/* Dictamen real de IA (Gemini) sobre el proyecto — Fase 3 */}
        <DictamenIACard />

        {/* Q1 — Montecarlo */}
        <div className="viab__card viab__card--q1">
          <div className="viab__card-header">
            <span className="material-symbols-outlined">scatter_plot</span>
            Distribución Montecarlo
          </div>
          <div className="viab__card-body viab__mc-body">
            <MontecarloChart score={analisis.score} />
            <div className="viab__mc-legend">
              <span className="viab__mc-dot" style={{ background: 'rgba(67,56,202,0.6)' }} />IC 68%
              <span className="viab__mc-dot" style={{ background: 'rgba(8,145,178,0.4)' }} />IC 95%
              <span className="viab__mc-dot" style={{ background: 'rgba(124,58,237,0.2)' }} />IC 99%
            </div>
          </div>
        </div>

        {/* Q2 — Diagnóstico */}
        <div className="viab__card viab__card--q2">
          <div className="viab__card-header">
            <span className="material-symbols-outlined">psychology</span>
            Diagnóstico Estratégico
          </div>
          <div className="viab__card-body viab__diag-body">
            <div className="viab__score-row">
              <ScoreRing score={analisis.score} color={analisis.color} />
              <div>
                <div className="viab__score-label" style={{ color: analisis.color }}>
                  Viabilidad {analisis.label}
                </div>
                <div className="viab__score-sub">Índice compuesto · 5 dimensiones</div>
              </div>
            </div>
            <ul className="viab__just-list">
              {analisis.justificacion.map((j) => (
                <li key={j}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14, color: analisis.color }}>arrow_forward_ios</span>
                  {j}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Separator */}
        <div className="viab__separator" />

        {/* Q3 — AI Agent Network */}
        <div className="viab__card viab__card--q3 viab__card--dark">
          <div className="viab__card-header viab__card-header--dark">
            <span className="material-symbols-outlined">hub</span>
            Red de Agentes
          </div>
          <div className="viab__card-body viab__card-body--canvas">
            <MiroFishNetwork />
          </div>
        </div>

        {/* Q4 — 3 paneles MiroFish */}
        <div className="viab__card viab__card--q4" style={{ background:'transparent', border:'none', boxShadow:'none', overflow:'visible' }}>
          <div className="viab__miro-panels">

            {/* Panel 1 — DATOS MIROFISH: Dimensiones */}
            <div className="viab__miro-panel">
              <div className="viab__miro-panel-header">
                <span className="material-symbols-outlined">hub</span>
                Datos MiroFish — Dimensiones
              </div>
              <div className="viab__miro-panel-body">
                {(estado?.crudo.dimensiones ?? []).map(d => {
                  const pct = (d.score / 5) * 100;
                  const barColor = d.score >= 4 ? '#0041a3' : d.score >= 3 ? '#f59e0b' : '#dc2626';
                  return (
                    <div key={d.id} className="viab__dim-row">
                      <div className="viab__dim-name" title={d.nombre}>{d.nombre}</div>
                      <div className="viab__dim-bar-wrap">
                        <div className="viab__dim-bar" style={{ width:`${pct}%`, background: barColor }} />
                      </div>
                      <div className="viab__dim-score" style={{ color: barColor }}>{d.score}/5</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Panel 2 — DATOS MIROFISH: Pipeline */}
            <div className="viab__miro-panel">
              <div className="viab__miro-panel-header">
                <span className="material-symbols-outlined">account_tree</span>
                Datos MiroFish — Pipeline
              </div>
              <div className="viab__miro-panel-body">
                {(estado?.crudo.pipeline ?? []).map(e => (
                  <div key={e.etapa} className="viab__pipe-row">
                    <div className={`viab__pipe-icon viab__pipe-icon--${e.estado === 'ok' ? 'ok' : e.estado === 'advertencia' ? 'adv' : 'fail'}`}>
                      {e.estado === 'ok' ? '✓' : e.estado === 'advertencia' ? '!' : '✗'}
                    </div>
                    <div>
                      <strong style={{ fontSize:10 }}>{e.nombre}</strong>
                      <div style={{ color:'#76777d', fontSize:10, marginTop:1 }}>{e.detalle}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel 3 — INDICADORES MIROFISH */}
            <div className="viab__miro-panel">
              <div className="viab__miro-panel-header">
                <span className="material-symbols-outlined">monitoring</span>
                Indicadores MiroFish
              </div>
              <div className="viab__miro-panel-body">
                {analisis.riesgos.map((r) => (
                  <div key={`${r.nivel}-${r.texto}`} className="viab__ind-row">
                    <span className={`viab__ind-badge viab__ind-badge--${r.nivel}`}>
                      {r.nivel.toUpperCase()}
                    </span>
                    <span>{r.texto}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
