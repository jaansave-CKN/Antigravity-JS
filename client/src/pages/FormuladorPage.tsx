import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';
import { useSubscription } from '../contexts/SubscriptionContext';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface ProjectData {
  // Paso 1
  titulo: string;
  sector: string;
  tipoFinanciamiento: string;
  entidadConvocante: string;
  // Paso 2
  problema: string;
  poblacionObjetivo: string;
  ubicacion: string;
  // Paso 3
  objetivoGeneral: string;
  objetivosEspecificos: string[];
  resultadosEsperados: string[];
  // Paso 4
  componenteMarco: string;
  indicadores: string;
  mediosVerificacion: string;
  supuestos: string;
  // Paso 5
  montoTotal: string;
  duracionMeses: string;
  fuenteFinanciamiento: string;
  contrapartida: string;
  // Paso 6 — M4 Motor Dialéctico
  tono: string;
  listaOro: string[];
  listaNegra: string[];
  enfasis: string;
  // Paso 7 — M10 Compliance
  sostenibilidadAmbiental: string;
  sostenibilidadSocial: string;
  odsAlineados: number[];
  enfoqueGenero: boolean;
  enfoqueGeneroTexto: string;
}

const INITIAL: ProjectData = {
  titulo: '', sector: '', tipoFinanciamiento: '', entidadConvocante: '',
  problema: '', poblacionObjetivo: '', ubicacion: '',
  objetivoGeneral: '', objetivosEspecificos: [''], resultadosEsperados: [''],
  componenteMarco: '', indicadores: '', mediosVerificacion: '', supuestos: '',
  montoTotal: '', duracionMeses: '', fuenteFinanciamiento: '', contrapartida: '',
  // M4 Motor Dialéctico
  tono: 'formal', listaOro: [], listaNegra: [], enfasis: '',
  // M10 Compliance
  sostenibilidadAmbiental: '', sostenibilidadSocial: '',
  odsAlineados: [], enfoqueGenero: false, enfoqueGeneroTexto: '',
};

const STEPS = [
  { id: 1, key: 'info',      label: 'Información General',    icon: '①', short: 'General'   },
  { id: 2, key: 'problema',  label: 'Problema y Contexto',    icon: '②', short: 'Problema'  },
  { id: 3, key: 'objetivos', label: 'Objetivos y Resultados', icon: '③', short: 'Objetivos' },
  { id: 4, key: 'marco',     label: 'Marco Lógico',           icon: '④', short: 'Marco'     },
  { id: 5, key: 'pres',      label: 'Presupuesto',            icon: '⑤', short: 'Presupuesto'},
  { id: 6, key: 'm4',        label: 'M4 — Motor Dialéctico',  icon: '⑥', short: 'Dialéctico'},
  { id: 7, key: 'm10',       label: 'M10 — Compliance',       icon: '⑦', short: 'Compliance'},
  { id: 8, key: 'm12',       label: 'M12 — Ficha Maestra',    icon: '⑧', short: 'Sello'},
] as const;

const SECTORES = ['Salud', 'Educación', 'Infraestructura', 'Medio Ambiente', 'Desarrollo Rural', 'Tecnología', 'Cultura', 'Seguridad', 'Otro'];
const TIPOS_FIN = ['Subvención', 'Crédito blando', 'Cooperación técnica', 'Fondo reembolsable', 'Cofinanciación', 'Otro'];

// ── Página principal ──────────────────────────────────────────────────────────
export default function FormuladorPage() {
  const navigate                      = useNavigate();
  const location                      = useLocation();
  const { token, isTrialMode }        = useAuth();
  const { hasFormulador }             = useSubscription();
  const [step, setStep]               = useState(1);
  const [data, setData]               = useState<ProjectData>(INITIAL);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [autoSaved, setAutoSaved]     = useState(false);
  const [proyectoId, setProyectoId]   = useState<string | null>(null);
  const [saveError, setSaveError]     = useState<string | null>(null);
  const [proyectoFinalizado, setProyectoFinalizado] = useState(false);
  const autoSaveTimer                 = useRef<ReturnType<typeof setTimeout> | null>(null);

  // M7 Match Score — estado de progreso del batch de embeddings
  type MatchStatus = 'idle' | 'loading' | 'done' | 'error';
  const [matchStatus, setMatchStatus]   = useState<MatchStatus>('idle');
  const [matchProgress, setMatchProgress] = useState('');
  const [matchCount, setMatchCount]     = useState(0);

  // M2 Bridge: cargar proyecto existente desde URL param ?proyecto=XXX (desde Radar)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const proyId = params.get('proyecto');
    if (!proyId || !token || token === 'demo-mode-token' || isTrialMode) return;
    setProyectoId(proyId);
    fetch(`/api/proyectos/${proyId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        if (!d.success || !d.data) return;
        const p   = d.data;
        const ft  = p.ficha_tecnica || {};
        if (p.estado === 'Finalizado') setProyectoFinalizado(true);
        setData(prev => ({
          ...prev,
          titulo:               ft.nombre               || '',
          sector:               ft.sector               || '',
          tipoFinanciamiento:   ft.tipoFinanciamiento   || '',
          entidadConvocante:    ft.convocatoria         || '',
          problema:             ft.descripcion          || '',
          poblacionObjetivo:    ft.poblacion            || '',
          ubicacion:            ft.municipio            || '',
          objetivoGeneral:      ft.objetivos            || '',
          objetivosEspecificos: ft.objetivosEspecificos?.length ? ft.objetivosEspecificos : [''],
          resultadosEsperados:  ft.resultadosEsperados?.length  ? ft.resultadosEsperados  : [''],
          componenteMarco:      ft.componenteMarco      || '',
          indicadores:          ft.indicadores          || '',
          mediosVerificacion:   ft.mediosVerif          || '',
          supuestos:            ft.supuestos            || '',
          montoTotal:           ft.metaFisicaTotal      ? String(ft.metaFisicaTotal) : '',
          duracionMeses:        ft.duracionMeses        ? String(ft.duracionMeses)   : '',
          fuenteFinanciamiento: ft.fuenteFinanciamiento || '',
          contrapartida:        ft.contrapartida        || '',
        }));
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save debounced: 2.5 s después del último cambio, solo con proyecto existente
  useEffect(() => {
    if (!proyectoId || !token || token === 'demo-mode-token' || isTrialMode || proyectoFinalizado) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try {
        await handleSave();
        setAutoSaved(true);
        setTimeout(() => setAutoSaved(false), 2000);
      } catch { /* silencioso — el usuario puede guardar manualmente */ }
    }, 2500);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(<K extends keyof ProjectData>(key: K, value: ProjectData[K]) => {
    setData(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  const handleSave = async () => {
    if (proyectoFinalizado) return;
    setSaving(true);
    setSaveError(null);

    // Modo demo o trial: simulación visual sin persistencia en BD
    if (!token || token === 'demo-mode-token' || isTrialMode) {
      await new Promise(r => setTimeout(r, 400));
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      return;
    }

    try {
      const method  = proyectoId ? 'PATCH' : 'POST';
      const url     = proyectoId ? `/api/proyectos/${proyectoId}` : '/api/proyectos';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nombre:       data.titulo || 'Borrador sin título',
          fichaTecnica: {
            nombre:           data.titulo,
            sector:           data.sector,
            descripcion:      data.problema,
            objetivos:        data.objetivoGeneral,
            poblacion:        data.poblacionObjetivo,
            municipio:        data.ubicacion,
            convocatoria:     data.entidadConvocante,
            indicadores:      data.indicadores,
            mediosVerif:      data.mediosVerificacion,
            supuestos:        data.supuestos,
            tipoFinanciamiento: data.tipoFinanciamiento,
            metaFisicaTotal:  parseFloat(data.montoTotal.replace(/[^0-9.]/g, '')) || 0,
            duracionMeses:    Number(data.duracionMeses) || 0,
            fuenteFinanciamiento: data.fuenteFinanciamiento,
            contrapartida:    data.contrapartida,
            objetivosEspecificos: data.objetivosEspecificos,
            resultadosEsperados:  data.resultadosEsperados,
            componenteMarco:  data.componenteMarco,
            progreso: progress,
          },
        }),
      });
      const text = await res.text();
      let json: any = {};
      try { json = JSON.parse(text); } catch { /* noop */ }
      if (res.ok) {
        if (json.proyectoId && !proyectoId) setProyectoId(json.proyectoId);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setSaveError(json.message || `Error ${res.status} al guardar`);
      }
      // Persistencia M4 y M10 en paralelo si ya existe proyectoId
      const pid = json.proyectoId || proyectoId;
      if (pid && token && token !== 'demo-mode-token') {
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
        await Promise.allSettled([
          fetch(`/api/m4/config/${pid}`, {
            method: 'POST', headers,
            body: JSON.stringify({ tono: data.tono, lista_oro: data.listaOro, lista_negra: data.listaNegra, enfasis: data.enfasis }),
          }),
          fetch(`/api/m10/compliance/${pid}`, {
            method: 'POST', headers,
            body: JSON.stringify({
              sostenibilidad_ambiental: data.sostenibilidadAmbiental,
              sostenibilidad_social: data.sostenibilidadSocial,
              ods_alineados: data.odsAlineados,
              enfoque_genero: data.enfoqueGenero,
              enfoque_genero_texto: data.enfoqueGeneroTexto,
            }),
          }),
        ]);
      }
    } catch {
      setSaveError('Sin conexión con el servidor');
    } finally {
      setSaving(false);
    }
  };

  // M7 — Disparar pipeline de compatibilidad con IA (batch embeddings)
  const handleMatchScore = async () => {
    if (!proyectoId || !token || token === 'demo-mode-token' || isTrialMode) return;
    setMatchStatus('loading');
    setMatchProgress('Procesando convocatorias...');
    const STEPS_MSG = [
      'Procesando convocatorias...',
      'Generando vectores semánticos...',
      'Evaluando compatibilidad con IA...',
      'Calculando puntajes de match...',
      'Ordenando resultados...',
    ];
    let msgIdx = 0;
    const ticker = setInterval(() => {
      msgIdx = (msgIdx + 1) % STEPS_MSG.length;
      setMatchProgress(STEPS_MSG[msgIdx]);
    }, 1800);
    try {
      const r = await fetch(`/api/modulo7/match/${proyectoId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (d.success) {
        setMatchCount(d.data?.length || 0);
        setMatchStatus('done');
      } else {
        setMatchStatus('error');
        setMatchProgress(d.message || 'Error calculando compatibilidad');
      }
    } catch {
      setMatchStatus('error');
      setMatchProgress('Sin conexión con el servidor');
    } finally {
      clearInterval(ticker);
    }
  };

  const completedSteps = STEPS.filter(s => isStepComplete(s.id, data)).map(s => s.id);
  const progress = Math.round((completedSteps.length / STEPS.length) * 100);

  // ── Gate de suscripción: free sin trial → muro de upgrade ──────────────────
  if (!isTrialMode && !hasFormulador) {
    return <FormuladorUpgradeWall />;
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', background: '#f7f9fb' }}>

      {/* ── Banner trial ────────────────────────────────────────────────────── */}
      {isTrialMode && (
        <div style={{ background: '#7c3aed', color: '#fff', padding: '6px 1.5rem', fontSize: 11, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>⚡ MODO TRIAL · Datos volátiles — se perderán al cerrar la pestaña</span>
          <button onClick={() => navigate('/planes')} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 4, color: '#fff', padding: '3px 10px', fontSize: 10, cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700 }}>
            Activar plan →
          </button>
        </div>
      )}

      {/* ── Banner proyecto finalizado (lock M12) ───────────────────────────── */}
      {proyectoFinalizado && (
        <div style={{ background: '#14532d', color: '#86efac', padding: '7px 1.5rem', fontSize: 11, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>🔒</span>
          <span>PROYECTO FINALIZADO · Sello SHA-256 generado — documento de solo lectura</span>
        </div>
      )}

      {/* ── Top bar del módulo ─────────────────────────────────────────────── */}
      <div style={{ background: '#191c1e', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={() => navigate('/')}
            style={{ background: 'transparent', border: '1px solid #374151', borderRadius: 6, padding: '5px 10px', color: '#9ca3af', fontSize: 11, fontFamily: 'monospace', cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase' }}
          >
            ← Inicio
          </button>
          <div>
            <p style={{ fontSize: 9, fontFamily: 'monospace', color: '#6b7280', letterSpacing: '0.18em', textTransform: 'uppercase', margin: 0 }}>MÓDULO B · FORMULADOR</p>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: 0, letterSpacing: '-0.01em' }}>
              {data.titulo || 'Nuevo Proyecto Sin Título'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 120, height: 4, background: '#374151', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: progress === 100 ? '#22c55e' : '#0058be', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#9ca3af' }}>{progress}%</span>
          </div>
          {autoSaved && (
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#86efac' }}>
              ✓ auto-guardado
            </span>
          )}
          {/* Botón M7 — solo visible cuando hay proyecto guardado */}
          {proyectoId && !isTrialMode && !proyectoFinalizado && (
            <button
              onClick={handleMatchScore}
              disabled={matchStatus === 'loading'}
              title="Calcular compatibilidad del proyecto con convocatorias activas"
              style={{
                padding: '7px 14px', borderRadius: 6, border: '1px solid #374151',
                background: matchStatus === 'done' ? '#14532d' : matchStatus === 'error' ? '#7f1d1d' : '#1e293b',
                color: matchStatus === 'error' ? '#fca5a5' : '#9ca3af',
                fontSize: 10, fontFamily: 'monospace', fontWeight: 700,
                cursor: matchStatus === 'loading' ? 'not-allowed' : 'pointer',
                letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap',
              }}
            >
              {matchStatus === 'done'
                ? `◎ ${matchCount} MATCHES`
                : matchStatus === 'error'
                ? '✗ MATCH ERROR'
                : '◎ CALCULAR MATCH'}
            </button>
          )}
          {saveError && (
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#fca5a5', maxWidth: 180 }}>
              ⚠ {saveError}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || proyectoFinalizado}
            style={{
              background: proyectoFinalizado ? '#374151' : saveError ? '#7f1d1d' : saved ? '#14532d' : '#0058be',
              border: 'none', borderRadius: 6, padding: '7px 16px',
              color: '#fff', fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
              cursor: proyectoFinalizado ? 'not-allowed' : 'pointer',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              opacity: saving ? 0.7 : 1, transition: 'background 0.2s',
            }}
          >
            {proyectoFinalizado ? '🔒 FINALIZADO' : saving ? 'GUARDANDO...' : saved ? '✓ GUARDADO' : saveError ? 'REINTENTAR' : 'GUARDAR BORRADOR'}
          </button>
        </div>
      </div>

      {/* ── Overlay bloqueante M7 (batch embeddings en progreso) ───────────── */}
      {matchStatus === 'loading' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(25,28,30,0.82)', backdropFilter: 'blur(4px)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 20,
        }}>
          <div style={{
            background: '#191c1e', border: '1px solid #374151',
            borderRadius: 16, padding: '2.5rem 3rem', textAlign: 'center',
            maxWidth: 380,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', border: '3px solid #0058be',
              borderTopColor: 'transparent', margin: '0 auto 20px',
              animation: 'spin 0.9s linear infinite',
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={{ fontSize: 11, fontFamily: 'monospace', color: '#6b7280', letterSpacing: '0.15em', textTransform: 'uppercase', margin: '0 0 8px' }}>
              MÓDULO 7 — MATCH SCORE IA
            </p>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: '0 0 20px', fontFamily: 'system-ui' }}>
              {matchProgress}
            </p>
            {/* Barra de progreso animada */}
            <div style={{ height: 4, background: '#374151', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: 'linear-gradient(90deg, #0058be, #16a34a)',
                borderRadius: 2, animation: 'progress-bar 2.5s ease-in-out infinite',
                width: '60%',
              }} />
            </div>
            <style>{`@keyframes progress-bar { 0%{transform:translateX(-100%)} 100%{transform:translateX(250%)} }`}</style>
            <p style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace', margin: '12px 0 0' }}>
              No cierres esta ventana
            </p>
          </div>
        </div>
      )}

      {/* ── Layout: sidebar + contenido ───────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* Sidebar de pasos */}
        <aside style={{
          width: 220, flexShrink: 0,
          background: '#fff', borderRight: '1px solid #e5e7eb',
          padding: '1.5rem 0',
          display: 'flex', flexDirection: 'column',
        }}>
          <p style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.18em', textTransform: 'uppercase', padding: '0 1.25rem', marginBottom: '0.75rem' }}>
            PASOS DEL FORMULARIO
          </p>
          {STEPS.map(s => {
            const isActive    = s.id === step;
            const isCompleted = completedSteps.includes(s.id);
            const isPast      = s.id < step;
            return (
              <button
                key={s.id}
                onClick={() => setStep(s.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 1.25rem',
                  background: isActive ? '#f0f4ff' : 'transparent',
                  border: 'none',
                  borderLeft: `3px solid ${isActive ? '#0058be' : 'transparent'}`,
                  cursor: 'pointer', width: '100%', textAlign: 'left',
                  transition: 'background 0.15s',
                }}
              >
                <span style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontFamily: 'monospace', fontWeight: 700,
                  background: isActive ? '#0058be' : isCompleted ? '#22c55e' : isPast ? '#dbeafe' : '#f3f4f6',
                  color: isActive || isCompleted ? '#fff' : isPast ? '#0058be' : '#9ca3af',
                  transition: 'background 0.2s',
                }}>
                  {isCompleted && !isActive ? '✓' : s.id}
                </span>
                <div>
                  <p style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: isActive ? 700 : 500, color: isActive ? '#0058be' : '#374151', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {s.short}
                  </p>
                  <p style={{ fontSize: 10, color: '#9ca3af', margin: 0, fontFamily: 'system-ui' }}>{s.label}</p>
                </div>
              </button>
            );
          })}

          {/* Divider + acciones extras */}
          <div style={{ marginTop: 'auto', padding: '1.25rem', borderTop: '1px solid #e5e7eb' }}>
            <button
              onClick={() => navigate('/radar')}
              style={{ width: '100%', padding: '7px 0', background: '#f0f4ff', border: '1px solid #dbeafe', borderRadius: 6, color: '#0058be', fontSize: 10, fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase' }}
            >
              ◎ Ver Radar 360
            </button>
          </div>
        </aside>

        {/* Área de contenido */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '2rem 2.5rem' }}>
          <StepHeader step={step} total={STEPS.length} label={STEPS[step - 1].label} />

          {step === 1 && <StepInfoGeneral data={data} update={update} />}
          {step === 2 && <StepProblema data={data} update={update} />}
          {step === 3 && <StepObjetivos data={data} update={update} />}
          {step === 4 && <StepMarcoLogico data={data} update={update} />}
          {step === 5 && <StepPresupuesto data={data} update={update} />}
          {step === 6 && <StepMotorDialectico data={data} update={update} />}
          {step === 7 && <StepCompliance data={data} update={update} proyectoId={proyectoId} token={token} sector={data.sector} municipio={data.ubicacion} />}
          {step === 8 && <StepFichaTecnica data={data} proyectoId={proyectoId} token={token} onSealSuccess={() => setProyectoFinalizado(true)} />}

          {/* Navegación entre pasos */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
            <button
              onClick={() => setStep(s => Math.max(1, s - 1))}
              disabled={step === 1}
              style={{ padding: '9px 20px', background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 8, color: '#374151', fontSize: 12, fontFamily: 'monospace', fontWeight: 700, cursor: step === 1 ? 'not-allowed' : 'pointer', opacity: step === 1 ? 0.4 : 1, letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              ← Anterior
            </button>
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#9ca3af' }}>
              Paso {step} de {STEPS.length}
            </span>
            {step < STEPS.length ? (
              <button
                onClick={() => setStep(s => Math.min(STEPS.length, s + 1))}
                style={{ padding: '9px 20px', background: '#0058be', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase' }}
              >
                Siguiente →
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={proyectoFinalizado}
                style={{ padding: '9px 24px', background: proyectoFinalizado ? '#374151' : '#191c1e', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, fontFamily: 'monospace', fontWeight: 700, cursor: proyectoFinalizado ? 'not-allowed' : 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase' }}
              >
                {proyectoFinalizado ? '🔒 Proyecto sellado' : '✓ Finalizar y guardar'}
              </button>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Muro de upgrade — Bloque 2 sin suscripción ───────────────────────────────
function FormuladorUpgradeWall() {
  const navigate = useNavigate();
  const MODULOS  = [
    'M3 — Ingesta de pliegos propios',
    'M4 — Motor Dialéctico (tono, Lista Oro/Negra)',
    'M5 — Configuración Logística',
    'M6 — Árbol de Objetivos con IA',
    'M7 — Arquitectura Financiera (APU)',
    'M8 — Marco Normativo automático',
    'M9 — Auditoría de Calidad',
    'M10 — Compliance (riesgos / ODS)',
    'M11 — Consultor Estratégico',
    'M12 — Ficha Técnica Maestra (SHA-256)',
  ];
  return (
    <div style={{
      minHeight: 'calc(100vh - 48px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg,#f5f3ff 0%,#f7f9fb 60%,#f0fdf4 100%)',
      padding: '2rem',
    }}>
      <div style={{
        background: '#fff', borderRadius: 20,
        border: '2px solid #ede9fe',
        boxShadow: '0 12px 48px rgba(124,58,237,0.10)',
        padding: '3rem 2.5rem', maxWidth: 520, width: '100%', textAlign: 'center',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: 'linear-gradient(135deg,#7c3aed,#0058be)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 30, margin: '0 auto 1.5rem',
        }}>◧</div>

        <p style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: '#7c3aed', letterSpacing: '0.18em', textTransform: 'uppercase', margin: '0 0 8px' }}>
          MÓDULO B · FORMULADOR
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#191c1e', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
          Plan Formulador requerido
        </h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 2rem', lineHeight: 1.6, fontFamily: 'system-ui, sans-serif' }}>
          La Caja Negra de Formulación incluye 10 módulos que guían tu proyecto desde el pliego hasta el documento blindado con sello SHA-256.
        </p>

        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 2rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {MODULOS.map(m => (
            <li key={m} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: '#374151', fontFamily: 'system-ui, sans-serif' }}>
              <span style={{ color: '#7c3aed', fontWeight: 700, flexShrink: 0 }}>✓</span>
              {m}
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4, marginBottom: '1.75rem' }}>
          <span style={{ fontSize: 40, fontWeight: 800, color: '#7c3aed' }}>$79</span>
          <span style={{ fontSize: 13, color: '#9ca3af' }}>/mes</span>
        </div>

        <button
          onClick={() => navigate('/planes')}
          style={{
            width: '100%', padding: '14px',
            background: 'linear-gradient(135deg,#7c3aed,#0058be)',
            border: 'none', borderRadius: 10,
            color: '#fff', fontSize: 13, fontFamily: 'monospace', fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
            marginBottom: 12,
          }}
        >
          Activar plan Formulador →
        </button>
        <button
          onClick={() => navigate('/')}
          style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 12, cursor: 'pointer', fontFamily: 'system-ui' }}
        >
          ← Volver al inicio
        </button>
      </div>
    </div>
  );
}

// ── Header de paso ─────────────────────────────────────────────────────────────
function StepHeader({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <p style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.18em', textTransform: 'uppercase', margin: '0 0 6px' }}>
        PASO {step} DE {total}
      </p>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: '#191c1e', margin: '0 0 8px', letterSpacing: '-0.02em' }}>{label}</h2>
      <div style={{ width: '100%', height: 3, background: '#e5e7eb', borderRadius: 2 }}>
        <div style={{ width: `${(step / total) * 100}%`, height: '100%', background: '#0058be', borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

// ── Inputs comunes ──────────────────────────────────────────────────────────────
function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <label style={{ display: 'block', fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: '#45464d', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 6 }}>
        {label}{required && <span style={{ color: '#dc2626' }}> *</span>}
      </label>
      {children}
      {hint && <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, fontFamily: 'system-ui' }}>{hint}</p>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px',
  background: '#f9fafb', border: '1.5px solid #e5e7eb', borderRadius: 8,
  fontSize: 13, color: '#191c1e', fontFamily: 'system-ui, sans-serif',
  outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s',
};

const textareaStyle: React.CSSProperties = { ...inputStyle, resize: 'vertical', minHeight: 100, lineHeight: 1.6 };
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

// ── Paso 1: Información General ────────────────────────────────────────────────
function StepInfoGeneral({ data, update }: { data: ProjectData; update: Function }) {
  return (
    <div>
      <Field label="Título del Proyecto" required hint="Nombre descriptivo y conciso del proyecto de inversión.">
        <input
          style={inputStyle}
          value={data.titulo}
          onChange={e => update('titulo', e.target.value)}
          placeholder="Ej: Mejoramiento del servicio de salud básica en zona rural..."
          onFocus={e => e.target.style.borderColor = '#0058be'}
          onBlur={e => e.target.style.borderColor = '#e5e7eb'}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <Field label="Sector" required>
          <select style={selectStyle} value={data.sector} onChange={e => update('sector', e.target.value)}>
            <option value="">— Seleccionar —</option>
            {SECTORES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Tipo de Financiamiento">
          <select style={selectStyle} value={data.tipoFinanciamiento} onChange={e => update('tipoFinanciamiento', e.target.value)}>
            <option value="">— Seleccionar —</option>
            {TIPOS_FIN.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Entidad Convocante" hint="Nombre de la entidad, ministerio o fondo que emite la convocatoria.">
        <input
          style={inputStyle}
          value={data.entidadConvocante}
          onChange={e => update('entidadConvocante', e.target.value)}
          placeholder="Ej: Ministerio de Salud y Protección Social"
          onFocus={e => e.target.style.borderColor = '#0058be'}
          onBlur={e => e.target.style.borderColor = '#e5e7eb'}
        />
      </Field>

      <InfoBox icon="◎" text="Puedes importar datos desde el Radar 360 para autocompletar entidades y convocatorias activas." action="Ver Radar" href="/radar" />
    </div>
  );
}

// ── Paso 2: Problema y Contexto ────────────────────────────────────────────────
function StepProblema({ data, update }: { data: ProjectData; update: Function }) {
  return (
    <div>
      <Field label="Descripción del Problema" required hint="Define el problema central que el proyecto busca resolver. Incluye causas y efectos.">
        <textarea
          style={textareaStyle}
          value={data.problema}
          onChange={e => update('problema', e.target.value)}
          placeholder="Describe la problemática identificada, sus causas raíces y los efectos negativos sobre la población objetivo..."
          onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#0058be'}
          onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#e5e7eb'}
        />
      </Field>

      <Field label="Población Objetivo" required hint="Caracteriza el grupo de personas beneficiarias directas del proyecto.">
        <input
          style={inputStyle}
          value={data.poblacionObjetivo}
          onChange={e => update('poblacionObjetivo', e.target.value)}
          placeholder="Ej: 2.500 familias rurales del municipio X en condición de pobreza extrema"
          onFocus={e => e.target.style.borderColor = '#0058be'}
          onBlur={e => e.target.style.borderColor = '#e5e7eb'}
        />
      </Field>

      <Field label="Ubicación Geográfica" hint="Departamento, municipio o región de intervención.">
        <input
          style={inputStyle}
          value={data.ubicacion}
          onChange={e => update('ubicacion', e.target.value)}
          placeholder="Ej: Municipio de Tumaco, Nariño — Colombia"
          onFocus={e => e.target.style.borderColor = '#0058be'}
          onBlur={e => e.target.style.borderColor = '#e5e7eb'}
        />
      </Field>
    </div>
  );
}

// ── Paso 3: Objetivos y Resultados ─────────────────────────────────────────────
function StepObjetivos({ data, update }: { data: ProjectData; update: Function }) {
  const addObj = () => update('objetivosEspecificos', [...data.objetivosEspecificos, '']);
  const updObj = (i: number, v: string) => {
    const arr = [...data.objetivosEspecificos];
    arr[i] = v;
    update('objetivosEspecificos', arr);
  };
  const remObj = (i: number) => update('objetivosEspecificos', data.objetivosEspecificos.filter((_, idx) => idx !== i));

  const addRes = () => update('resultadosEsperados', [...data.resultadosEsperados, '']);
  const updRes = (i: number, v: string) => {
    const arr = [...data.resultadosEsperados];
    arr[i] = v;
    update('resultadosEsperados', arr);
  };
  const remRes = (i: number) => update('resultadosEsperados', data.resultadosEsperados.filter((_, idx) => idx !== i));

  return (
    <div>
      <Field label="Objetivo General" required hint="Propósito central del proyecto, medible y alcanzable.">
        <textarea
          style={{ ...textareaStyle, minHeight: 80 }}
          value={data.objetivoGeneral}
          onChange={e => update('objetivoGeneral', e.target.value)}
          placeholder="Ej: Mejorar el acceso a servicios de salud preventiva de 2.500 familias rurales..."
          onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#0058be'}
          onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#e5e7eb'}
        />
      </Field>

      <DynamicList
        label="Objetivos Específicos"
        items={data.objetivosEspecificos}
        placeholder="Ej: Capacitar 50 promotores de salud comunitarios..."
        onAdd={addObj} onUpdate={updObj} onRemove={remObj}
      />

      <DynamicList
        label="Resultados Esperados"
        items={data.resultadosEsperados}
        placeholder="Ej: 1.200 personas reciben atención preventiva anualmente..."
        onAdd={addRes} onUpdate={updRes} onRemove={remRes}
      />
    </div>
  );
}

// ── Paso 4: Marco Lógico ───────────────────────────────────────────────────────
function StepMarcoLogico({ data, update }: { data: ProjectData; update: Function }) {
  return (
    <div>
      <InfoBox icon="④" text="El marco lógico resume la lógica de intervención. Completa los campos con precisión para facilitar la evaluación del proyecto." />

      <Field label="Componentes / Actividades Principales" hint="Lista los componentes clave del proyecto (máx. 5).">
        <textarea
          style={textareaStyle}
          value={data.componenteMarco}
          onChange={e => update('componenteMarco', e.target.value)}
          placeholder="Componente 1: Fortalecimiento de capacidades comunitarias&#10;Componente 2: Dotación de equipos e infraestructura&#10;Componente 3: Sistema de monitoreo y seguimiento"
          onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#0058be'}
          onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#e5e7eb'}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <Field label="Indicadores de Resultado" hint="Métricas cuantitativas para medir el logro.">
          <textarea
            style={{ ...textareaStyle, minHeight: 90 }}
            value={data.indicadores}
            onChange={e => update('indicadores', e.target.value)}
            placeholder="Ej: # familias atendidas, % reducción de morbilidad..."
            onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#0058be'}
            onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#e5e7eb'}
          />
        </Field>
        <Field label="Medios de Verificación" hint="Fuentes de información para validar indicadores.">
          <textarea
            style={{ ...textareaStyle, minHeight: 90 }}
            value={data.mediosVerificacion}
            onChange={e => update('mediosVerificacion', e.target.value)}
            placeholder="Ej: Registros del SIVIGILA, actas de capacitación..."
            onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#0058be'}
            onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#e5e7eb'}
          />
        </Field>
      </div>

      <Field label="Supuestos y Riesgos" hint="Condiciones externas necesarias para el éxito del proyecto.">
        <textarea
          style={{ ...textareaStyle, minHeight: 80 }}
          value={data.supuestos}
          onChange={e => update('supuestos', e.target.value)}
          placeholder="Ej: Estabilidad presupuestal garantizada, disponibilidad del terreno, voluntad política local..."
          onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#0058be'}
          onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#e5e7eb'}
        />
      </Field>
    </div>
  );
}

// ── Paso 5: Presupuesto ────────────────────────────────────────────────────────
function StepPresupuesto({ data, update }: { data: ProjectData; update: Function }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <Field label="Monto Total (COP o USD)" required hint="Valor total del proyecto incluida contrapartida.">
          <input
            style={inputStyle}
            type="text"
            value={data.montoTotal}
            onChange={e => update('montoTotal', e.target.value)}
            placeholder="Ej: $ 450.000.000 COP"
            onFocus={e => e.target.style.borderColor = '#0058be'}
            onBlur={e => e.target.style.borderColor = '#e5e7eb'}
          />
        </Field>
        <Field label="Duración (meses)" required>
          <input
            style={inputStyle}
            type="number"
            value={data.duracionMeses}
            onChange={e => update('duracionMeses', e.target.value)}
            placeholder="Ej: 24"
            min={1} max={120}
            onFocus={e => e.target.style.borderColor = '#0058be'}
            onBlur={e => e.target.style.borderColor = '#e5e7eb'}
          />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <Field label="Fuente Principal de Financiamiento">
          <input
            style={inputStyle}
            value={data.fuenteFinanciamiento}
            onChange={e => update('fuenteFinanciamiento', e.target.value)}
            placeholder="Ej: BID — Banco Interamericano de Desarrollo"
            onFocus={e => e.target.style.borderColor = '#0058be'}
            onBlur={e => e.target.style.borderColor = '#e5e7eb'}
          />
        </Field>
        <Field label="Contrapartida Local" hint="Aporte propio de la entidad ejecutora.">
          <input
            style={inputStyle}
            value={data.contrapartida}
            onChange={e => update('contrapartida', e.target.value)}
            placeholder="Ej: $ 45.000.000 COP (10%)"
            onFocus={e => e.target.style.borderColor = '#0058be'}
            onBlur={e => e.target.style.borderColor = '#e5e7eb'}
          />
        </Field>
      </div>

      {/* Resumen del proyecto */}
      <ProjectSummary data={data} />
    </div>
  );
}

// ── Lista dinámica ──────────────────────────────────────────────────────────────
function DynamicList({
  label, items, placeholder, onAdd, onUpdate, onRemove,
}: {
  label: string; items: string[]; placeholder: string;
  onAdd: () => void; onUpdate: (i: number, v: string) => void; onRemove: (i: number) => void;
}) {
  return (
    <Field label={label}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <span style={{ width: 24, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontFamily: 'monospace', color: '#9ca3af', flexShrink: 0 }}>
            {i + 1}.
          </span>
          <input
            style={{ ...inputStyle, marginBottom: 0 }}
            value={item}
            onChange={e => onUpdate(i, e.target.value)}
            placeholder={placeholder}
            onFocus={e => e.target.style.borderColor = '#0058be'}
            onBlur={e => e.target.style.borderColor = '#e5e7eb'}
          />
          {items.length > 1 && (
            <button
              onClick={() => onRemove(i)}
              style={{ flexShrink: 0, width: 36, height: 40, background: '#fff', border: '1.5px solid #fee2e2', borderRadius: 8, color: '#dc2626', cursor: 'pointer', fontSize: 16 }}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        onClick={onAdd}
        style={{ marginTop: 4, padding: '7px 14px', background: '#f0f4ff', border: '1.5px dashed #93c5fd', borderRadius: 7, color: '#0058be', fontSize: 11, fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' }}
      >
        + Agregar
      </button>
    </Field>
  );
}

// ── Caja informativa ──────────────────────────────────────────────────────────
function InfoBox({ icon, text, action, href }: { icon: string; text: string; action?: string; href?: string }) {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', gap: 12, background: '#f0f4ff', border: '1px solid #dbeafe', borderRadius: 10, padding: '12px 16px', marginBottom: '1.5rem' }}>
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <p style={{ fontSize: 12, color: '#1d4ed8', fontFamily: 'system-ui', margin: 0, lineHeight: 1.55, flex: 1 }}>{text}</p>
      {action && href && (
        <button
          onClick={() => navigate(href)}
          style={{ flexShrink: 0, padding: '5px 10px', background: '#0058be', border: 'none', borderRadius: 5, color: '#fff', fontSize: 10, fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em', alignSelf: 'center' }}
        >
          {action}
        </button>
      )}
    </div>
  );
}

// ── Resumen final ──────────────────────────────────────────────────────────────
function ProjectSummary({ data }: { data: ProjectData }) {
  const fields = [
    { label: 'Título',         value: data.titulo           },
    { label: 'Sector',         value: data.sector           },
    { label: 'Entidad',        value: data.entidadConvocante},
    { label: 'Financiamiento', value: data.tipoFinanciamiento },
    { label: 'Monto',          value: data.montoTotal       },
    { label: 'Duración',       value: data.duracionMeses ? `${data.duracionMeses} meses` : '' },
  ].filter(f => f.value);

  if (!fields.length) return null;

  return (
    <div style={{ marginTop: '2rem', background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 12, padding: '1.5rem' }}>
      <p style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 1rem' }}>
        RESUMEN DEL PROYECTO
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        {fields.map(f => (
          <div key={f.label} style={{ padding: '10px 12px', background: '#f9fafb', borderRadius: 8 }}>
            <p style={{ fontSize: 9, fontFamily: 'monospace', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 3px' }}>{f.label}</p>
            <p style={{ fontSize: 13, color: '#191c1e', fontWeight: 600, margin: 0, fontFamily: 'system-ui' }}>{f.value}</p>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '1rem', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          style={{ padding: '8px 16px', background: '#f0f4ff', border: '1.5px solid #dbeafe', borderRadius: 7, color: '#0058be', fontSize: 11, fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' }}
          onClick={() => alert('Exportación a PDF / Word — próximamente disponible.')}
        >
          Exportar PDF
        </button>
        <button
          style={{ padding: '8px 16px', background: '#191c1e', border: 'none', borderRadius: 7, color: '#fff', fontSize: 11, fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' }}
          onClick={() => alert('Generación de documento — próximamente disponible.')}
        >
          Generar Propuesta
        </button>
      </div>
    </div>
  );
}

// ── Paso 6: M4 Motor Dialéctico ────────────────────────────────────────────────
const TONOS = [
  { value: 'formal',      label: 'Formal',      desc: 'Lenguaje institucional, protocolario y preciso' },
  { value: 'tecnico',     label: 'Técnico',      desc: 'Términos especializados y datos cuantitativos' },
  { value: 'comunitario', label: 'Comunitario',  desc: 'Cercano, participativo, lenguaje de base' },
  { value: 'academico',   label: 'Académico',    desc: 'Referenciado, con citas y marco teórico' },
  { value: 'normativo',   label: 'Normativo',    desc: 'Basado en marcos legales y regulatorios' },
];

function StepMotorDialectico({ data, update }: { data: ProjectData; update: Function }) {
  const [palabraOro, setPalabraOro]     = React.useState('');
  const [palabraNegra, setPalabraNegra] = React.useState('');

  const MAX_LISTA = 50;

  const addOro = () => {
    if (!palabraOro.trim()) return;
    if (data.listaOro.length >= MAX_LISTA) return;
    update('listaOro', [...data.listaOro, palabraOro.trim().slice(0, 120)]);
    setPalabraOro('');
  };
  const addNegra = () => {
    if (!palabraNegra.trim()) return;
    if (data.listaNegra.length >= MAX_LISTA) return;
    update('listaNegra', [...data.listaNegra, palabraNegra.trim().slice(0, 120)]);
    setPalabraNegra('');
  };
  const removeOro   = (i: number) => update('listaOro',   data.listaOro.filter((_: string, idx: number) => idx !== i));
  const removeNegra = (i: number) => update('listaNegra', data.listaNegra.filter((_: string, idx: number) => idx !== i));

  return (
    <div>
      <InfoBox icon="⑥" text="El Motor Dialéctico calibra el tono narrativo de toda la formulación y define los términos clave que el sistema deberá incluir u omitir al generar textos." />

      {/* Selector de tono */}
      <Field label="Tono de la Propuesta" required hint="Selecciona el registro lingüístico que mejor represente a tu organización ante la entidad convocante.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 10 }}>
          {TONOS.map(t => (
            <button
              key={t.value}
              onClick={() => update('tono', t.value)}
              style={{
                padding: '12px 14px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                border: `2px solid ${data.tono === t.value ? '#0058be' : '#e5e7eb'}`,
                background: data.tono === t.value ? '#f0f4ff' : '#fff',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <p style={{ fontSize: 12, fontWeight: 700, color: data.tono === t.value ? '#0058be' : '#191c1e', margin: '0 0 3px', fontFamily: 'monospace' }}>
                {t.label}
              </p>
              <p style={{ fontSize: 11, color: '#76777d', margin: 0, fontFamily: 'system-ui', lineHeight: 1.4 }}>
                {t.desc}
              </p>
            </button>
          ))}
        </div>
      </Field>

      {/* Énfasis narrativo */}
      <Field label="Énfasis narrativo" hint="Aspecto que la propuesta debe destacar por encima de los demás.">
        <input
          style={inputStyle}
          value={data.enfasis}
          onChange={e => update('enfasis', e.target.value)}
          placeholder="Ej: impacto comunitario medible, innovación tecnológica, enfoque diferencial..."
          onFocus={e => e.target.style.borderColor = '#0058be'}
          onBlur={e => e.target.style.borderColor = '#e5e7eb'}
        />
      </Field>

      {/* Lista Oro */}
      <Field label="Lista Oro — términos a INCLUIR" hint="Palabras clave, frases o conceptos que deben aparecer en la propuesta.">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            style={{ ...inputStyle, marginBottom: 0 }}
            value={palabraOro}
            onChange={e => setPalabraOro(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addOro()}
            placeholder="Escribe y presiona Enter o el botón +"
            onFocus={e => e.target.style.borderColor = '#16a34a'}
            onBlur={e => e.target.style.borderColor = '#e5e7eb'}
          />
          <button
            onClick={addOro}
            disabled={data.listaOro.length >= MAX_LISTA}
            title={data.listaOro.length >= MAX_LISTA ? `Máximo ${MAX_LISTA} términos` : 'Agregar'}
            style={{ flexShrink: 0, padding: '0 16px', background: data.listaOro.length >= MAX_LISTA ? '#9ca3af' : '#16a34a', border: 'none', borderRadius: 8, color: '#fff', fontSize: 18, cursor: data.listaOro.length >= MAX_LISTA ? 'not-allowed' : 'pointer' }}>+</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {data.listaOro.map((t: string, i: number) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#dcfce7', color: '#15803d', border: '1px solid #86efac', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontFamily: 'monospace' }}>
              {t}
              <button onClick={() => removeOro(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#15803d', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
            </span>
          ))}
          {data.listaOro.length === 0 && <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Sin términos aún</span>}
        </div>
      </Field>

      {/* Lista Negra */}
      <Field label="Lista Negra — términos a EVITAR" hint="Palabras, jergas o conceptos que deben omitirse por ser inapropiados para esta convocatoria.">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            style={{ ...inputStyle, marginBottom: 0 }}
            value={palabraNegra}
            onChange={e => setPalabraNegra(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addNegra()}
            placeholder="Escribe y presiona Enter o el botón +"
            onFocus={e => e.target.style.borderColor = '#dc2626'}
            onBlur={e => e.target.style.borderColor = '#e5e7eb'}
          />
          <button
            onClick={addNegra}
            disabled={data.listaNegra.length >= MAX_LISTA}
            title={data.listaNegra.length >= MAX_LISTA ? `Máximo ${MAX_LISTA} términos` : 'Agregar'}
            style={{ flexShrink: 0, padding: '0 16px', background: data.listaNegra.length >= MAX_LISTA ? '#9ca3af' : '#dc2626', border: 'none', borderRadius: 8, color: '#fff', fontSize: 18, cursor: data.listaNegra.length >= MAX_LISTA ? 'not-allowed' : 'pointer' }}>+</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {data.listaNegra.map((t: string, i: number) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontFamily: 'monospace' }}>
              {t}
              <button onClick={() => removeNegra(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
            </span>
          ))}
          {data.listaNegra.length === 0 && <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Sin términos aún</span>}
        </div>
      </Field>
    </div>
  );
}

// ── Paso 7: M10 Compliance ─────────────────────────────────────────────────────
const ODS_LIST = [
  { n: 1,  label: 'Fin de la pobreza' },        { n: 2,  label: 'Hambre cero' },
  { n: 3,  label: 'Salud y bienestar' },         { n: 4,  label: 'Educación de calidad' },
  { n: 5,  label: 'Igualdad de género' },        { n: 6,  label: 'Agua limpia' },
  { n: 7,  label: 'Energía asequible' },         { n: 8,  label: 'Trabajo decente' },
  { n: 9,  label: 'Industria e innovación' },    { n: 10, label: 'Reducción desigualdades' },
  { n: 11, label: 'Ciudades sostenibles' },      { n: 12, label: 'Producción responsable' },
  { n: 13, label: 'Acción por el clima' },       { n: 14, label: 'Vida submarina' },
  { n: 15, label: 'Vida de ecosistemas' },       { n: 16, label: 'Paz y justicia' },
  { n: 17, label: 'Alianzas para los ODS' },
];

function StepCompliance({
  data, update, proyectoId, token, sector, municipio,
}: {
  data: ProjectData; update: Function;
  proyectoId: string | null; token: string | null;
  sector: string; municipio: string;
}) {
  const [generandoNormas, setGenerandoNormas] = React.useState(false);
  const [normasGeneradas, setNormasGeneradas] = React.useState<any[]>([]);
  const [normasError, setNormasError]         = React.useState<string | null>(null);

  const toggleOds = (n: number) => {
    const curr = data.odsAlineados;
    update('odsAlineados', curr.includes(n) ? curr.filter((x: number) => x !== n) : [...curr, n]);
  };

  const generarNormas = async () => {
    if (!proyectoId) { setNormasError('Guarda el proyecto primero para generar el marco normativo.'); return; }
    setGenerandoNormas(true);
    setNormasError(null);
    try {
      const r = await fetch('/api/m8/normas/generar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ proyecto_id: proyectoId, sector, municipio }),
      });
      const d = await r.json();
      if (d.success) setNormasGeneradas(d.data?.normas_aplicables || []);
      else setNormasError(d.message || 'Error generando normas');
    } catch {
      setNormasError('Sin conexión con el servidor');
    } finally {
      setGenerandoNormas(false);
    }
  };

  return (
    <div>
      <InfoBox icon="⑦" text="El módulo de Compliance valida la sostenibilidad del proyecto, alinea los ODS y genera el Marco Normativo aplicable según sector y territorio." />

      {/* Sostenibilidad ambiental */}
      <Field label="Sostenibilidad Ambiental" hint="¿Cómo garantiza el proyecto un impacto ambiental neutro o positivo?">
        <textarea
          style={textareaStyle}
          value={data.sostenibilidadAmbiental}
          onChange={e => update('sostenibilidadAmbiental', e.target.value)}
          placeholder="Ej: El proyecto implementará prácticas de manejo de residuos, plantación de especies nativas y reducción de emisiones..."
          onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#16a34a'}
          onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#e5e7eb'}
        />
      </Field>

      {/* Sostenibilidad social */}
      <Field label="Sostenibilidad Social" hint="¿Cómo asegura el proyecto continuidad e impacto social más allá del período de financiación?">
        <textarea
          style={textareaStyle}
          value={data.sostenibilidadSocial}
          onChange={e => update('sostenibilidadSocial', e.target.value)}
          placeholder="Ej: Se formarán comités comunitarios de veeduría, se transferirán capacidades locales y se firmará acuerdo de continuidad..."
          onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#0058be'}
          onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#e5e7eb'}
        />
      </Field>

      {/* Enfoque de género */}
      <Field label="Enfoque Diferencial de Género">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: data.enfoqueGenero ? 12 : 0 }}>
          <button
            onClick={() => update('enfoqueGenero', !data.enfoqueGenero)}
            style={{
              width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
              background: data.enfoqueGenero ? '#0058be' : '#e5e7eb', position: 'relative', flexShrink: 0,
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 3, transition: 'left 0.2s',
              left: data.enfoqueGenero ? 23 : 3,
            }} />
          </button>
          <span style={{ fontSize: 13, color: '#374151', fontFamily: 'system-ui' }}>
            Este proyecto incorpora enfoque de género
          </span>
        </div>
        {data.enfoqueGenero && (
          <textarea
            style={{ ...textareaStyle, minHeight: 80 }}
            value={data.enfoqueGeneroTexto}
            onChange={e => update('enfoqueGeneroTexto', e.target.value)}
            placeholder="Describe cómo se incorpora la perspectiva de género en el diseño, ejecución y evaluación del proyecto..."
            onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#0058be'}
            onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#e5e7eb'}
          />
        )}
      </Field>

      {/* ODS */}
      <Field label="ODS Alineados" hint="Selecciona los Objetivos de Desarrollo Sostenible con los que se alinea este proyecto.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ODS_LIST.map(ods => {
            const active = data.odsAlineados.includes(ods.n);
            return (
              <button
                key={ods.n}
                onClick={() => toggleOds(ods.n)}
                title={ods.label}
                style={{
                  padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 12,
                  fontFamily: 'monospace', fontWeight: 700, border: '2px solid',
                  borderColor: active ? '#0058be' : '#e5e7eb',
                  background: active ? '#f0f4ff' : '#fff',
                  color: active ? '#0058be' : '#9ca3af',
                  transition: 'all 0.15s',
                }}
              >
                ODS {ods.n}
              </button>
            );
          })}
        </div>
        {data.odsAlineados.length > 0 && (
          <p style={{ fontSize: 11, color: '#0058be', marginTop: 8, fontFamily: 'system-ui' }}>
            {data.odsAlineados.sort((a: number, b: number) => a - b).map((n: number) => ODS_LIST.find(o => o.n === n)?.label).join(' · ')}
          </p>
        )}
      </Field>

      {/* Marco normativo */}
      <Field label="M8 — Marco Normativo Aplicable" hint="Genera automáticamente las normas y citas bibliográficas obligatorias según el sector y municipio del proyecto.">
        <button
          onClick={generarNormas}
          disabled={generandoNormas}
          style={{
            padding: '9px 18px', background: generandoNormas ? '#e5e7eb' : '#191c1e',
            border: 'none', borderRadius: 8, color: generandoNormas ? '#9ca3af' : '#fff',
            fontSize: 11, fontFamily: 'monospace', fontWeight: 700, cursor: generandoNormas ? 'not-allowed' : 'pointer',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}
        >
          {generandoNormas ? 'Generando normas...' : '⚖ Generar Marco Normativo'}
        </button>
        {normasError && <p style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>{normasError}</p>}
        {normasGeneradas.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {normasGeneradas.map((n: any, i: number) => (
              <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#191c1e', margin: '0 0 3px', fontFamily: 'monospace' }}>{n.codigo}</p>
                  <span style={{
                    fontSize: 9, fontFamily: 'monospace', fontWeight: 700, padding: '2px 8px', borderRadius: 20, textTransform: 'uppercase',
                    background: n.relevancia === 'Alta' ? '#fef2f2' : '#f0f4ff',
                    color: n.relevancia === 'Alta' ? '#dc2626' : '#0058be',
                    border: `1px solid ${n.relevancia === 'Alta' ? '#fca5a5' : '#bfdbfe'}`,
                  }}>
                    {n.relevancia}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: '#374151', margin: '0 0 2px', fontFamily: 'system-ui' }}>{n.nombre}</p>
                <p style={{ fontSize: 11, color: '#9ca3af', margin: 0, fontFamily: 'monospace' }}>Arts: {n.articulos}</p>
              </div>
            ))}
          </div>
        )}
      </Field>
    </div>
  );
}

// ── Paso 8: M12 — Ficha Técnica Maestra (Sello SHA-256) ───────────────────────
function StepFichaTecnica({
  data, proyectoId, token, onSealSuccess,
}: { data: ProjectData; proyectoId: string | null; token: string | null; onSealSuccess?: () => void }) {
  const [generando, setGenerando]       = React.useState(false);
  const [sello, setSello]               = React.useState<any>(null);
  const [historial, setHistorial]       = React.useState<any[]>([]);
  const [error, setError]               = React.useState<string | null>(null);
  const [copiado, setCopiado]           = React.useState(false);

  React.useEffect(() => {
    if (!proyectoId || !token || token === 'demo-mode-token') return;
    fetch(`/api/m12/ficha/${proyectoId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.success) setHistorial(d.data || []); })
      .catch(() => {});
  }, [proyectoId, token]);

  const generarSello = async () => {
    if (!proyectoId) { setError('Guarda el proyecto primero (pasos 1-7) antes de generar el sello.'); return; }
    if (!token || token === 'demo-mode-token') { setError('Inicia sesión real para generar el sello.'); return; }
    setGenerando(true); setError(null);
    try {
      const r = await fetch(`/api/m12/ficha/${proyectoId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (d.success) {
        setSello(d.data);
        setHistorial(prev => [d.data, ...prev]);
        onSealSuccess?.();
      } else {
        setError(d.message || 'Error generando sello');
      }
    } catch { setError('Sin conexión con el servidor'); }
    finally { setGenerando(false); }
  };

  const copiar = (hash: string) => {
    navigator.clipboard.writeText(hash).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); });
  };

  return (
    <div>
      <InfoBox icon="⑧" text="La Ficha Técnica Maestra genera un sello SHA-256 inmutable que certifica el estado completo del proyecto. Cada versión sellada queda registrada en el historial de auditoría." />

      {/* Resumen del proyecto */}
      <div style={{ background: '#f9fafb', border: '1.5px solid #e5e7eb', borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem' }}>
        <p style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 10px' }}>RESUMEN A SELLAR</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { l: 'Proyecto',  v: data.titulo || '—' },
            { l: 'Sector',    v: data.sector  || '—' },
            { l: 'Tono M4',   v: data.tono    || '—' },
            { l: 'ODS',       v: data.odsAlineados.length ? `${data.odsAlineados.length} alineados` : '—' },
            { l: 'Monto',     v: data.montoTotal  || '—' },
            { l: 'Duración',  v: data.duracionMeses ? `${data.duracionMeses} meses` : '—' },
          ].map(f => (
            <div key={f.l} style={{ padding: '8px 10px', background: '#fff', borderRadius: 7 }}>
              <p style={{ fontSize: 9, fontFamily: 'monospace', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 2px' }}>{f.l}</p>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#191c1e', margin: 0, fontFamily: 'system-ui', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Botón generar sello */}
      <button
        onClick={generarSello}
        disabled={generando}
        style={{
          width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: generando ? 'not-allowed' : 'pointer',
          background: generando ? '#e5e7eb' : 'linear-gradient(135deg,#191c1e,#374151)',
          color: generando ? '#9ca3af' : '#fff', fontSize: 13, fontFamily: 'monospace',
          fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '1.5rem',
        }}
      >
        {generando ? 'Generando sello SHA-256...' : '🔒 Generar Ficha Técnica Maestra (SHA-256)'}
      </button>

      {error && <p style={{ color: '#dc2626', fontSize: 12, marginBottom: '1rem', fontFamily: 'system-ui' }}>{error}</p>}

      {/* Sello actual */}
      {sello && (
        <div style={{ background: '#f0fdf4', border: '2px solid #86efac', borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <p style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 4px' }}>
                ✓ SELLO GENERADO — V{sello.version_num}
              </p>
              <p style={{ fontSize: 11, color: '#166534', margin: 0, fontFamily: 'system-ui' }}>{sello.firmado_en}</p>
            </div>
            <button
              onClick={() => copiar(sello.hash_sha256)}
              style={{ padding: '5px 12px', background: '#16a34a', border: 'none', borderRadius: 6, color: '#fff', fontSize: 10, fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer' }}
            >
              {copiado ? '✓ COPIADO' : 'COPIAR'}
            </button>
          </div>
          <code style={{ fontSize: 10, fontFamily: 'monospace', color: '#15803d', wordBreak: 'break-all', lineHeight: 1.6, display: 'block', background: '#dcfce7', padding: '8px 10px', borderRadius: 6 }}>
            {sello.hash_sha256}
          </code>
        </div>
      )}

      {/* Historial de versiones */}
      {historial.length > 0 && (
        <div>
          <p style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.15em', margin: '0 0 10px' }}>
            HISTORIAL DE VERSIONES
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {historial.map((v: any) => (
              <div key={v.id} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#191c1e', margin: '0 0 2px', fontFamily: 'monospace' }}>V{v.version_num}</p>
                  <p style={{ fontSize: 10, color: '#9ca3af', margin: 0, fontFamily: 'system-ui' }}>{v.firmado_en}</p>
                </div>
                <code style={{ fontSize: 9, fontFamily: 'monospace', color: '#6b7280', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.hash_sha256?.slice(0, 20)}…
                </code>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Verificación de completitud de pasos ──────────────────────────────────────
function isStepComplete(stepId: number, data: ProjectData): boolean {
  switch (stepId) {
    case 1: return !!(data.titulo && data.sector);
    case 2: return !!(data.problema && data.poblacionObjetivo);
    case 3: return !!(data.objetivoGeneral && data.objetivosEspecificos.some(o => o.trim()));
    case 4: return !!(data.componenteMarco);
    case 5: return !!(data.montoTotal && data.duracionMeses);
    case 6: return !!(data.tono);
    case 7: return !!(data.sostenibilidadAmbiental || data.odsAlineados.length > 0);
    case 8: return false; // Se completa al generar el sello
    default: return false;
  }
}
