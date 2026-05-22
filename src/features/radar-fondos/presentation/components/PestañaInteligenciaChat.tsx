import React, { useState } from 'react';

export const PestañaInteligenciaChat: React.FC = () => {
  const [promptIntereses, setPromptIntereses] = useState('Enfoque estratégico: Infraestructura rural, aulas modulares rápidas y baterías sanitarias en Colombia.');
  const [inputChat, setInputChat] = useState('');
  const [logsAgente, setLogsAgente] = useState<{ origen: string; mensaje: string }[]>([
    { origen: 'SYSTEM', mensaje: 'Filtro semántico enlazado con éxito al Radar 360.' }
  ]);

  const ejecutarComando = () => {
    if (!inputChat.trim()) return;
    setLogsAgente(prev => [...prev, { origen: 'USER', mensaje: inputChat }]);
    const comando = inputChat;
    setInputChat('');

    setTimeout(() => {
      setLogsAgente(prev => [...prev, { origen: 'ANTIGRAVITY', mensaje: `Procesando directriz bajo el perfil activo para: "${comando}". Evaluando viabilidad MGA.` }]);
    }, 500);
  };

  return (
    <div style={{ display: 'flex', width: '100%', minHeight: '80vh', gap: '24px', boxSizing: 'border-box', color: '#fff' }}>
      
      <div style={{ width: '25%', minWidth: '25%', maxWidth: '25%', background: '#0d1527', border: '1px solid #1e293b', borderRadius: '16px', padding: '24px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '24px', height: 'fit-content' }}>
        <div style={{ borderBottom: '1px solid #1e293b', paddingBottom: '14px' }}>
          <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#38bdf8' }}>🧠 Perfil Cognitivo</span>
        </div>
        <div>
          <span style={{ fontSize: '11px', fontWeight: '700', color: '#9ca3af', display: 'block', marginBottom: '10px', textTransform: 'uppercase' }}>Filtro Semántico Base</span>
          <textarea rows={6} value={promptIntereses} onChange={(e) => setPromptIntereses(e.target.value)} style={{ width: '100%', background: '#111827', color: '#fff', border: '1px solid #1e293b', padding: '12px', borderRadius: '8px', fontSize: '12px', fontFamily: 'monospace', resize: 'none', boxSizing: 'border-box', outline: 'none' }} />
        </div>
      </div>

      <div style={{ width: '75%', minWidth: '75%', maxWidth: '75%', border: '2px dashed #1e293b', borderRadius: '16px', background: '#040814', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
        <span style={{ color: '#475569', fontSize: '14px' }}>Espacio libre del 75% para desarrollo analítico / consola de la Ventana 2</span>
      </div>

    </div>
  );
};