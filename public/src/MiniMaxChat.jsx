import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import { getIdToken } from './lib/firebase';

const MiniMaxChat = () => {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '¡Hola! Soy Claude, el asistente de IA nativo de Antigravity OS. ¿En qué puedo ayudarte?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ active: null, checking: true });
  const messagesEndRef = useRef(null);

  const checkStatus = async () => {
    try {
      const token = await getIdToken();
      const res = await fetch('/api/minimax/status', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setStatus({ active: data.active, checking: false });
    } catch {
      setStatus({ active: false, checking: false });
    }
  };

  useEffect(() => { checkStatus(); }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const token = await getIdToken();
      const res = await fetch('/api/minimax/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(({ role, content }) => ({ role, content })),
          max_tokens: 4096
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error en la respuesta');
      }

      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content || 'Sin respuesta';
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Bot className="text-purple-400" size={28} />
          <div>
            <h2 className="text-lg font-bold text-purple-300">Claude · Antigravity AI</h2>
            <p className="text-xs text-gray-400">Claude / Anthropic · Soberanía total</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status.checking ? (
            <Loader className="animate-spin text-gray-400" size={16} />
          ) : status.active ? (
            <span className="flex items-center gap-1 text-green-400 text-xs"><CheckCircle size={14} /> Online</span>
          ) : (
            <span className="flex items-center gap-1 text-red-400 text-xs"><AlertCircle size={14} /> Offline</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0">
                <Bot size={16} />
              </div>
            )}
            <div className={`max-w-[75%] p-3 rounded-lg ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-none'
                : 'bg-gray-800 text-gray-100 rounded-bl-none border border-gray-700'
            }`}>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                <User size={16} />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0">
              <Bot size={16} />
            </div>
            <div className="bg-gray-800 p-3 rounded-lg border border-gray-700">
              <Loader className="animate-spin text-purple-400" size={20} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-gray-700 p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu mensaje..."
            rows={1}
            className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 resize-none focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg transition-colors"
          >
            <Send size={20} />
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">Claude · Antigravity OS · Presiona Enter para enviar</p>
      </div>
    </div>
  );
};

export default MiniMaxChat;
