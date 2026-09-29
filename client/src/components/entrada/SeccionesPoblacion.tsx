import type { Dispatch, SetStateAction } from 'react';
import { SECTORES_SUB, CATEGORIAS_POBLACION, DETALLE_POBLACION, type EntradaState } from './entradaModelo';

// Secciones 06 (Sector), 07 (Categoría de la Población), 08 (Detalle de la
// Población) y 09 (Ubicación Geográfica) — JSX copiado literal de
// pages/EntradaPage.tsx.
type SetSt = Dispatch<SetStateAction<EntradaState>>;

export function SeccionSector({ st, setSt, sectoresSet, toggleSector }: { st: EntradaState; setSt: SetSt; sectoresSet: Set<string>; toggleSector: (s: string) => void }) {
  return (
    <div className="entr__card" id="sec-sector">
      <div className="entr__card-header">
        <span className="entr__step-badge">06</span>
        <h2 className="entr__section-heading">Sector</h2>
      </div>
      <p className="entr__section-hint">Seleccione todos los sectores de intervención del proyecto.</p>
      <div className="entr__sector-block">
        {SECTORES_SUB.map(s => (
          <div key={s.grupo} className="entr__sector-table" style={{ marginBottom: 10 }}>
            <div className="entr__sector-thead">
              <p className="entr__sector-thead-title">{s.grupo}</p>
            </div>
            <div
              className="entr__sector-cols"
              style={{ gridTemplateColumns: `repeat(${s.sub.length}, 1fr)` }}
            >
              {s.sub.map(sub => (
                <div key={sub.titulo} className="entr__sector-col">
                  <p className="entr__sector-col-title">{sub.titulo}</p>
                  {sub.opciones.map(op => (
                    <label key={op} className="entr__check-row">
                      <input
                        type="checkbox"
                        checked={sectoresSet.has(op)}
                        onChange={() => toggleSector(op)}
                      />
                      <span>{op}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="entr__sector-otro">
              <span className="entr__sector-otro-label">Otro:</span>
              <input
                className="entr__sector-otro-input"
                placeholder="Especifique otro sector..."
                aria-label="Especifique otro sector"
                value={st.sectorOtro[s.grupo] || ''}
                onChange={e => setSt(p => ({ ...p, sectorOtro: { ...p.sectorOtro, [s.grupo]: e.target.value } }))}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SeccionCategoriaPoblacion({ st, setSt }: { st: EntradaState; setSt: SetSt }) {
  return (
    <div className="entr__card" id="sec-poblacion">
      <div className="entr__card-header">
        <span className="entr__step-badge">07</span>
        <h2 className="entr__section-heading">Categoría de la Población Objetivo</h2>
      </div>
      <p className="entr__section-hint">Identifique a quién va dirigido el proyecto.</p>
      <div className="entr__combo3-grid">
        {CATEGORIAS_POBLACION.map(cat => (
          <div key={cat.id} className="entr__combo3-col">
            <p className="entr__subheading">{cat.titulo}</p>
            <div className="entr__combo3-list">
              {cat.opciones.map(op => {
                const key = `${cat.id}:${op}`;
                const esOtro = op.startsWith('Otros');
                return (
                  <div key={key}>
                    <label
                      className={`entr__radio-row${st.categoriaPoblacion === key ? ' entr__radio-row--on' : ''}`}
                    >
                      <input type="radio" name="catpob"
                        checked={st.categoriaPoblacion === key}
                        onChange={() => setSt(p => ({ ...p, categoriaPoblacion: key }))} />
                      {op}
                    </label>
                    {esOtro && st.categoriaPoblacion === key && (
                      <input
                        className="entr__sub-input"
                        placeholder="Escribir aquí..."
                        aria-label="Otra categoría de población, especifique"
                        autoFocus
                        value={st.categoriaOtro[cat.id] || ''}
                        onChange={e => setSt(p => ({
                          ...p,
                          categoriaOtro: { ...p.categoriaOtro, [cat.id]: e.target.value },
                        }))}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SeccionDetallePoblacion({ detallePoblacionSet, toggleDetalle }: { detallePoblacionSet: Set<string>; toggleDetalle: (s: string) => void }) {
  return (
    <div className="entr__card" id="sec-detalle">
      <div className="entr__card-header">
        <span className="entr__step-badge">08</span>
        <h2 className="entr__section-heading">Detalle de la Población</h2>
      </div>
      <p className="entr__section-hint">Especifique los grupos poblacionales prioritarios.</p>
      {DETALLE_POBLACION.map(d => (
        <div key={d.grupo} className="entr__detalle-grupo">
          <p className="entr__subheading">{d.grupo}</p>
          <div className="entr__detalle-grid">
            {d.opciones.map(op => (
              <label
                key={op}
                className={`entr__check-card${detallePoblacionSet.has(op) ? ' entr__check-card--on' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={detallePoblacionSet.has(op)}
                  onChange={() => toggleDetalle(op)}
                />
                <span>{op}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SeccionUbicacion({ st, setSt }: { st: EntradaState; setSt: SetSt }) {
  return (
    <div className="entr__card" id="sec-geo">
      <div className="entr__card-header">
        <span className="entr__step-badge">09</span>
        <h2 className="entr__section-heading">Ubicación Geográfica</h2>
      </div>
      <p className="entr__section-hint">Localización del área de intervención del proyecto.</p>
      <div className="entr__geo-grid">
        <div>
          <label className="entr__field-label" htmlFor="entr-municipio">
            MUNICIPIO / DEPARTAMENTO
          </label>
          <input
            id="entr-municipio"
            className="entr__input"
            placeholder="Ej: Medellín, Antioquia"
            value={st.municipio}
            onChange={e => setSt(p => ({ ...p, municipio: e.target.value }))}
          />
        </div>
        <div>
          <label className="entr__field-label" htmlFor="entr-vereda">
            VEREDA / CORREGIMIENTO
          </label>
          <input
            id="entr-vereda"
            className="entr__input"
            placeholder="Opcional"
            value={st.vereda}
            onChange={e => setSt(p => ({ ...p, vereda: e.target.value }))}
          />
        </div>
      </div>
    </div>
  );
}
