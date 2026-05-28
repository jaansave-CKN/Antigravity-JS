import { orchestrator } from './orchestrator';

const AGENT_ID = 'arch-agent';
const AGENT_CAPABILITIES = ['architecture', 'typing', 'compilation', 'refactor', 'analysis', 'general'];

export function initializeAISystem(): void {
  if (typeof window === 'undefined') return;

  try {
    orchestrator.registerAgent(AGENT_ID, AGENT_CAPABILITIES);
    orchestrator.start();
    
    console.log(`[AI System] ${AGENT_ID} registered with capabilities: ${AGENT_CAPABILITIES.join(', ')}`);
    console.log('[AI System] Local intelligence engine initialized - Perpetual mode active');
  } catch (error) {
    console.error('[AI System] Initialization failed:', error);
  }
}

export function getAgentId(): string {
  return AGENT_ID;
}

export function getAgentCapabilities(): string[] {
  return AGENT_CAPABILITIES;
}

export { orchestrator };