import { useState, useEffect, useCallback } from 'react';
import { taskQueue, orchestrator } from '../services/ai';
import type { AITask, AgentContext } from '../services/ai';

export type TaskQueueStatus = 'idle' | 'processing' | 'busy';

export interface TaskQueueState {
  tasks: AITask[];
  pendingTasks: AITask[];
  processingTasks: AITask[];
  completedTasks: AITask[];
  failedTasks: AITask[];
  agents: AgentContext[];
  stats: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    agents: number;
    maxConcurrent: number;
  };
  queueStatus: TaskQueueStatus;
  lastUpdated: Date;
}

export interface UseAIOrchestratorReturn extends TaskQueueState {
  submitTask: (
    type: AITask['type'],
    prompt: string,
    priority?: AITask['priority'],
    context?: AITask['context']
  ) => string;
  cancelTask: (taskId: string) => boolean;
  getTask: (taskId: string) => AITask | undefined;
  resolveTyping: (code: string, error?: string) => Promise<string>;
  resolveCompilation: (errorLogs: string, code?: string) => Promise<string>;
  resolveArchitecture: (codebase: string, context: string) => Promise<string>;
  analyzeCode: (code: string, filePath?: string) => Promise<string>;
  refreshState: () => void;
}

function getQueueStatus(stats: TaskQueueState['stats']): TaskQueueStatus {
  if (stats.processing > 0) return 'processing';
  if (stats.pending > 0) return 'busy';
  return 'idle';
}

function mapTasks(tasks: AITask[]): AITask[] {
  return tasks.map(t => ({
    id: t.id,
    type: t.type,
    priority: t.priority,
    prompt: t.prompt,
    context: t.context,
    status: t.status,
    result: t.result,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    agentId: t.agentId,
  }));
}

export function useAIOrchestrator(pollInterval = 2000): UseAIOrchestratorReturn {
  const [state, setState] = useState<TaskQueueState>({
    tasks: [],
    pendingTasks: [],
    processingTasks: [],
    completedTasks: [],
    failedTasks: [],
    agents: [],
    stats: {
      total: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      agents: 0,
      maxConcurrent: 3,
    },
    queueStatus: 'idle',
    lastUpdated: new Date(),
  });

  const refreshState = useCallback(() => {
    const allTasks = taskQueue.getAllTasks();
    const mapped: AITask[] = mapTasks(allTasks as AITask[]);
    const stats = taskQueue.getStats();
    
    setState(prev => ({
      tasks: mapped,
      pendingTasks: mapped.filter(t => t.status === 'pending'),
      processingTasks: mapped.filter(t => t.status === 'processing'),
      completedTasks: mapped.filter(t => t.status === 'completed'),
      failedTasks: mapped.filter(t => t.status === 'failed'),
      agents: orchestrator.getAllAgents(),
      stats: {
        total: stats.total,
        pending: stats.pending,
        processing: stats.processing,
        completed: stats.completed,
        failed: stats.failed,
        agents: stats.agents,
        maxConcurrent: stats.maxConcurrent,
      },
      queueStatus: getQueueStatus(stats as TaskQueueState['stats']),
      lastUpdated: new Date(),
    }));
  }, []);

  useEffect(() => {
    refreshState();
    const interval = setInterval(refreshState, pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval, refreshState]);

  useEffect(() => {
    const handleTaskEvent = () => refreshState();
    
    taskQueue.on('task:submitted', handleTaskEvent);
    taskQueue.on('task:started', handleTaskEvent);
    taskQueue.on('task:completed', handleTaskEvent);
    taskQueue.on('task:failed', handleTaskEvent);
    taskQueue.on('task:cancelled', handleTaskEvent);

    return () => {
      taskQueue.off('task:submitted', handleTaskEvent);
      taskQueue.off('task:started', handleTaskEvent);
      taskQueue.off('task:completed', handleTaskEvent);
      taskQueue.off('task:failed', handleTaskEvent);
      taskQueue.off('task:cancelled', handleTaskEvent);
    };
  }, [refreshState]);

  const submitTask = useCallback((
    type: AITask['type'],
    prompt: string,
    priority: AITask['priority'] = 'medium',
    context?: AITask['context']
  ): string => {
    const taskId = orchestrator.submitTask(type, prompt, priority, context);
    refreshState();
    return taskId;
  }, [refreshState]);

  const cancelTask = useCallback((taskId: string): boolean => {
    const result = taskQueue.cancelTask(taskId);
    refreshState();
    return result;
  }, [refreshState]);

  const getTask = useCallback((taskId: string) => {
    const task = taskQueue.getTask(taskId) as AITask | undefined;
    if (!task) return undefined;
    return mapTasks([task])[0];
  }, []);

  const resolveTyping = useCallback(async (code: string, error?: string): Promise<string> => {
    const result = await orchestrator.resolveTyping(code, error);
    refreshState();
    return result;
  }, [refreshState]);

  const resolveCompilation = useCallback(async (errorLogs: string, code?: string): Promise<string> => {
    const result = await orchestrator.resolveCompilation(errorLogs, code);
    refreshState();
    return result;
  }, [refreshState]);

  const resolveArchitecture = useCallback(async (codebase: string, context: string): Promise<string> => {
    const result = await orchestrator.resolveArchitecture(codebase, context);
    refreshState();
    return result;
  }, [refreshState]);

  const analyzeCode = useCallback(async (code: string, filePath?: string): Promise<string> => {
    const result = await orchestrator.analyzeCode(code, filePath);
    refreshState();
    return result;
  }, [refreshState]);

  return {
    ...state,
    submitTask,
    cancelTask,
    getTask,
    resolveTyping,
    resolveCompilation,
    resolveArchitecture,
    analyzeCode,
    refreshState,
  };
}

export function useAIAgentStatus() {
  const [agents, setAgents] = useState<AgentContext[]>([]);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const update = () => {
      const allAgents = orchestrator.getAllAgents();
      setAgents(allAgents);
      setIsActive(allAgents.length > 0);
    };

    update();
    const interval = setInterval(update, 5000);
    return () => clearInterval(interval);
  }, []);

  return { agents, isActive, agentCount: agents.length };
}