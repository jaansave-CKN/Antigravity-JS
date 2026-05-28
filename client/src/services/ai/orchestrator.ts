import type { AITask, AgentContext, OrchestratorMessage } from './types';
import { taskQueue } from './taskQueue';
import { geminiService } from './geminiService';

type AgentCallback = (agentId: string, task: AITask) => void;

class AIAgentOrchestrator {
  private agents: Map<string, AgentContext> = new Map();
  private messageHistory: OrchestratorMessage[] = [];
  private maxHistory = 100;
  private agentCallbacks: AgentCallback[] = [];
  private isRunning = false;
  private tickInterval = 1000;
  private readonly PROJECT_ID = 'PROY_03_RADARFONDOS';

  constructor() {
    this.setupTaskListeners();
  }

  private setupTaskListeners(): void {
    taskQueue.on('task:submitted', (task: AITask) => {
      this.routeTask(task);
    });

    taskQueue.on('task:completed', (task: AITask) => {
      this.notifyAgentCompletion(task.agentId!, task);
    });

    taskQueue.on('task:failed', (task: AITask) => {
      this.handleTaskFailure(task);
    });
  }

  registerAgent(agentId: string, taskTypes: string[]): AgentContext {
    const context = taskQueue.registerAgent(agentId, taskTypes);
    this.agents.set(agentId, context);
    
    this.broadcast({
      type: 'agent:register',
      payload: { agentId, taskTypes },
      timestamp: new Date().toISOString(),
      source: 'orchestrator',
    });

    return context;
  }

  unregisterAgent(agentId: string): void {
    taskQueue.unregisterAgent(agentId);
    this.agents.delete(agentId);
    
    this.broadcast({
      type: 'agent:unregistered',
      payload: { agentId },
      timestamp: new Date().toISOString(),
      source: 'orchestrator',
    });
  }

  submitTask(
    type: AITask['type'],
    prompt: string,
    priority: AITask['priority'] = 'medium',
    context?: AITask['context']
  ): string {
    const enrichedContext = this.enrichContextWithProjectScope(context, type, prompt);
    
    const taskId = taskQueue.submitTask({
      type,
      priority,
      prompt,
      context: enrichedContext,
    });

    this.broadcast({
      type: 'task:submit',
      payload: { taskId, type, priority, projectId: this.PROJECT_ID },
      timestamp: new Date().toISOString(),
      source: 'orchestrator',
    });

    return taskId;
  }

  private enrichContextWithProjectScope(
    context: AITask['context'] | undefined,
    type: AITask['type'],
    prompt: string
  ): AITask['context'] {
    const isImageTask = this.isImageAnalysisTask(type, prompt);
    
    return {
      ...context,
      projectId: this.PROJECT_ID,
      scopeEnforced: isImageTask,
      ...(isImageTask && { taskCategory: 'multimodal_image_analysis' }),
    };
  }

  private isImageAnalysisTask(type: AITask['type'], prompt: string): boolean {
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
    const promptLower = prompt.toLowerCase();
    
    const hasImageExtension = imageExtensions.some(ext => 
      promptLower.includes(`.${ext}`) || promptLower.includes(`${ext} file`)
    );
    
    const hasImageKeywords = ['imagen', 'image', 'foto', 'photo', 'jpeg', 'png', 'vision', 'ocr', 'tesseract'];
    const hasKeywords = hasImageKeywords.some(keyword => promptLower.includes(keyword));
    
    return hasImageExtension || hasKeywords || type === 'analysis';
  }

  getTask(taskId: string): AITask | undefined {
    return taskQueue.getTask(taskId);
  }

  getAgentTasks(agentId: string): AITask[] {
    return taskQueue.getAllTasks().filter(t => t.agentId === agentId);
  }

  getAgentStatus(agentId: string): AgentContext | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentContext[] {
    return Array.from(this.agents.values());
  }

  private async routeTask(task: AITask): Promise<void> {
    const agent = this.findBestAgent(task);
    
    if (agent) {
      for (const callback of this.agentCallbacks) {
        callback(agent.agentId, task);
      }
    }
  }

  private findBestAgent(task: AITask): AgentContext | undefined {
    const available = Array.from(this.agents.values())
      .filter(a => a.taskTypes.includes(task.type) || a.taskTypes.includes('*'))
      .filter(a => !a.currentTask || a.pendingTasks < 3)
      .sort((a, b) => a.pendingTasks - b.pendingTasks);

    return available[0];
  }

  private notifyAgentCompletion(agentId: string, task: AITask): void {
    this.broadcast({
      type: 'task:complete',
      payload: { taskId: task.id, agentId, result: task.result },
      timestamp: new Date().toISOString(),
      source: 'orchestrator',
    });
  }

  private handleTaskFailure(task: AITask): void {
    this.broadcast({
      type: 'task:fail',
      payload: { taskId: task.id, error: task.result?.error },
      timestamp: new Date().toISOString(),
      source: 'orchestrator',
    });
  }

  private broadcast(message: OrchestratorMessage): void {
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistory) {
      this.messageHistory.shift();
    }
  }

  getMessageHistory(limit = 50): OrchestratorMessage[] {
    return this.messageHistory.slice(-limit);
  }

  onAgentTask(callback: AgentCallback): () => void {
    this.agentCallbacks.push(callback);
    return () => {
      const index = this.agentCallbacks.indexOf(callback);
      if (index > -1) this.agentCallbacks.splice(index, 1);
    };
  }

  async resolveArchitecture(codebase: string, context: string): Promise<string> {
    const taskId = this.submitTask(
      'architecture',
      `Analyze the following codebase context:\n\n${context}\n\nProvide architectural recommendations.`,
      'high',
      { taskType: 'architecture_review' }
    );
    return this.waitForResult(taskId);
  }

  async resolveTyping(typescriptCode: string, errorMessage?: string): Promise<string> {
    const taskId = this.submitTask(
      'typing',
      `Resolve TypeScript typing issues:\n\nCode:\n\`\`\`typescript\n${typescriptCode}\n\`\`\`\n\n${errorMessage ? `Error: ${errorMessage}` : ''}`,
      'high',
      { language: 'typescript', errorMessage }
    );
    return this.waitForResult(taskId);
  }

  async resolveCompilation(errorLogs: string, code?: string): Promise<string> {
    const taskId = this.submitTask(
      'compilation',
      `Resolve compilation errors:\n\nErrors:\n${errorLogs}\n\n${code ? `Code:\n\`\`\`\n${code}\n\`\`\`` : ''}`,
      'critical',
      { taskType: 'error_resolution' }
    );
    return this.waitForResult(taskId);
  }

  async analyzeCode(code: string, filePath?: string): Promise<string> {
    const taskId = this.submitTask(
      'analysis',
      `Analyze this code:\n\n${code}`,
      'medium',
      { filePath }
    );
    return this.waitForResult(taskId);
  }

  async analyzeMultimodalImage(
    imageBase64: string,
    mimeType: string,
    userPrompt: string,
    fileName?: string
  ): Promise<string> {
    const imageContext = {
      fileName,
      mimeType,
      isImageData: true,
      prompt: userPrompt,
      projectId: this.PROJECT_ID,
    };

    const prompt = `[PROJECT_SCOPE: ${this.PROJECT_ID}]
Analyze esta imagen adjunta y responde:

${userPrompt}

Metadata del archivo:
- Nombre: ${fileName || 'sin nombre'}
- Tipo MIME: ${mimeType}
- Proyecto: ${this.PROJECT_ID}
- Timestamp: ${new Date().toISOString()}`;

    const taskId = this.submitTask('analysis', prompt, 'high', imageContext);

    return this.waitForResult(taskId);
  }

  private async waitForResult(taskId: string, timeout = 60000): Promise<string> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkTask = () => {
        const task = this.getTask(taskId);
        if (!task) {
          reject(new Error(`Task ${taskId} not found`));
          return;
        }

        if (task.status === 'completed') {
          resolve(task.result?.result || '');
        } else if (task.status === 'failed') {
          reject(new Error(task.result?.error || 'Task failed'));
        } else if (Date.now() - startTime > timeout) {
          reject(new Error('Task timeout'));
        } else {
          setTimeout(checkTask, 500);
        }
      };

      checkTask();
    });
  }

  start(): void {
    this.isRunning = true;
    console.log('[Orchestrator] Started - AI agents ready');
  }

  stop(): void {
    this.isRunning = false;
    console.log('[Orchestrator] Stopped');
  }

  getStats() {
    return {
      agents: this.agents.size,
      taskQueue: taskQueue.getStats(),
      messageHistory: this.messageHistory.length,
      isRunning: this.isRunning,
    };
  }
}

export const orchestrator = new AIAgentOrchestrator();
export default orchestrator;