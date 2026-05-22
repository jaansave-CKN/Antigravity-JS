import chokidar, { FSWatcher } from 'chokidar';
import * as fs from 'fs/promises';
import * as path from 'path';
import { orchestrator } from '../ai/orchestrator';

const PROJECT_SCOPE = 'Proy_03_RadarFondos';
const WATCH_PATTERNS = [
  'src/components/**/*.ts',
  'src/components/**/*.tsx',
  'src/services/**/*.ts',
  'src/services/**/*.tsx',
];

interface WatchEvent {
  type: 'add' | 'change' | 'unlink';
  filePath: string;
  relativePath: string;
  timestamp: Date;
}

interface WatcherConfig {
  projectRoot: string;
  patterns: string[];
  debounceMs: number;
  maxFileSize: number;
  excludedDirs: string[];
}

const DEFAULT_CONFIG: WatcherConfig = {
  projectRoot: process.cwd(),
  patterns: WATCH_PATTERNS,
  debounceMs: 300,
  maxFileSize: 500 * 1024,
  excludedDirs: ['node_modules', '.git', 'dist', 'build', '__tests__', '.test.', '.spec.'],
};

class CodeWatcher {
  private watcher: FSWatcher | null = null;
  private config: WatcherConfig;
  private fileCache: Map<string, string> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private eventHistory: WatchEvent[] = [];
  private maxHistory = 100;
  private isWatching = false;
  private analysisQueue: Map<string, Promise<void>> = new Map();

  constructor(config: Partial<WatcherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async start(): Promise<void> {
    if (this.isWatching) {
      console.log('[CodeWatcher] Already watching');
      return;
    }

    console.log('[CodeWatcher] Initializing...');
    console.log(`[CodeWatcher] Project scope: ${PROJECT_SCOPE}`);
    console.log(`[CodeWatcher] Root: ${this.config.projectRoot}`);
    console.log(`[CodeWatcher] Patterns: ${this.config.patterns.join(', ')}`);

    const absolutePatterns = this.config.patterns.map(p => 
      path.join(this.config.projectRoot, p)
    );

    this.watcher = chokidar.watch(absolutePatterns, {
      ignored: (filePath: string) => {
        const isExcluded = this.config.excludedDirs.some(dir => 
          filePath.includes(dir)
        );
        const isOutOfScope = !filePath.includes(PROJECT_SCOPE);
        return isExcluded || isOutOfScope;
      },
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
      usePolling: true,
      interval: 500,
    });

    this.watcher
      .on('add', (filePath) => this.handleEvent('add', filePath))
      .on('change', (filePath) => this.handleEvent('change', filePath))
      .on('unlink', (filePath) => this.handleEvent('unlink', filePath))
      .on('error', (error) => console.error('[CodeWatcher] Error:', error))
      .on('ready', () => {
        this.isWatching = true;
        console.log('[CodeWatcher] Ready - monitoring for changes');
        console.log('[CodeWatcher] arch-agent analysis pipeline active');
      });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.isWatching = false;
      this.clearDebounceTimers();
      console.log('[CodeWatcher] Stopped');
    }
  }

  private handleEvent(type: WatchEvent['type'], filePath: string): void {
    if (!filePath.includes(PROJECT_SCOPE)) {
      console.warn(`[CodeWatcher] SECURITY: File outside project scope rejected: ${filePath}`);
      return;
    }

    const relativePath = path.relative(this.config.projectRoot, filePath);
    const event: WatchEvent = { type, filePath, relativePath, timestamp: new Date() };
    
    this.addToHistory(event);
    this.debounce(event);
  }

  private debounce(event: WatchEvent): void {
    const existing = this.debounceTimers.get(event.filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(event.filePath);
      this.processEvent(event);
    }, this.config.debounceMs);

    this.debounceTimers.set(event.filePath, timer);
  }

  private async processEvent(event: WatchEvent): Promise<void> {
    const { type, filePath } = event;

    if (type === 'unlink') {
      this.fileCache.delete(filePath);
      console.log(`[CodeWatcher] File removed: ${event.relativePath}`);
      return;
    }

    try {
      const stats = await fs.stat(filePath);
      
      if (stats.size > this.config.maxFileSize) {
        console.warn(`[CodeWatcher] File too large, skipping: ${event.relativePath}`);
        return;
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const previousContent = this.fileCache.get(filePath);
      
      this.fileCache.set(filePath, content);

      if (previousContent === content && type !== 'add') {
        return;
      }

      console.log(`[CodeWatcher] ${type.toUpperCase()}: ${event.relativePath}`);
      
      if (type === 'add') {
        console.log(`[CodeWatcher] New file detected: ${event.relativePath}`);
      }

      await this.triggerArchAgentAnalysis(event, content);
      
    } catch (error) {
      console.error(`[CodeWatcher] Error processing ${filePath}:`, error);
    }
  }

  private async triggerArchAgentAnalysis(event: WatchEvent, content: string): Promise<void> {
    if (this.analysisQueue.has(event.filePath)) {
      return;
    }

    const analysisPromise = this.performAnalysis(event, content);
    this.analysisQueue.set(event.filePath, analysisPromise);
    
    try {
      await analysisPromise;
    } finally {
      this.analysisQueue.delete(event.filePath);
    }
  }

  private async performAnalysis(event: WatchEvent, content: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      const fileExtension = path.extname(event.filePath);
      const isReactComponent = fileExtension === '.tsx';
      const relativePath = event.relativePath;

      const analysisPrompt = this.buildAnalysisPrompt(relativePath, content, isReactComponent);

      const result = await orchestrator.analyzeCode(content, relativePath);

      const duration = Date.now() - startTime;
      
      if (this.hasSignificantFindings(result, content)) {
        console.log('\n' + '='.repeat(60));
        console.log(`[arch-agent] Analysis Report - ${event.relativePath}`);
        console.log('='.repeat(60));
        console.log(`Duration: ${duration}ms`);
        console.log(`File size: ${content.length} chars`);
        console.log('\n--- Findings ---');
        console.log(result);
        console.log('='.repeat(60) + '\n');
      } else if (duration < 2000) {
        console.log(`[arch-agent] ${relativePath}: OK (${duration}ms)`);
      }
      
    } catch (error) {
      console.error(`[arch-agent] Analysis failed for ${event.filePath}:`, error);
    }
  }

  private buildAnalysisPrompt(filePath: string, content: string, isReactComponent: boolean): string {
    const baseContext = `Analyze this ${isReactComponent ? 'React component' : 'TypeScript file'} for the Radar 360 Fondos project (PROY_03_RADARFONDOS):

File: ${filePath}
Project Scope: PROY_03_RADARFONDOS

Content:
\`\`\`${isReactComponent ? 'tsx' : 'typescript'}
${content.substring(0, 5000)}
\`\`\`

Provide a brief analysis focusing on:
1. Logic errors
2. TypeScript issues
3. Performance optimization suggestions
4. Security concerns
5. Best practice violations

Keep response concise. If no issues found, say "No issues detected".`;

    return baseContext;
  }

  private hasSignificantFindings(analysis: string, _content: string): boolean {
    const lowerAnalysis = analysis.toLowerCase();
    const significantKeywords = [
      'error', 'warning', 'issue', 'problem', 'fix', 'suggestion',
      'optimization', 'performance', 'security', 'refactor', 'error:'
    ];
    
    const wordCount = analysis.split(/\s+/).length;
    if (wordCount < 10) return false;
    
    return significantKeywords.some(keyword => lowerAnalysis.includes(keyword));
  }

  private addToHistory(event: WatchEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistory) {
      this.eventHistory.shift();
    }
  }

  private clearDebounceTimers(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  getHistory(limit?: number): WatchEvent[] {
    if (limit) {
      return this.eventHistory.slice(-limit);
    }
    return [...this.eventHistory];
  }

  getStats() {
    return {
      isWatching: this.isWatching,
      watchedFiles: this.fileCache.size,
      pendingAnalysis: this.analysisQueue.size,
      eventCount: this.eventHistory.length,
      config: {
        projectRoot: this.config.projectRoot,
        debounceMs: this.config.debounceMs,
        maxFileSize: this.config.maxFileSize,
      },
    };
  }
}

export const codeWatcher = new CodeWatcher();
export default codeWatcher;
export { CodeWatcher, type WatchEvent, type WatcherConfig };