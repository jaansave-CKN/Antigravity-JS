import React, { useState } from 'react';
import { PestañaChat } from './components/PestañaChat';
import PestañaPruebaContent from './components/PestañaPrueba';
import { PanelConfiguracionTenant } from './components/PanelConfiguracionTenant';

export const PestañaPrueba: React.FC = () => {
  const [tabActiva, setTabActiva] = useState<'radar' | 'inteligencia' | 'prueba' | 'chat' | 'configuracion'>('prueba');

  const renderContenidoPestaña = (tab: string) => {
    switch (tab) {
      case 'radar': return <div style={{ padding: '20px', color: '#aaa' }}>📡 Contenido del Radar de Convocatorias</div>;
      case 'inteligencia': return <div style={{ padding: '20px', color: '#aaa' }}>🧠 Panel de Inteligencia Artificial</div>;
      case 'prueba': return <PestañaPruebaContent />;
      case 'chat': return <PestañaChat />;
      case 'configuracion': return <PanelConfiguracionTenant />;
      default: return <div style={{ padding: '20px', color: '#aaa' }}>📡 Contenido del Radar de Convocatorias</div>;
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', background: '#1e1e1e', color: '#fff', borderRadius: '8px' }}>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
        <button onClick={() => setTabActiva('radar')} style={{ background: tabActiva === 'radar' ? '#4fc3f7' : '#333', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer' }}>Radar</button>
        <button onClick={() => setTabActiva('inteligencia')} style={{ background: tabActiva === 'inteligencia' ? '#4fc3f7' : '#333', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer' }}>Inteligencia</button>
        <button onClick={() => setTabActiva('prueba')} style={{ background: tabActiva === 'prueba' ? '#4fc3f7' : '#333', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer' }}>Prueba</button>
        <button onClick={() => setTabActiva('chat')} style={{ background: tabActiva === 'chat' ? '#ab47bc' : '#333', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer' }}>Chat</button>
        <button onClick={() => setTabActiva('configuracion')} style={{ background: tabActiva === 'configuracion' ? '#4fc3f7' : '#333', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer' }}>Ajustes</button>
      </div>

      {renderContenidoPestaña(tabActiva)}
    </div>
  );
};