import type { Dispatch, SetStateAction } from 'react';
import {
  ENFOQUES, TIPOS_CONVOCATORIA, NIVELES_PROYECTO, METODOLOGIAS, METODOLOGIA_OBLIGATORIA, FORMATO_FINANCIADOR,
  type EntradaState,
} from './entradaModelo';

// Secciones 01 (Tipo de Proyecto), 02 (Fuente de Financiación) y 03/04/05
// (Nivel · Metodologías · Formato) — JSX copiado literal de pages/EntradaPage.tsx.
type SetSt = Dispatch<SetStateAction<EntradaState>>;

export function SeccionEnfoque({ st, setSt }: { st: EntradaState; setSt: SetSt }) {
  return (
    <div className="entr__card" id="sec-enfoque">
      <div className="entr__card-header">
        <span className="entr__step-badge">01</span>
        <h2 className="entr__section-heading entr__section-heading--title">Tipo de Proyecto</h2>
      </div>
      <div className="entr__enfoque-cards">
        {ENFOQUES.map(e => (
          <label
            key={e.label}
            className={`entr__enfoque-card${st.enfoque === e.label ? ' entr__enfoque-card--on' : ''}`}
          >
            <input type="radio" name="enfoque" checked={st.enfoque === e.label}
              onChange={() => setSt(p => ({ ...p, enfoque: e.label }))} />
            <span className="material-symbols-outlined">{e.icon}</span>
            {e.label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function SeccionTipoConvocatoria({ st, setSt }: { st: EntradaState; setSt: SetSt }) {
  return (
    <div className="entr__card" id="sec-tipo">
      <div className="entr__card-header">
        <span className="entr__step-badge">02</span>
        <h2 className="entr__section-heading">Fuente de Financiación</h2>
      </div>
      <div className="entr__tipo-grid">
        {TIPOS_CONVOCATORIA.map(tc => (
          <label
            key={tc.label}
            className={`entr__tipo-card${st.tipoConvocatoria === tc.label ? ' entr__tipo-card--on' : ''}`}
          >
            <input type="radio" name="tipoconv" checked={st.tipoConvocatoria === tc.label}
              onChange={() => setSt(p => ({ ...p, tipoConvocatoria: tc.label }))} />
            <span className="material-symbols-outlined">{tc.icon}</span>
            {tc.label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function SeccionNivelMetodologiaFormato({ st, setSt, toggleMetodologia }: { st: EntradaState; setSt: SetSt; toggleMetodologia: (m: string) => void }) {
  return (
    <div className="entr__card" id="sec-nivel-metodologias-formato">
      <div className="entr__combo3-grid">

        {/* 03 Nivel del Proyecto */}
        <div className="entr__combo3-col">
          <div className="entr__card-header">
            <span className="entr__step-badge">03</span>
            <h2 className="entr__section-heading">Nivel del Proyecto</h2>
          </div>
          <p className="entr__section-hint">Etapa de maduración del proyecto.</p>
          <div className="entr__combo3-list">
            {NIVELES_PROYECTO.map(n => (
              <label
                key={n.label}
                className={`entr__radio-row${st.nivelProyecto === n.label ? ' entr__radio-row--on' : ''}`}
              >
                <input type="radio" name="nivelproyecto" checked={st.nivelProyecto === n.label}
                  onChange={() => setSt(p => ({ ...p, nivelProyecto: n.label }))} />
                {n.label}
              </label>
            ))}
          </div>
        </div>

        {/* 04 Metodologías */}
        <div className="entr__combo3-col">
          <div className="entr__card-header">
            <span className="entr__step-badge">04</span>
            <h2 className="entr__section-heading">Metodologías</h2>
          </div>
          <p className="entr__section-hint">Marco Lógico viene preseleccionado por defecto.</p>
          <div className="entr__combo3-list">
            {METODOLOGIAS.map(m => {
              const esObligatoria = m === METODOLOGIA_OBLIGATORIA;
              return (
                <label
                  key={m}
                  className={`entr__check-row${st.metodologias.includes(m) ? ' entr__radio-row--on' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={st.metodologias.includes(m)}
                    onChange={() => toggleMetodologia(m)}
                  />
                  <span>{m}{esObligatoria ? ' (por defecto)' : ''}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* 05 Formato del Financiador */}
        <div className="entr__combo3-col">
          <div className="entr__card-header">
            <span className="entr__step-badge">05</span>
            <h2 className="entr__section-heading">Formato del Financiador</h2>
          </div>
          <p className="entr__section-hint">Formato exigido por el financiador.</p>
          <div className="entr__combo3-list">
            {FORMATO_FINANCIADOR.map(f => (
              <label
                key={f.label}
                className={`entr__radio-row${st.formatoFinanciador === f.label ? ' entr__radio-row--on' : ''}`}
              >
                <input type="radio" name="formatofinanciador" checked={st.formatoFinanciador === f.label}
                  onChange={() => setSt(p => ({ ...p, formatoFinanciador: f.label }))} />
                {f.label}
              </label>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
