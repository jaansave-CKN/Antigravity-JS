import React from 'react';

export const PestañaChat: React.FC = () => {
  return (
    <div style={{ padding: '20px', color: '#fff', display: 'flex', flexDirection: 'column', height: '350px' }}>
      <h3 style={{ color: '#ab47bc', marginBottom: '10px' }}>3. Consola de Comandos e Interacción Cognitiva</h3>
      
      <div style={{ flex: 1, background: '#252526', padding: '15px', borderRadius: '4px', overflowY: 'auto', border: '1px solid #333', marginBottom: '10px' }}>
        <p style={{ color: '#ab47bc', margin: 0 }}><b>[Antigravity OS]:</b> Dispuesto para analizar los términos de referencia de la convocatoria seleccionada. ¿Qué capítulos de la MGA desea estructurar, Arquitecto?</p>
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <input 
          type="text" 
          placeholder="Escriba un comando o pregunta al agente..." 
          style={{ flex: 1, background: '#2d2d2d', color: '#fff', border: '1px solid #555', padding: '10px', borderRadius: '4px' }}
        />
        <button style={{ background: '#ab47bc', color: '#fff', border: 'none', padding: '0 20px', borderRadius: '4px', fontWeight: 'bold' }}>Enviar</button>
      </div>
    </div>
  );
};