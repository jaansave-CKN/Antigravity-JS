import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

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
}

const INITIAL: ProjectData = {
  titulo: '', sector: '', tipoFinanciamiento: '', entidadConvocante: '',
  problema: '', poblacionObjetivo: '', ubicacion: '',
  objetivoGeneral: '', objetivosEspecificos: [''], resultadosEsperados: [''],
  componenteMarco: '', indicadores: '', mediosVerificacion: '', supuestos: '',
  montoTotal: '', duracionMeses: '', fuenteFinanciamiento: '', contrapartida: '',
};

const STEPS = [
  { id: 1, key: 'info',      label: 'Información General',    icon: '①', short: 'General'   },
  { id: 2, key: 'problema',  label: 'Problema y Contexto',    icon: '②', short: 'Problema'  },
  { id: 3, key: 'objetivos', label: 'Objetivos y Resultados', icon: '③', short: 'Objetivos' },
  { id: 4, key: 'marco',     label: 'Marco Lógico',           icon: '④', short: 'Marco'     },
  { id: 5, key: 'pres',      label: 'Presupuesto',            icon: '⑤', short: 'Presupuesto'},
] as const;

const SECTORES = ['Salud', 'Educación', 'Infraestructura', 'Medio Ambiente', 'Desarrollo Rural', 'Tecnología', 'Cultura', 'Seguridad', 'Otro'];
const TIPOS_FIN = ['Subvención', 'Crédito blando', 'Cooperación técnica', 'Fondo reembolsable', 'Cofinanciación', 'Otro'];

// ── Página principal ──────────────────────────────────────────────────────────
export default function FormuladorPage() {
  const navigate                      = useNavigate();
  const { token }                     = useAuth();
  const [step, setStep]               = useState(1);
  const [data, setData]               = useState<ProjectData>(INITIAL);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [proyectoId, setProyectoId]   = useState<string | null>(null);
  const [saveError, setSaveError]     = useState<string | null>(null);

  const update = useCallback(<K extends keyof ProjectData>(key: K, value: ProjectData[K]) => {
    setData(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);

    // Modo demo: simulación visual sin persistencia real
    if (!token || token === 'demo-mode-token') {
      await new Promise(r => setTimeout(r, 400));
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      return;
    }

    try {
      const res = await fetch('/api/formulador/proyectos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id:         proyectoId,
          titulo:     data.titulo || 'Borrador sin título',
          sector:     data.sector,
          datos_json: data,
          progreso:   progress,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.id) setProyectoId(json.id);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const err = await res.json().catch(() => ({}));
        setSaveError(err.message || 'Error al guardar');
      }
    } catch {
      setSaveError('Sin conexión con el servidor');
    } finally {
      setSaving(false);
    }
  };

  const completedSteps = STEPS.filter(s => isStepComplete(s.id, data)).map(s => s.id);
  const progress = Math.round((completedSteps.length / STEPS.length) * 100);

  return (
    <div style={{ minHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', background: '#f7f9fb' }}>

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
          {saveError && (
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#fca5a5', maxWidth: 180 }}>
              ⚠ {saveError}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: saveError ? '#7f1d1d' : saved ? '#14532d' : '#0058be',
              border: 'none', borderRadius: 6, padding: '7px 16px',
              color: '#fff', fontSize: 11, fontFamily: 'monospace', fontWeight: 700,
              cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase',
              opacity: saving ? 0.7 : 1, transition: 'background 0.2s',
            }}
          >
            {saving ? 'GUARDANDO...' : saved ? '✓ GUARDADO' : saveError ? 'REINTENTAR' : 'GUARDAR BORRADOR'}
          </button>
        </div>
      </div>

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
                style={{ padding: '9px 24px', background: '#191c1e', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12, fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase' }}
              >
                ✓ Finalizar y guardar
              </button>
            )}
          </div>
        </main>
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

// ── Verificación de completitud de pasos ──────────────────────────────────────
function isStepComplete(stepId: number, data: ProjectData): boolean {
  switch (stepId) {
    case 1: return !!(data.titulo && data.sector);
    case 2: return !!(data.problema && data.poblacionObjetivo);
    case 3: return !!(data.objetivoGeneral && data.objetivosEspecificos.some(o => o.trim()));
    case 4: return !!(data.componenteMarco);
    case 5: return !!(data.montoTotal && data.duracionMeses);
    default: return false;
  }
}
