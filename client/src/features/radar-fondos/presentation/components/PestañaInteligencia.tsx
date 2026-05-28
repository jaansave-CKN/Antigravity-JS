import React, { useState } from 'react';

export const PestañaInteligencia: React.FC = () => {
  const [promptIntereses, setPromptIntereses] = useState('');

  return (
    <div style={{ padding: '20px', color: '#fff' }}>
      <h3 style={{ color: '#00e676', marginBottom: '15px' }}>2. Configuración y Prompt de Intereses Estratégicos</h3>
      <p style={{ fontSize: '14px', color: '#aaa' }}>Defina el perfil cognitivo para que Antigravity filtre automáticamente las similitudes semánticas.</p>
      
      <textarea 
        rows={6}
        style={{ width: '100%', background: '#2d2d2d', color: '#fff', border: '1px solid #555', padding: '15px', borderRadius: '4px', fontSize: '14px', fontFamily: 'monospace' }}
        placeholder="Ejemplo: Arquitecto enfocado en formulación de proyectos MGA, construcción modular de alta velocidad, baterías sanitarias en zonas rurales de difícil acceso, mitigación de riesgo hídrico..."
        value={promptIntereses}
        onChange={(e) => setPromptIntereses(e.target.value)}
      />
      <button style={{ marginTop: '15px', background: '#00e676', color: '#000', border: 'none', padding: '10px 20px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
        Guardar Configuración de IA
      </button>
    </div>
  );
};