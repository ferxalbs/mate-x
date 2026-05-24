export interface AgentRuntimeConfig {
  maxIterations: number;
  minToolRounds: number;
  maxToolCalls: number;
  requireToolingFirst: boolean;
  executionIntent: boolean;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments?: string;
}
