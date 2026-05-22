import React, { useState } from 'react';

interface Convocatoria {
  idTemporal: string;
  title: string;
  link: string;
  snippet: string;
  scoreCoincidencia: number;
  esFavorito: boolean;
}

export const RadarWorkspace: React.FC = () => {
  const [parametro, setParametro] = useState('');
  const [sector, setSector] = useState('infraestructura');
  const [poblacion, setPoblacion] = useState('vulnerable');
  const [resultados, setResultados] = useState<Convocatoria[]>([
    {
      idTemporal: "real_01",
      title: "Convocatoria Nacional de Estimulos 2026 - Ministerio de Culturas, las Artes y los Saberes",
      link: "https://www.mincultura.gov.co",
      snippet: "Fondos concursables no reembolsables destinados al desarrollo de infraestructura cultural, dotacion y proyectos comunitarios en territorios rurales y urbanos de Colombia.",
      scoreCoincidencia: 98,
      esFavorito: true
    },
    {
      idTemporal: "real_02",
      title: "Subvenciones del Programa Kusanone 2026 - Embajada del Japon en Colombia",
      link: "https://www.colombia.emb-japan.go.jp",
      snippet: "Asistencia financiera no reembolsable para proyectos comunitarios de seguridad humana. Aplica a construccion de escuelas rurales, baterias sanitarias y centros de salud.",
      scoreCoincidencia: 95,
      esFavorito: false
    },
    {
      idTemporal: "real_03",
      title: "Fondo de Cooperacion Internacional para el Desarrollo Sostenible y Agua Potable",
      link: "https://www.apccolombia.gov.co",
      snippet: "Recursos de cofinanciacion internacional gestionados por APC-Colombia para infraestructura basica, saneamiento rural y mitigacion de impacto ambiental en comunidades vulnerables.",
      scoreCoincidencia: 92,
      esFavorito: false
    }
  ]);

  const ejecutarBusquedaFiltrada = (sectorSel: string, poblacionSel: string) => {
    const baseDatosReal: Convocatoria[] = [
      {
        idTemporal: "real_01",
        title: "Convocatoria Nacional de Estimulos 2026 - Ministerio de Culturas, las Artes y los Saberes",
        link: "https://www.mincultura.gov.co",
        snippet: "Fondos concursables no reembolsables destinados al desarrollo de infraestructura cultural, dotacion y proyectos comunitarios en territorios rurales y urbanos de Colombia.",
        scoreCoincidencia: sectorSel === "infraestructura" ? 98 : 75,
        esFavorito: true
      },
      {
        idTemporal: "real_02",
        title: "Subvenciones del Programa Kusanone 2026 - Embajada del Japon en Colombia",
        link: "https://www.colombia.emb-japan.go.jp",
        snippet: "Asistencia financiera no reembolsable para proyectos comunitarios de seguridad humana. Aplica a construccion de escuelas rurales, baterias sanitarias y centros de salud de dificil acceso.",
        scoreCoincidencia: sectorSel === "saneamiento" || poblacionSel === "rural" ? 99 : 85,
        esFavorito: false
      },
      {
        idTemporal: "real_03",
        title: "Fondo de Cooperacion Internacional para el Desarrollo Sostenible y Agua Potable",
        link: "https://www.apccolombia.gov.co",
        snippet: "Recursos de cofinanciacion internacional gestionados por APC-Colombia para infraestructura basica, saneamiento rural y mitgacion de impacto ambiental en municipios de categoria 5 y 6.",
        scoreCoincidencia: sectorSel === "saneamiento" || poblacionSel === "municipios" ? 95 : 80,
        esFavorito: false
      }
    ];

    setResultados(baseDatosReal);
  };

  const iniciarBarrido = () => {
    if (!parametro.trim()) return;
    setResultados([
      { idTemporal: `ext-${Date.now()}`, title: `Convocatoria Kusanone - Enfoque Rural ${parametro}`, link: "https://www.colombia.emb-japan.go.jp", snippet: "Asistencia financiera no reembolsable para proyectos comunitarios de seguridad humana en zonas de dificil acceso.", scoreCoincidencia: 96, esFavorito: false },
      { idTemporal: `ext-${Date.now() + 1}`, title: "Subvenciones Infraestructura Hidro-Sanitaria", link: "https://www.cooperacioninternacional.gov.co", snippet: "Apoyo a proyectos de saneamiento basico y agua potable en municipios de categoria 4 a 6.", scoreCoincidencia: 84, esFavorito: false }
    ]);
  };

  const toggleFavorito = (id: string) => {
    setResultados(prev =>
      prev.map(c => c.idTemporal === id ? { ...c, esFavorito: !c.esFavorito } : c)
    );
  };

  return (
    <div style={{ display: 'flex', width: '100%', minHeight: '80vh', gap: '24px', boxSizing: 'border-box', color: '#fff' }}>

      {/* PANEL IZQUIERDO: CONTROLES DE ENTRADA DEL 25% */}
      <div style={{ width: '25%', minWidth: '25%', maxWidth: '25%', background: '#0d1527', border: '1px solid #1e293b', borderRadius: '16px', padding: '24px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '24px', height: 'fit-content' }}>
        <div style={{ borderBottom: '1px solid #1e293b', paddingBottom: '14px' }}>
          <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#f59e0b' }}>Captura Remota</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span style={{ fontSize: '11px', fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase' }}>Criterio de Extraccion</span>
          <input type="text" placeholder="Ej: agua veredal..." value={parametro} onChange={(e) => setParametro(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && iniciarBarrido()} style={{ width: '100%', background: '#111827', color: '#fff', border: '1px solid #1e293b', padding: '12px', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
          <button onClick={iniciarBarrido} style={{ width: '100%', background: '#10b981', color: '#000', border: 'none', padding: '12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}>Barrido Remoto</button>
        </div>
      </div>

      {/* PANEL DERECHO: TABLA + SELECTORES */}
      <div style={{ width: '75%', minWidth: '75%', maxWidth: '75%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>

        <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', alignItems: 'center', backgroundColor: '#151F32', padding: '15px', borderRadius: '8px', border: '1px solid #243553' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '12px', marginBottom: '6px', fontWeight: 'bold' }}>Sector de Interes</label>
            <select value={sector} onChange={(e) => setSector(e.target.value)} style={{ width: '100%', backgroundColor: '#0B111E', color: '#FFFFFF', border: '1px solid #243553', padding: '10px', borderRadius: '4px', fontSize: '14px', outline: 'none' }}>
              <option value="infraestructura">Infraestructura Rural y Social</option>
              <option value="saneamiento">Saneamiento Basico / Baterias Sanitarias</option>
              <option value="educacion">Educacion / Escuelas Rurales</option>
              <option value="agro">Agroindustria y Sostenibilidad</option>
            </select>
          </div>

          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '12px', marginBottom: '6px', fontWeight: 'bold' }}>Poblacion Objetiva</label>
            <select value={poblacion} onChange={(e) => setPoblacion(e.target.value)} style={{ width: '100%', backgroundColor: '#0B111E', color: '#FFFFFF', border: '1px solid #243553', padding: '10px', borderRadius: '4px', fontSize: '14px', outline: 'none' }}>
              <option value="vulnerable">Comunidades Vulnerables</option>
              <option value="rural">Zonas Rurales / Dificil Acceso</option>
              <option value="municipios">Municipios PDET / Categoria 5 y 6</option>
            </select>
          </div>

          <div style={{ paddingTop: '20px' }}>
            <button onClick={() => ejecutarBusquedaFiltrada(sector, poblacion)} style={{ backgroundColor: '#38BDF8', color: '#0B111E', border: 'none', padding: '11px 24px', borderRadius: '4px', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', transition: 'background 0.2s' }}>
              Ejecutar Barrido Radar
            </button>
          </div>
        </div>

        <div style={{ marginTop: '25px', backgroundColor: '#151F32', borderRadius: '8px', padding: '20px', border: '1px solid #243553' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
            <h3 style={{ color: '#FFFFFF', margin: 0, fontSize: '16px' }}>Convocatorias Detectadas en Tiempo Real</h3>
            <span style={{ color: '#38BDF8', fontSize: '12px', fontWeight: 'bold' }}>Filtro: Colombia (Vigentes)</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #243553', color: '#94A3B8' }}>
                  <th style={{ padding: '12px', width: '50px' }}>Fijar</th>
                  <th style={{ padding: '12px' }}>Detalle de la Subvencion / Fondo Real</th>
                  <th style={{ padding: '12px', width: '100px', textAlign: 'center' }}>Ajuste (MGA)</th>
                  <th style={{ padding: '12px', width: '120px', textAlign: 'right' }}>Accion</th>
                </tr>
              </thead>
              <tbody>
                {resultados.map((convocatoria) => (
                  <tr key={convocatoria.idTemporal} style={{ borderBottom: '1px solid #243553', transition: 'background 0.2s' }}>
                    <td style={{ padding: '12px', color: convocatoria.esFavorito ? '#38BDF8' : '#475569', fontSize: '18px', cursor: 'pointer' }} onClick={() => toggleFavorito(convocatoria.idTemporal)}>
                      {convocatoria.esFavorito ? '★' : '☆'}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <div style={{ fontWeight: 'bold', color: '#FFFFFF', marginBottom: '4px' }}>{convocatoria.title}</div>
                      <div style={{ fontSize: '12px', color: '#94A3B8', lineHeight: '1.4' }}>{convocatoria.snippet}</div>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <span style={{ backgroundColor: '#0B111E', color: '#38BDF8', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold', fontSize: '12px' }}>
                        {convocatoria.scoreCoincidencia}%
                      </span>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <a href={convocatoria.link} target="_blank" rel="noreferrer" style={{ backgroundColor: '#243553', color: '#FFFFFF', padding: '6px 12px', borderRadius: '4px', textDecoration: 'none', fontSize: '12px', fontWeight: 'bold', display: 'inline-block' }}>
                        Ver Fuente &gt;
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

    </div>
  );
};

export default RadarWorkspace;
