import type { AITask, AITaskResult } from './types';

const API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY || import.meta.env.OPENROUTER_API_KEY || '';

if (!API_KEY) {
  console.warn('OPENROUTER_API_KEY no configurada. El servicio MiniMax no funcionará.');
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'minimax/minimax-m2.5:free';

async function callMinimax(
  messages: { role: string; content: string }[],
  temperature = 0.7,
  maxTokens = 8192
): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Antigravity OS'
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MiniMax API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

class GeminiService {
  async generateContent(prompt: string): Promise<string> {
    try {
      return await callMinimax([
        { role: 'user', content: prompt }
      ]);
    } catch (error) {
      console.error('[MiniMaxService] Error in generateContent:', error);
      throw error;
    }
  }

  async generateWithMultimodal(
    prompt: string,
    _parts: any[]
  ): Promise<string> {
    try {
      const multimodalPrompt = `${prompt}\n\n[Nota: contenido multimodal adjunto]`;
      return await callMinimax([
        { role: 'user', content: multimodalPrompt }
      ]);
    } catch (error) {
      console.error('[MiniMaxService] Error in generateWithMultimodal:', error);
      throw error;
    }
  }

  async processMultimodalTask(
    _parts: any[],
    taskType: AITask['type'],
    userQuestion: string,
    taskId?: string
  ): Promise<AITaskResult> {
    const startTime = Date.now();
    const result: AITaskResult = {
      success: false,
      taskId: taskId || crypto.randomUUID(),
      metadata: {
        model: MODEL,
        timestamp: new Date().toISOString(),
      },
    };

    try {
      const systemPrompt = this.getSystemPromptForTask(taskType);
      const response = await callMinimax([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userQuestion }
      ], 0.7, 8192);

      result.success = true;
      result.result = response;
      result.metadata!.duration = Date.now() - startTime;

      return result;
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : 'Unknown error';
      result.metadata!.duration = Date.now() - startTime;
      return result;
    }
  }

  private getSystemPromptForTask(taskType: AITask['type']): string {
    const prompts: Record<AITask['type'], string> = {
      architecture: 'Eres un arquitecto de software experto. Analiza la documentación y código proporcionados para tomar decisiones arquitectónicas informadas. Proporciona recomendaciones claras y fundamentadas.',
      typing: 'Eres un experto en TypeScript. Analiza el contenido proporcionado y resuelve problemas de tipos, define interfaces, y garantiza seguridad tipográfica.',
      compilation: 'Eres un experto en resolución de errores de compilación. Analiza el contenido y proporciona soluciones a errores encontrados.',
      refactor: 'Eres un experto en refactorización de código. Analiza el contenido y propone mejoras de código, patrones y mejores prácticas.',
      analysis: 'Eres un experto en análisis de código. Proporciona una revisión exhaustiva del código, identifica problemas y da recomendaciones.',
      general: 'Eres un asistente útil. Responde a las preguntas basándote en el contenido proporcionado.',
    };

    return prompts[taskType] || prompts.general;
  }

  async processTask(task: AITask): Promise<AITaskResult> {
    const startTime = Date.now();
    const result: AITaskResult = {
      success: false,
      taskId: task.id,
      metadata: {
        model: MODEL,
        timestamp: new Date().toISOString(),
      },
    };

    try {
      const systemPrompt = this.buildSystemPrompt(task);
      const response = await callMinimax([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task.prompt }
      ], 0.7, 8192);

      result.success = true;
      result.result = response;
      result.metadata!.duration = Date.now() - startTime;

      return result;
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : 'Unknown error';
      result.metadata!.duration = Date.now() - startTime;
      return result;
    }
  }

  private buildSystemPrompt(task: AITask): string {
    const baseContext = 'You are an expert software architect and TypeScript developer assistant. You help resolve architecture decisions, data typing issues, and compilation errors autonomously.';

    switch (task.type) {
      case 'architecture':
        return `${baseContext}\n\nYou are analyzing architecture requirements. Provide detailed architectural decisions with:\n- Component structure\n- Data flow diagrams (described in text)\n- API design recommendations\n- Type definitions\n- Code implementation patterns\n\nFormat your response with clear sections: ## Analysis, ## Recommendations, ## Implementation`;
      case 'typing':
        return `${baseContext}\n\nYou are resolving TypeScript typing issues. Provide:\n- Type definitions\n- Interface specifications\n- Generics usage\n- Union types\n- Error resolution\n\nFocus on type safety and proper TypeScript patterns.`;
      case 'compilation':
        return `${baseContext}\n\nYou are resolving compilation errors. Provide:\n- Root cause analysis\n- Fix recommendations\n- Corrected code snippets\n- Explanation of the error\n\nInclude specific line references when available.`;
      case 'refactor':
        return `${baseContext}\n\nYou are refactoring code. Provide:\n- Current code analysis\n- Refactoring strategy\n- Improved implementation\n- Best practices followed`;
      case 'analysis':
        return `${baseContext}\n\nYou are performing code analysis. Provide:\n- Current implementation review\n- Issues identified\n- Recommendations\n- Risk assessment`;
      default:
        return `${baseContext}\n\nRespond to the task with clear, actionable guidance.`;
    }
  }

  async generateWithContext(systemPrompt: string, userPrompt: string): Promise<string> {
    return callMinimax([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]);
  }

  /**
   * Analiza una convocatoria usando el token OAuth del usuario en el backend.
   * El servidor inyecta las system instructions de aislamiento Radar_Fondos_360.
   * @throws si el usuario no tiene Google OAuth vinculado (403) o falla la API.
   */
  async analyzeConvocatoria(prompt: string, context?: string): Promise<string> {
    const token = localStorage.getItem('auth_token');
    if (!token || token === 'demo-mode-token') {
      throw new Error('Sesión no autenticada.');
    }
    const res = await fetch('/api/ai/convocatoria-analyze', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, context }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || `Error ${res.status}`);
    }
    return data.result as string;
  }

  async generateMultimodalContent(
    prompt: string,
    _imageBase64?: string,
    _mimeType?: string
  ): Promise<string> {
    try {
      return await callMinimax([
        { role: 'user', content: prompt }
      ]);
    } catch (error) {
      console.error('Error en la conexión MiniMax:', error);
      throw error;
    }
  }
}

export const geminiService = new GeminiService();
export default geminiService;
