import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

interface SpeechContextType {
  isListening: boolean;
  transcript: string;
  activeInputRef: (() => HTMLInputElement | HTMLTextAreaElement | null) | null;
  startListening: (inputRef?: () => HTMLInputElement | HTMLTextAreaElement | null) => void;
  stopListening: () => void;
  setTranscript: (text: string) => void;
}

const SpeechContext = createContext<SpeechContextType | null>(null);

export function SpeechProvider({ children }: { children: ReactNode }) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscriptState] = useState('');
  const [activeInputRef, setActiveInputRef] = useState<(() => HTMLInputElement | HTMLTextAreaElement | null) | null>(null);

  const recognitionRef = (globalThis as any).__speechRecognition || null;

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'es-CO';
      (globalThis as any).__speechRecognition = rec;

      rec.onresult = (event: any) => {
        let finalText = '';
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const part = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += part + ' ';
          } else {
            interimText += part;
          }
        }
        if (finalText) {
          setTranscriptState(prev => {
            const combined = prev + finalText;
            // Inyectar directamente en el input activo
            const el = activeInputRef ? activeInputRef() : null;
            if (el) {
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
              if (nativeInputValueSetter && el instanceof HTMLInputElement) {
                nativeInputValueSetter.call(el, combined);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } else if (nativeTextAreaValueSetter && el instanceof HTMLTextAreaElement) {
                nativeTextAreaValueSetter.call(el, combined);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            return combined;
          });
        }
      };

      rec.onerror = () => setIsListening(false);
      rec.onend = () => { if (isListening) { try { rec.start(); } catch {} } };
      (globalThis as any).__speechRecognition = rec;
    }

    return () => {
      try { recognitionRef?.stop(); } catch {}
    };
  }, [isListening, activeInputRef]);

  const startListening = useCallback((inputRef?: () => HTMLInputElement | HTMLTextAreaElement | null) => {
    if (inputRef) setActiveInputRef(() => inputRef);
    const rec = (globalThis as any).__speechRecognition;
    if (rec) {
      try {
        rec.start();
        setIsListening(true);
      } catch {}
    }
  }, []);

  const stopListening = useCallback(() => {
    const rec = (globalThis as any).__speechRecognition;
    if (rec) { try { rec.stop(); } catch {} }
    setIsListening(false);
    setActiveInputRef(null);
  }, []);

  const setTranscript = useCallback((text: string) => {
    setTranscriptState(text);
    const el = activeInputRef ? activeInputRef() : null;
    if (el) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeInputValueSetter && el instanceof HTMLInputElement) {
        nativeInputValueSetter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (nativeTextAreaValueSetter && el instanceof HTMLTextAreaElement) {
        nativeTextAreaValueSetter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }, [activeInputRef]);

  return (
    <SpeechContext.Provider value={{ isListening, transcript, activeInputRef, startListening, stopListening, setTranscript }}>
      {children}
    </SpeechContext.Provider>
  );
}

export function useSpeech() {
  const ctx = useContext(SpeechContext);
  if (!ctx) throw new Error('useSpeech must be used within SpeechProvider');
  return ctx;
}
