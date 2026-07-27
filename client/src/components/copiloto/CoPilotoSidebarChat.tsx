import { useState, useEffect, useRef } from 'react';
import { getAuthHeaders } from '../../lib/apiClient';
import { C } from '../../pages/DashboardFormuladorPage';

interface MensajeChat {
  role: 'user' | 'model';
  content: string;
}

/** Chat fijo del Co-Piloto RadFor-360 — vive dentro de RightPanel, tras la Bitácora. */
export default function CoPilotoSidebarChat({ proyectoId }: { proyectoId: string | undefined }) {
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [fuente, setFuente] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!proyectoId) { setMensajes([]); return; }
    let cancelado = false;
    fetch(`/api/proyectos/${proyectoId}/copiloto/historial`, { headers: { ...getAuthHeaders() }, credentials: 'include' })
      .then(r => r.json())
      .then(body => {
        if (cancelado || !body?.success) return;
        setMensajes((body.data || []).map((h: any) => ({ role: h.role, content: h.content })));
      })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [proyectoId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, loading]);

  const enviarMensaje = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading || !proyectoId) return;

    const mensajeUsuario = input;
    setInput('');
    setMensajes(prev => [...prev, { role: 'user', content: mensajeUsuario }]);
    setLoading(true);

    try {
      const res = await fetch(`/api/proyectos/${proyectoId}/copiloto/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ mensaje: mensajeUsuario, moduloActivo: window.location.pathname }),
      });
      const body = await res.json();
      if (res.ok && body?.success) {
        setMensajes(prev => [...prev, { role: 'model', content: body.data.respuesta }]);
        setFuente(body.data.fuente);
      } else {
        setMensajes(prev => [...prev, { role: 'model', content: body?.message || 'No se pudo procesar la consulta.' }]);
      }
    } catch {
      setMensajes(prev => [...prev, { role: 'model', content: 'Error de red al contactar al Co-Piloto.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: C.bgRightRow, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: 10, display: 'flex', flexDirection: 'column', height: 260, flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingBottom: 8, marginBottom: 8, borderBottom: `1px solid ${C.border}`,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
          Co-Piloto RadFor-360
        </span>
        <span style={{ fontSize: 9, fontWeight: 600, color: '#16a34a', background: '#dcfce7', padding: '2px 6px', borderRadius: 4 }}>
          {fuente === 'heuristica' ? 'Respaldo' : 'IA Activa · COP'}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
        {!proyectoId ? (
          <p style={{ fontSize: 10, color: C.textDim, fontStyle: 'italic', textAlign: 'center', marginTop: 24 }}>
            Selecciona un proyecto para hablar con el Co-Piloto.
          </p>
        ) : mensajes.length === 0 ? (
          <p style={{ fontSize: 10, color: C.textDim, fontStyle: 'italic', textAlign: 'center', marginTop: 24 }}>
            Pregúntame sobre el presupuesto, riesgos HSEQ o viabilidad en COP de este proyecto.
          </p>
        ) : (
          mensajes.map((m, i) => (
            <div key={i} style={{
              fontSize: 10, lineHeight: 1.4, padding: '6px 8px', borderRadius: 8,
              background: m.role === 'user' ? '#eff6ff' : C.bgCard,
              border: m.role === 'user' ? 'none' : `1px solid ${C.border}`,
              color: m.role === 'user' ? C.cyan : C.text,
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%', whiteSpace: 'pre-wrap',
            }}>
              {m.content}
            </div>
          ))
        )}
        {loading && (
          <p style={{ fontSize: 9, color: C.textDim, fontStyle: 'italic', margin: 0 }}>Analizando contexto financiero y normativo...</p>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={enviarMensaje} style={{ display: 'flex', gap: 5, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={!proyectoId || loading}
          placeholder="Escribe tu consulta..."
          style={{
            flex: 1, fontSize: 10, padding: '6px 8px', borderRadius: 6,
            border: `1px solid ${C.border}`, background: C.bgCard, color: C.text, outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={!proyectoId || loading || !input.trim()}
          style={{
            fontSize: 10, fontWeight: 600, padding: '6px 10px', borderRadius: 6, border: 'none',
            background: C.cyan, color: '#fff', cursor: 'pointer',
            opacity: (!proyectoId || loading || !input.trim()) ? 0.5 : 1,
          }}
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
