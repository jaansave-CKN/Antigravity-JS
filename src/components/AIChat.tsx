import { useState, useRef, useEffect } from 'react';
import { Send, Bot, Sparkles, Loader2, X, ExternalLink, DollarSign, Calendar, Building } from 'lucide-react';
import { useSpeech } from '../contexts/SpeechContext';
import './AIChat.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  convocatorias?: any[];
}

interface ConvocatoriaChat {
  titulo: string;
  donante: string;
  montoMax: number;
  moneda: string;
  fechaCierre: string;
  descripcion: string;
  url: string;
  similarity?: number;
}

export default function AIChat() {
  const { isListening, transcript, setTranscript } = useSpeech();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showConvocatorias, setShowConvocatorias] = useState(false);
  const [convocatorias, setConvocatorias] = useState<ConvocatoriaChat[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Inyectar transcripción del micrófono global en el input activo
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
      setTranscript('');
    }
  }, [transcript, setTranscript]);

  // Registrar este input como el activo cuando esté enfocado
  const handleFocus = () => {
    (window as any).__activeChatInput = () => inputRef.current;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/ia/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: input })
      });

      const data = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.respuesta || 'No se pudo obtener respuesta',
        timestamp: new Date(),
        convocatorias: data.resultados
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      if (data.resultados && data.resultados.length > 0) {
        setConvocatorias(data.resultados);
        setShowConvocatorias(true);
      }
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Error de conexión. Intenta de nuevo.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const buscarSemantica = async (texto: string) => {
    setLoading(true);
    try {
      const response = await fetch('/api/ia/busqueda-semantica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto })
      });

      const data = await response.json();
      if (data.resultados) {
        setConvocatorias(data.resultados);
        setShowConvocatorias(true);
      }
    } catch (error) {
      console.error('Error en búsqueda semántica:', error);
    } finally {
      setLoading(false);
    }
  };

  const nuevaBusqueda = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/ia/buscar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: input || 'convocatorias abiertas Colombia 2026' })
      });

      const data = await response.json();
      if (data.data) {
        setConvocatorias(data.data);
        setShowConvocatorias(true);
      }
    } catch (error) {
      console.error('Error en búsqueda:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-chat">
      <div className="ai-chat__header">
        <div className="ai-chat__header-title">
          <Bot size={24} />
          <h2>Asistente IA - Radar 360</h2>
        </div>
        <div className="ai-chat__header-actions">
          <button className="btn-icon" onClick={nuevaBusqueda} title="Nueva búsqueda">
            <Sparkles size={18} />
          </button>
          {showConvocatorias && (
            <button className="btn-icon" onClick={() => setShowConvocatorias(false)} title="Cerrarpanel">
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="ai-chat__container">
        <div className="ai-chat__messages">
          {messages.length === 0 && (
            <div className="ai-chat__empty">
              <Bot size={48} className="empty-icon" />
              <h3>Bienvenido al Radar 360</h3>
              <p>Pregúntame sobre convocatorias, subvenciones o financiamiento para tus proyectos.</p>
              <div className="suggestions">
                <button onClick={() => setInput('Becas para estudios en el exterior')}>
                  🎓 Becas estudio exterior
                </button>
                <button onClick={() => setInput('Fondos para proyectos de infraestructura')}>
                  🏗️ Infraestructura
                </button>
                <button onClick={() => setInput('Financiación para PYMES Colombia')}>
                  💼 PYMES Colombia
                </button>
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={`message message--${msg.role}`}>
              <div className="message__avatar">
                {msg.role === 'user' ? '👤' : <Bot size={20} />}
              </div>
              <div className="message__content">
                <p>{msg.content}</p>
                <span className="message__time">
                  {msg.timestamp.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}

          {loading && (
            <div className="message message--assistant">
              <div className="message__avatar">
                <Bot size={20} />
              </div>
              <div className="message__content">
                <div className="loading">
                  <Loader2 className="spin" size={20} />
                  <span>Analizando mejores opciones...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {showConvocatorias && convocatorias.length > 0 && (
          <div className="ai-chat__results">
            <h3>📊 Convocatorias Encontradas ({convocatorias.length})</h3>
            <div className="results-list">
              {convocatorias.map((conv, idx) => (
                <div key={idx} className="result-card">
                  <div className="result-card__header">
                    <h4>{conv.titulo}</h4>
                    {conv.similarity && (
                      <span className="match-score">{Math.round(conv.similarity * 100)}%</span>
                    )}
                  </div>
                  <p className="result-card__donante">
                    <Building size={14} /> {conv.donante}
                  </p>
                  <p className="result-card__desc">{conv.descripcion}</p>
                  <div className="result-card__meta">
                    <span><DollarSign size={14} /> {conv.montoMax?.toLocaleString()} {conv.moneda}</span>
                    <span><Calendar size={14} /> {conv.fechaCierre}</span>
                  </div>
                  {conv.url && (
                    <a href={conv.url} target="_blank" rel="noopener noreferrer" className="result-card__link">
                      Ver convocatoria <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="ai-chat__input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Pregunta sobre subvenciones, becas o financiamiento..."
          disabled={loading}
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()}>
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}