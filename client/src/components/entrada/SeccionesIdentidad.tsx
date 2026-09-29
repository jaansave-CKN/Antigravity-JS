import type { Dispatch, SetStateAction } from 'react';
import type { EntradaState } from './entradaModelo';
import AlertaIA, { type AvisoIA } from './AlertaIA';

// Nombre y Pitch del proyecto — JSX copiado literal de pages/EntradaPage.tsx.
type SetSt = Dispatch<SetStateAction<EntradaState>>;

interface PropsNombre {
  st: EntradaState;
  setSt: SetSt;
  bloqueado: boolean;
  cuotaAgotada: boolean;
  generandoNombre: boolean;
  sincronizandoProyecto: boolean;
  errorProyecto: string | null;
  aviso: AvisoIA;
  onBlur: () => void;
  onToggleBloqueo: () => void;
  onGenerar: () => void;
}

export function SeccionNombre({ st, setSt, bloqueado, cuotaAgotada, generandoNombre, sincronizandoProyecto, errorProyecto, aviso, onBlur, onToggleBloqueo, onGenerar }: PropsNombre) {
  return (
    <div className="entr__card" id="sec-nombre">
      <label className="entr__nombre-label" htmlFor="entr-nombre">
        NOMBRE DEL PROYECTO
      </label>
      <div className="entr__textarea-wrap">
        <textarea
          id="entr-nombre"
          className="entr__input entr__input--nombre"
          rows={3}
          placeholder="Escriba el nombre del proyecto..."
          value={st.nombre}
          disabled={bloqueado}
          onChange={e => setSt(p => ({ ...p, nombre: e.target.value }))}
          onBlur={onBlur}
        />
        <button
          type="button"
          className={`entr__lock-btn entr__lock-btn--solo${bloqueado ? ' entr__lock-btn--locked' : ''}`}
          onClick={onToggleBloqueo}
          title={bloqueado ? 'Desbloquear campo' : 'Bloquear campo (protege el texto contra edición o regeneración con IA)'}
        >
          <span className="material-symbols-outlined">{bloqueado ? 'lock' : 'lock_open'}</span>
        </button>
        <button
          type="button"
          className={`entr__ai-btn-sm entr__ai-btn-sm--solo${cuotaAgotada ? ' entr__ai-btn-sm--cooldown' : ''}`}
          disabled={generandoNombre || bloqueado}
          onClick={onGenerar}
          title="Generar nombre con IA (usa Diálectica, Impacto Integral y lo ya escrito en Entrada)"
        >
          <span className="material-symbols-outlined">{generandoNombre ? 'progress_activity' : 'auto_awesome'}</span>
        </button>
      </div>
      {sincronizandoProyecto && (
        <span style={{ fontSize: 11, color: '#6b7280', marginTop: 4, display: 'block' }}>
          Guardando proyecto…
        </span>
      )}
      {errorProyecto && (
        <span role="alert" style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}>
          {errorProyecto}
        </span>
      )}
      <AlertaIA aviso={aviso} variante="linea" />
    </div>
  );
}

interface PropsPitch {
  st: EntradaState;
  setSt: SetSt;
  bloqueado: boolean;
  cuotaAgotada: boolean;
  generandoPitch: boolean;
  onToggleBloqueo: () => void;
  onGenerar: () => void;
}

export function SeccionPitch({ st, setSt, bloqueado, cuotaAgotada, generandoPitch, onToggleBloqueo, onGenerar }: PropsPitch) {
  return (
    <div className="entr__card" id="sec-pitch">
      <label className="entr__nombre-label" htmlFor="entr-pitch">
        PITCH DEL PROYECTO
      </label>
      <div className="entr__textarea-wrap">
        <textarea
          id="entr-pitch"
          className="entr__textarea"
          rows={4}
          placeholder="Escriba el pitch del proyecto..."
          value={st.pitch}
          disabled={bloqueado}
          onChange={e => setSt(p => ({ ...p, pitch: e.target.value }))}
        />
        <button
          type="button"
          className={`entr__lock-btn entr__lock-btn--solo${bloqueado ? ' entr__lock-btn--locked' : ''}`}
          onClick={onToggleBloqueo}
          title={bloqueado ? 'Desbloquear campo' : 'Bloquear campo (protege el texto contra edición o regeneración con IA)'}
        >
          <span className="material-symbols-outlined">{bloqueado ? 'lock' : 'lock_open'}</span>
        </button>
        <button
          type="button"
          className={`entr__ai-btn-sm entr__ai-btn-sm--solo${cuotaAgotada ? ' entr__ai-btn-sm--cooldown' : ''}`}
          disabled={generandoPitch || bloqueado}
          onClick={onGenerar}
          title="Generar pitch con IA (usa Diálectica, Impacto Integral y lo ya escrito en Entrada)"
        >
          <span className="material-symbols-outlined">{generandoPitch ? 'progress_activity' : 'auto_awesome'}</span>
        </button>
      </div>
    </div>
  );
}
