import type { AITask, AgentContext, OrchestratorMessage } from './types';
import { geminiService } from './geminiService';

type TaskEventCallback = (task: AITask) => void;

class OpenCodeTaskQueue {
  private queue: Map<string, AITask> = new Map();
  private processing: Set<string> = new Set();
  private agents: Map<string, AgentContext> = new Map();
  private listeners: Map<string, TaskEventCallback[]> = new Map();
  private maxConcurrent = 3;
  private retryAttempts = 3;
  private pollInterval = 2000;
  private isPolling = false;
  private eventCallbacks: Map<string, Function[]> = new Map();

  constructor() {
    this.startPolling();
  }

  submitTask(task: Omit<AITask, 'id' | 'status' | 'createdAt'>): string {
    const fullTask: AITask = {
      ...task,
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      status: 'pending',
      createdAt: new Date(),
    };

    this.queue.set(fullTask.id, fullTask);
    this.emit('task:submitted', fullTask);
    this.sortQueue();
    
    return fullTask.id;
  }

  getTask(taskId: string): AITask | undefined {
    return this.queue.get(taskId);
  }

  getTasksByStatus(status: AITask['status']): AITask[] {
    return Array.from(this.queue.values()).filter(t => t.status === status);
  }

  getTasksByType(type: AITask['type']): AITask[] {
    return Array.from(this.queue.values()).filter(t => t.type === type);
  }

  getPendingTasks(): AITask[] {
    return this.getTasksByStatus('pending');
  }

  getAllTasks(): AITask[] {
    return Array.from(this.queue.values());
  }

  cancelTask(taskId: string): boolean {
    const task = this.queue.get(taskId);
    if (task && task.status === 'pending') {
      this.queue.delete(taskId);
      this.emit('task:cancelled', task);
      return true;
    }
    return false;
  }

  registerAgent(agentId: string, taskTypes: string[]): AgentContext {
    const context: AgentContext = {
      agentId,
      taskTypes,
      pendingTasks: 0,
    };
    this.agents.set(agentId, context);
    this.emit('agent:registered', context);
    return context;
  }

  unregisterAgent(agentId: string): boolean {
    const result = this.agents.delete(agentId);
    if (result) {
      this.emit('agent:unregistered', { agentId });
    }
    return result;
  }

  getAvailableAgent(taskType: AITask['type']): AgentContext | undefined {
    for (const [id, context] of this.agents) {
      if (context.taskTypes.includes(taskType) || context.taskTypes.includes('*')) {
        if (context.currentTask === undefined && context.pendingTasks < this.maxConcurrent) {
          return context;
        }
      }
    }
    return undefined;
  }

  getAgents(): AgentContext[] {
    return Array.from(this.agents.values());
  }

  private async startPolling(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;

    const poll = async () => {
      if (!this.isPolling) return;

      try {
        await this.processQueue();
      } catch (error) {
        console.error('[OpenCodeTaskQueue] Poll error:', error);
      }

      setTimeout(poll, this.pollInterval);
    };

    poll();
  }

  private async processQueue(): Promise<void> {
    const pending = this.getPendingTasks();
    if (pending.length === 0) return;

    for (const task of pending) {
      if (this.processing.size >= this.maxConcurrent) break;
      
      const agent = this.getAvailableAgent(task.type);
      if (!agent) continue;

      await this.executeTask(task, agent.agentId);
    }
  }

  private async executeTask(task: AITask, agentId: string): Promise<void> {
    this.processing.add(task.id);
    task.status = 'processing';
    task.agentId = agentId;

    const agentContext = this.agents.get(agentId);
    if (agentContext) {
      agentContext.currentTask = task;
      agentContext.pendingTasks++;
    }

    this.emit('task:started', task);

    try {
      const result = await geminiService.processTask(task);
      task.result = result;
      task.status = result.success ? 'completed' : 'failed';
      task.completedAt = new Date();

      this.emit('task:completed', task);
    } catch (error) {
      task.status = 'failed';
      task.result = {
        success: false,
        taskId: task.id,
        error: error instanceof Error ? error.message : 'Execution failed',
        metadata: { timestamp: new Date().toISOString() },
      };
      task.completedAt = new Date();

      this.emit('task:failed', task);
    } finally {
      this.processing.delete(task.id);
      if (agentContext) {
        agentContext.currentTask = undefined;
        agentContext.pendingTasks = Math.max(0, agentContext.pendingTasks - 1);
      }
    }
  }

  private sortQueue(): void {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = Array.from(this.queue.values())
      .filter(t => t.status === 'pending')
      .sort((a, b) => {
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (pDiff !== 0) return pDiff;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

    for (const task of sorted) {
      this.queue.delete(task.id);
      this.queue.set(task.id, task);
    }
  }

  on(event: string, callback: Function): void {
    if (!this.eventCallbacks.has(event)) {
      this.eventCallbacks.set(event, []);
    }
    this.eventCallbacks.get(event)!.push(callback);
  }

  off(event: string, callback: Function): void {
    const callbacks = this.eventCallbacks.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) callbacks.splice(index, 1);
    }
  }

  private emit(event: string, data?: unknown): void {
    const callbacks = this.eventCallbacks.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(data);
        } catch (error) {
          console.error(`[OpenCodeTaskQueue] Event callback error (${event}):`, error);
        }
      }
    }
  }

  destroy(): void {
    this.isPolling = false;
    this.queue.clear();
    this.processing.clear();
    this.agents.clear();
    this.eventCallbacks.clear();
  }

  getStats() {
    const tasks = Array.from(this.queue.values());
    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      processing: tasks.filter(t => t.status === 'processing').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      agents: this.agents.size,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

export const taskQueue = new OpenCodeTaskQueue();
export default taskQueue;