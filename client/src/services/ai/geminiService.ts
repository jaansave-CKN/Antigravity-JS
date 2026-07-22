import type { AITask, AITaskResult } from './types';

// Google Gemini vive exclusivamente en el backend (GOOGLE_API_KEY).
// El cliente nunca la ve — todas las llamadas pasan por /api/ai/generate.

const PROXY_URL = '/api/ai/generate';

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  return token && token !== 'demo-mode-token'
    ? { Authorization: `Bearer ${token}` }
    : {};
}

async function callProxy(
  messages: { role: string; content: string }[],
  temperature = 0.7,
  maxTokens   = 8192
): Promise<string> {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ messages, temperature, max_tokens: maxTokens }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message ?? `Error ${res.status}`);
  }

  const data = await res.json();
  if (!data.success) throw new Error(data.message ?? 'Error en servicio de IA');
  return data.result as string;
}

class GeminiService {
  async generateContent(prompt: string): Promise<string> {
    return callProxy([{ role: 'user', content: prompt }]);
  }

  async generateWithMultimodal(prompt: string, _parts: unknown[]): Promise<string> {
    return callProxy([{ role: 'user', content: `${prompt}\n\n[Nota: contenido multimodal adjunto]` }]);
  }

  async processMultimodalTask(
    _parts: unknown[],
    taskType: AITask['type'],
    userQuestion: string,
    taskId?: string
  ): Promise<AITaskResult> {
    const startTime = Date.now();
    const result: AITaskResult = {
      success: false,
      taskId: taskId ?? crypto.randomUUID(),
      metadata: { model: 'gemini-2.0-flash', timestamp: new Date().toISOString() },
    };
    try {
      result.result   = await callProxy([
        { role: 'system',  content: this.getSystemPromptForTask(taskType) },
        { role: 'user',    content: userQuestion },
      ], 0.7, 8192);
      result.success  = true;
    } catch (e) {
      result.error = e instanceof Error ? e.message : 'Unknown error';
    }
    result.metadata!.duration = Date.now() - startTime;
    return result;
  }

  async processTask(task: AITask): Promise<AITaskResult> {
    const startTime = Date.now();
    const result: AITaskResult = {
      success: false,
      taskId: task.id,
      metadata: { model: 'gemini-2.0-flash', timestamp: new Date().toISOString() },
    };
    try {
      result.result  = await callProxy([
        { role: 'system', content: this.buildSystemPrompt(task) },
        { role: 'user',   content: task.prompt },
      ], 0.7, 8192);
      result.success = true;
    } catch (e) {
      result.error = e instanceof Error ? e.message : 'Unknown error';
    }
    result.metadata!.duration = Date.now() - startTime;
    return result;
  }

  async generateWithContext(systemPrompt: string, userPrompt: string): Promise<string> {
    return callProxy([
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ]);
  }

  async analyzeConvocatoria(prompt: string, context?: string): Promise<string> {
    const token = localStorage.getItem('auth_token');
    if (!token || token === 'demo-mode-token') throw new Error('Sesión no autenticada.');
    const res = await fetch('/api/ai/convocatoria-analyze', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, context }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message ?? `Error ${res.status}`);
    return data.result as string;
  }

  async generateMultimodalContent(prompt: string, _imageBase64?: string, _mimeType?: string): Promise<string> {
    return callProxy([{ role: 'user', content: prompt }]);
  }

  private getSystemPromptForTask(taskType: AITask['type']): string {
    const prompts: Record<AITask['type'], string> = {
      architecture: 'Eres un arquitecto de software experto. Proporciona recomendaciones claras y fundamentadas.',
      typing:       'Eres un experto en TypeScript. Resuelve problemas de tipos con seguridad tipográfica estricta.',
      compilation:  'Eres un experto en resolución de errores de compilación. Proporciona soluciones con causa raíz.',
      refactor:     'Eres un experto en refactorización. Propone mejoras de código, patrones y mejores prácticas.',
      analysis:     'Eres un experto en análisis de código. Identifica problemas y da recomendaciones accionables.',
      general:      'Eres un asistente útil. Responde basándote en el contexto proporcionado.',
    };
    return prompts[taskType] ?? prompts.general;
  }

  private buildSystemPrompt(task: AITask): string {
    const base = 'Eres un arquitecto de software senior y experto en TypeScript. Resuelves decisiones arquitectónicas, problemas de tipos y errores de compilación de forma autónoma.';
    switch (task.type) {
      case 'architecture': return `${base}\n\nEntrega: ## Análisis, ## Recomendaciones, ## Implementación`;
      case 'typing':       return `${base}\n\nEntrega: definiciones de tipos, interfaces, genéricos, union types.`;
      case 'compilation':  return `${base}\n\nEntrega: causa raíz, fix con snippet corregido, explicación.`;
      case 'refactor':     return `${base}\n\nEntrega: análisis actual, estrategia, implementación mejorada.`;
      case 'analysis':     return `${base}\n\nEntrega: revisión, issues, recomendaciones, evaluación de riesgos.`;
      default:             return base;
    }
  }
}

export const geminiService = new GeminiService();
export default geminiService;
