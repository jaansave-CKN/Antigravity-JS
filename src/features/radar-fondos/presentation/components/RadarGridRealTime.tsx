import React, { useState, useEffect } from 'react';

interface SubvencionReal {
  id: string;
  titulo: string;
  oferente: string;
  descripcion: string;
  link: string;
}

export const RadarGridRealTime: React.FC = () => {
  const [convocatorias, setConvocatorias] = useState<SubvencionReal[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    async function obtenerFlujoReal() {
      try {
        const response = await fetch('/api/radar/v1/stream-convocatorias');
        const datos = await response.json();
        setConvocatorias(datos);
      } catch (err) {
        console.error("Error en el flujo de datos reales:", err);
      } finally {
        setCargando(false);
      }
    }
    obtenerFlujoReal();
  }, []);

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #243553', paddingBottom: '10px' }}>
        <span style={{ color: '#38BDF8', fontWeight: 'bold' }}>FLUJO EN TIEMPO REAL ({convocatorias.length} Fuentes Detectadas)</span>
        <span style={{ color: '#94A3B8' }}>Estilo Escaneo Rapido</span>
      </div>

      {cargando && <div style={{ color: '#94A3B8' }}>Conectando con servidores de cooperacion global...</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '75vh', overflowY: 'auto' }}>
        {convocatorias.map((item) => (
          <div key={item.id} style={{ background: '#151F32', border: '1px solid #243553', borderRadius: '4px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <a href={item.link} target="_blank" rel="noreferrer" style={{ color: '#38BDF8', fontSize: '16px', fontWeight: 'bold', textDecoration: 'none' }}>
                {item.titulo}
              </a>
              <span style={{ background: '#243553', color: '#FFFFFF', padding: '2px 8px', fontSize: '11px', borderRadius: '2px' }}>{item.oferente}</span>
            </div>
            <p style={{ margin: 0, color: '#94A3B8', fontSize: '14px', lineHeight: '1.4' }}>{item.descripcion}</p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px', borderTop: '1px solid #243553', paddingTop: '10px' }}>
              <button style={{ background: '#00e676', color: '#000', border: 'none', padding: '5px 10px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>{'\u2605'} Favorito</button>
              <button style={{ background: '#243553', color: '#FFF', border: 'none', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>+ Agregar a Fuente</button>
              <button style={{ background: '#EF4444', color: '#FFF', border: 'none', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}>{'\u2715'} Desechar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
