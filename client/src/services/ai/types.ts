export interface AITaskResult {
  success: boolean;
  taskId: string;
  result?: string;
  error?: string;
  metadata?: {
    model?: string;
    tokens?: number;
    duration?: number;
    timestamp: string;
  };
}

export interface AITask {
  id: string;
  type: 'architecture' | 'typing' | 'compilation' | 'refactor' | 'analysis' | 'general';
  priority: 'critical' | 'high' | 'medium' | 'low';
  prompt: string;
  context?: {
    filePath?: string;
    language?: string;
    taskType?: string;
    errorMessage?: string;
    projectId?: string;
    scopeEnforced?: boolean;
    taskCategory?: string;
  };
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: AITaskResult;
  createdAt: Date;
  completedAt?: Date;
  agentId?: string;
}

export interface AgentContext {
  agentId: string;
  taskTypes: string[];
  currentTask?: AITask;
  pendingTasks: number;
}

export interface OrchestratorMessage {
  type: 'task:submit' | 'task:complete' | 'task:fail' | 'agent:register' | 'agent:unregistered' | 'agent:heartbeat';
  payload: unknown;
  timestamp: string;
  source: string;
}