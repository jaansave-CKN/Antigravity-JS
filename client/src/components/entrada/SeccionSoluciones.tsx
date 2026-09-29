import type { Dispatch, SetStateAction } from 'react';
import type { EntradaState } from './entradaModelo';
import AlertaIA, { type AvisoIA } from './AlertaIA';

// Sección 11 "Posibles Soluciones (A.I. 7.0)" — JSX copiado literal de
// pages/EntradaPage.tsx: hasta 9 propuestas de IA (editables) + 1 manual fija
// (#10), selección única tipo radio.
interface Props {
  st: EntradaState;
  setSt: Dispatch<SetStateAction<EntradaState>>;
  aviso: AvisoIA;
  cuotaAgotada: boolean;
  generandoCampo: string | null;
  onGenerar: () => void;
}

export default function SeccionSoluciones({ st, setSt, aviso, cuotaAgotada, generandoCampo, onGenerar }: Props) {
  return (
    <div className="entr__ia-card" id="sec-ia">
      <div className="entr__card-header">
        <span className="entr__step-badge">11</span>
        <h2 className="entr__ia-heading" style={{ margin: 0 }}>Posibles Soluciones (A.I. 7.0)</h2>
      </div>
      <p className="entr__ia-hint">
        Al guardar, el pipeline M1–M9 del Formulador AI procesará estos datos de entrada
        y generará automáticamente el análisis de soluciones, marco lógico y presupuesto base.
      </p>
      <AlertaIA aviso={aviso} variante="bloque" />
      <div className="entr__soluciones-header">
        <button
          type="button"
          className={`entr__soluciones-ai-btn${cuotaAgotada ? ' entr__soluciones-ai-btn--cooldown' : ''}`}
          disabled={generandoCampo === 'SOLUCIONES'}
          onClick={onGenerar}
        >
          <span className="material-symbols-outlined">{generandoCampo === 'SOLUCIONES' ? 'progress_activity' : 'auto_awesome'}</span>
          {generandoCampo === 'SOLUCIONES' ? 'Generando…' : 'Soluciones con AI'}
        </button>
        {st.soluciones.propuestasIA.length > 0 && (
          <span className="entr__soluciones-count">{st.soluciones.propuestasIA.length} de 9 generadas por IA</span>
        )}
      </div>
      <div className="entr__soluciones-lista">
        {st.soluciones.propuestasIA.length === 0 && (
          <p className="entr__soluciones-empty">Aún no hay propuestas de IA — usa el botón de arriba, o escribe tu propia propuesta en la casilla #10.</p>
        )}
        {st.soluciones.propuestasIA.map((texto, i) => (
          <div className="entr__solucion-item" key={`ia-${i}`}>
            <input
              type="radio"
              name="solucion-elegida"
              className="entr__solucion-radio"
              checked={st.soluciones.seleccion?.tipo === 'ia' && st.soluciones.seleccion.index === i}
              onChange={() => setSt(p => ({ ...p, soluciones: { ...p.soluciones, seleccion: { tipo: 'ia', index: i } } }))}
              title={`Elegir la propuesta ${i + 1} para ser formulada`}
            />
            <span className="entr__solucion-num">{i + 1}</span>
            <textarea
              className="entr__solucion-textarea"
              aria-label={`Propuesta de solución ${i + 1} generada por IA`}
              value={texto}
              onChange={e => setSt(p => {
                const propuestasIA = [...p.soluciones.propuestasIA];
                propuestasIA[i] = e.target.value;
                return { ...p, soluciones: { ...p.soluciones, propuestasIA } };
              })}
            />
          </div>
        ))}
        <div className="entr__solucion-item">
          <input
            type="radio"
            name="solucion-elegida"
            className="entr__solucion-radio"
            checked={st.soluciones.seleccion?.tipo === 'manual'}
            onChange={() => setSt(p => ({ ...p, soluciones: { ...p.soluciones, seleccion: { tipo: 'manual' } } }))}
            title="Elegir tu propuesta manual para ser formulada"
          />
          <span className="entr__solucion-num">10</span>
          <textarea
            className="entr__solucion-textarea"
            placeholder="Escribe tu propia propuesta de solución…"
            aria-label="Tu propia propuesta de solución"
            value={st.soluciones.propuestaManual}
            onChange={e => setSt(p => ({ ...p, soluciones: { ...p.soluciones, propuestaManual: e.target.value } }))}
          />
        </div>
      </div>
    </div>
  );
}
