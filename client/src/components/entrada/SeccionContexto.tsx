import type { Dispatch, SetStateAction } from 'react';
import {
  CONTEXTO_CAMPOS, ALERTA_ND, ND_INVESTIGACION, OPCIONES_TIPO_FORMULACION, MODALIDAD_INTEGRAL,
  estaDesbloqueado, campoCDesbloqueado, campoCCompleto, calcularPorcentajeC4,
  type EntradaState,
} from './entradaModelo';
import AlertaIA, { type AvisoIA } from './AlertaIA';

// Sección 10 "Contexto del Problema" — JSX copiado literal de
// pages/EntradaPage.tsx. Los campos A,B y D,E,F,G tenían JSX idéntico y ahora
// comparten CampoContextoTexto; el Campo C (5 sub-campos) vive en CampoCMeta.
type SetSt = Dispatch<SetStateAction<EntradaState>>;
type CampoDef = (typeof CONTEXTO_CAMPOS)[number];

interface PropsCampo {
  c: CampoDef;
  index: number;
  st: EntradaState;
  setSt: SetSt;
  bloqueado: boolean;
  cuotaAgotada: boolean;
  generandoCampo: string | null;
  voiceField: string | null;
  onToggleBloqueo: (id: string) => void;
  onGenerar: (id: string) => void;
  onToggleVoz: (id: string) => void;
}

function CampoContextoTexto({ c, index, st, setSt, bloqueado, cuotaAgotada, generandoCampo, voiceField, onToggleBloqueo, onGenerar, onToggleVoz }: PropsCampo) {
  const desbloqueado = estaDesbloqueado(index, st.contexto, campoCCompleto(st.contextoMeta));
  return (
    <div>
      <label className="entr__field-label" htmlFor={`entr-${c.id}`}>{c.label}</label>
      <div className="entr__textarea-wrap">
        <textarea
          id={`entr-${c.id}`}
          className={`entr__textarea entr__textarea--con-candado${st.contexto[c.id] === ALERTA_ND ? ' entr__textarea--alerta' : ''}`}
          rows={1}
          placeholder={c.ph}
          value={st.contexto[c.id] || ''}
          disabled={!desbloqueado || bloqueado}
          onChange={e => setSt(p => ({ ...p, contexto: { ...p.contexto, [c.id]: e.target.value } }))}
        />
        <button
          type="button"
          className={`entr__lock-btn${bloqueado ? ' entr__lock-btn--locked' : ''}`}
          disabled={!desbloqueado}
          onClick={() => onToggleBloqueo(c.id)}
          title={bloqueado ? 'Desbloquear campo' : 'Bloquear campo (protege el texto contra edición o regeneración con IA)'}
        >
          <span className="material-symbols-outlined">{bloqueado ? 'lock' : 'lock_open'}</span>
        </button>
        <button
          type="button"
          className={`entr__ai-btn-sm${cuotaAgotada ? ' entr__ai-btn-sm--cooldown' : ''}`}
          disabled={!desbloqueado || bloqueado || generandoCampo === c.id}
          onClick={() => onGenerar(c.id)}
          title="Generar con IA (lee Anexos/Investigación)"
        >
          <span className="material-symbols-outlined">{generandoCampo === c.id ? 'progress_activity' : 'auto_awesome'}</span>
        </button>
        <button
          type="button"
          className={`entr__mic${voiceField === c.id ? ' entr__mic--on' : ''}`}
          disabled={!desbloqueado || bloqueado}
          onClick={() => onToggleVoz(c.id)}
          title={voiceField === c.id ? 'Detener grabación' : 'Dictar con micrófono'}
        >
          <span className="material-symbols-outlined">
            {voiceField === c.id ? 'mic_off' : 'mic'}
          </span>
        </button>
      </div>
    </div>
  );
}

interface PropsCampoC {
  st: EntradaState;
  setSt: SetSt;
  cuotaAgotada: boolean;
  generandoCampo: string | null;
  onRecargarProblematicas: () => void;
}

function CampoCMeta({ st, setSt, cuotaAgotada, generandoCampo, onRecargarProblematicas }: PropsCampoC) {
  return (
    <div>
      <label className="entr__field-label" htmlFor="entr-campo-c-problema">C. META ESPERADA — PROBLEMÁTICA, DÉFICIT Y COBERTURA</label>
      <div className="entr__campo-c-grid">
        <select
          id="entr-campo-c-problema"
          className="entr__campo-c-select"
          disabled={!campoCDesbloqueado(st.contexto)}
          value={st.contextoMeta.problemaSeleccionado}
          onChange={e => setSt(p => ({
            ...p,
            // FIX (2026-08-24, pedido explícito con captura): cambiar
            // de problemática borra Beneficiarios — los beneficiarios
            // de un déficit de acueducto no pueden seguir puestos al
            // cambiar a un déficit de infraestructura educativa (ej.
            // el bug reportado: 100 beneficiarios sobre un déficit de
            // 4 aulas = 2500%). En modalidad "Proyecto Integral" esto
            // no deja el campo vacío de verdad: el efecto de
            // autocompletado de arriba lo vuelve a llenar de inmediato
            // con el déficit de la problemática nueva.
            contextoMeta: { ...p.contextoMeta, problemaSeleccionado: e.target.value, beneficiarios: '' },
          }))}
          title="C1 — Problemática detectada por IA en Anexos/Investigación"
        >
          <option value="">{generandoCampo === 'C1' ? 'Cargando problemáticas…' : 'Selecciona una problemática…'}</option>
          {st.contextoMeta.problematicas.map(p => (
            <option key={p.problema} value={p.problema}>{p.problema}</option>
          ))}
        </select>
        <div
          className="entr__campo-c-readonly"
          title="C2 — Déficit total asociado a la problemática elegida (automático, no editable)"
        >
          {(() => {
            const sel = st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado);
            if (!sel) return '—';
            return sel.deficit_valor !== null ? `${sel.deficit_valor} ${sel.deficit_unidad || ''}`.trim() : ND_INVESTIGACION;
          })()}
        </div>
        {(() => {
          const sel = st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado);
          const autoIntegral = st.contextoMeta.tipoFormulacion === MODALIDAD_INTEGRAL && (sel?.deficit_valor ?? null) !== null;
          return (
            <input
              className="entr__campo-c-input"
              type="number"
              placeholder="Beneficiarios"
              aria-label="Número de beneficiarios"
              title={autoIntegral
                ? 'C3 — Beneficiarios (automático: igual al déficit total en modalidad "Proyecto Integral")'
                : 'C3 — Beneficiarios (hereda de Sección 06, editable)'}
              disabled={!campoCDesbloqueado(st.contexto) || autoIntegral}
              value={st.contextoMeta.beneficiarios}
              onChange={e => setSt(p => ({ ...p, contextoMeta: { ...p.contextoMeta, beneficiarios: e.target.value } }))}
            />
          );
        })()}
        <select
          className="entr__campo-c-select"
          disabled={!campoCDesbloqueado(st.contexto)}
          value={st.contextoMeta.tipoFormulacion}
          onChange={e => {
            const nuevoTipo = e.target.value;
            // FIX (2026-08-24, pedido explícito con captura): elegir
            // Piloto o Etapas borra Beneficiarios para que el usuario
            // lo escriba a mano — decisión confirmada explícitamente:
            // "Proyecto Integral" NO entra aquí, sigue autocompletando
            // con el déficit (efecto de arriba, sin tocar este cambio).
            const debeBorrarBeneficiarios = nuevoTipo === OPCIONES_TIPO_FORMULACION[1] || nuevoTipo === OPCIONES_TIPO_FORMULACION[2];
            setSt(p => ({
              ...p,
              contextoMeta: {
                ...p.contextoMeta,
                tipoFormulacion: nuevoTipo,
                beneficiarios: debeBorrarBeneficiarios ? '' : p.contextoMeta.beneficiarios,
              },
            }));
          }}
          title="Modalidad de formulación — contexto para la IA al redactar Justificación (D) y Análisis Sociocultural (E)"
        >
          {OPCIONES_TIPO_FORMULACION.map(op => (
            <option key={op} value={op}>{op}</option>
          ))}
        </select>
        <div className="entr__campo-c-readonly" title="C4 — % Beneficiarios/Déficit, calculado en JS puro (cero IA)">
          {calcularPorcentajeC4(
            st.contextoMeta.beneficiarios,
            st.contextoMeta.problematicas.find(p => p.problema === st.contextoMeta.problemaSeleccionado)?.deficit_valor ?? null
          )}
        </div>
      </div>
      {campoCDesbloqueado(st.contexto) && (
        <button
          type="button"
          onClick={onRecargarProblematicas}
          disabled={generandoCampo === 'C1'}
          style={{ marginTop: 6, background: 'none', border: 'none', color: cuotaAgotada ? '#b45309' : '#7c3aed', fontSize: 11, cursor: generandoCampo === 'C1' ? 'default' : 'pointer', padding: 0 }}
        >
          {generandoCampo === 'C1' ? 'Cargando…' : '🔄 Volver a leer Anexos/Investigación'}
        </button>
      )}
    </div>
  );
}

interface PropsSeccion {
  st: EntradaState;
  setSt: SetSt;
  aviso: AvisoIA;
  cuotaAgotada: boolean;
  generandoCampo: string | null;
  voiceField: string | null;
  campoBloqueado: (id: string) => boolean;
  onToggleBloqueo: (id: string) => void;
  onGenerar: (id: string) => void;
  onToggleVoz: (id: string) => void;
  onRecargarProblematicas: () => void;
}

export default function SeccionContexto(props: PropsSeccion) {
  const { st, setSt, aviso, cuotaAgotada, generandoCampo, voiceField, campoBloqueado, onToggleBloqueo, onGenerar, onToggleVoz, onRecargarProblematicas } = props;
  const campo = (c: CampoDef, index: number) => (
    <CampoContextoTexto
      key={c.id} c={c} index={index} st={st} setSt={setSt} bloqueado={campoBloqueado(c.id)}
      cuotaAgotada={cuotaAgotada} generandoCampo={generandoCampo} voiceField={voiceField}
      onToggleBloqueo={onToggleBloqueo} onGenerar={onGenerar} onToggleVoz={onToggleVoz}
    />
  );
  return (
    <div className="entr__card" id="sec-contexto">
      <div className="entr__card-header">
        <span className="entr__step-badge">10</span>
        <h2 className="entr__section-heading">Contexto del Problema</h2>
      </div>
      <AlertaIA aviso={aviso} variante="bloque" />
      <p className="entr__section-hint">Caracterice la situación problemática que el proyecto busca resolver — complete cada paso en orden; el siguiente se habilita al llenar el actual.</p>
      <div className="entr__context-list">
        {/* A, B */}
        {CONTEXTO_CAMPOS.slice(0, 2).map((c, i) => campo(c, i))}

        {/* Campo C — 5 sub-campos interconectados (Problemática, Déficit,
            Beneficiarios, Tipo de formulación, % Calculado) */}
        <CampoCMeta st={st} setSt={setSt} cuotaAgotada={cuotaAgotada} generandoCampo={generandoCampo} onRecargarProblematicas={onRecargarProblematicas} />

        {/* D, E, F, G */}
        {CONTEXTO_CAMPOS.slice(2).map((c, i) => campo(c, i + 2))}
      </div>
    </div>
  );
}
