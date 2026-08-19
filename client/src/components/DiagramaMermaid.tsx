/**
 * DiagramaMermaid — envoltorio de renderizado para diagramas Mermaid
 * (mapas de proceso, organigramas, Gantt) generados por el Co-Piloto o
 * pegados directamente en código Mermaid.
 *
 * Mandato "Motor de Diagramación ISO 9000" (2026-08-17): el LLM puede
 * generar sintaxis Mermaid inválida (typos, versión de sintaxis
 * incompatible) — la app no puede colapsar por eso. mermaid.render() es
 * async y lanza DENTRO de una promesa, no en el render de React, así que
 * un ErrorBoundary de clase (componentDidCatch) NO lo captura — se maneja
 * con try/catch explícito en el efecto y un estado local de error.
 *
 * Reintenta el render una vez de forma silenciosa (por si fue un hiccup de
 * timing, p. ej. el contenedor aún no tenía tamaño) antes de mostrar el
 * aviso técnico. Si el fallo persiste, expone el error vía onError para
 * que el consumidor (p. ej. el chat del Co-Piloto) decida si le pide al
 * LLM una sintaxis corregida — este componente solo dibuja, no llama IA.
 */
import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let inicializado = false;
function asegurarInit() {
  if (inicializado) return;
  mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' });
  inicializado = true;
}

let contador = 0;
const siguienteId = () => `mermaid-diagrama-${Date.now()}-${++contador}`;

interface DiagramaMermaidProps {
  chart: string;
  onError?: (error: Error) => void;
  className?: string;
}

export default function DiagramaMermaid({ chart, onError, className }: DiagramaMermaidProps) {
  const [estado, setEstado] = useState<'renderizando' | 'ok' | 'error'>('renderizando');
  const [svg, setSvg] = useState<string>('');
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelado = false;
    asegurarInit();

    async function render(intento: number): Promise<void> {
      try {
        const { svg: svgRenderizado } = await mermaid.render(siguienteId(), chart);
        if (cancelado) return;
        setSvg(svgRenderizado);
        setEstado('ok');
      } catch (err) {
        if (cancelado) return;
        if (intento < 1) {
          // Reintento silencioso único — cubre el caso de un hiccup de
          // timing, no una sintaxis realmente inválida.
          await render(intento + 1);
          return;
        }
        setEstado('error');
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }

    setEstado('renderizando');
    render(0);
    return () => { cancelado = true; };
  }, [chart]); // eslint-disable-line react-hooks/exhaustive-deps -- onError es un callback, no debe re-disparar el render

  if (estado === 'error') {
    return (
      <div
        className={className}
        style={{
          padding: '12px 16px', borderRadius: 8, background: '#fff7ed',
          border: '1px solid #fed7aa', color: '#9a3412', fontSize: 13,
        }}
      >
        Ajustando diagrama…
      </div>
    );
  }

  if (estado === 'renderizando') {
    return (
      <div className={className} style={{ padding: '12px 16px', color: '#6b7280', fontSize: 13 }}>
        Generando diagrama…
      </div>
    );
  }

  return (
    <div
      ref={contenedorRef}
      className={className}
      data-mermaid-svg="true"
      // eslint-disable-next-line react/no-danger -- SVG generado por mermaid.render() con securityLevel: 'strict', no HTML de usuario sin sanitizar
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
