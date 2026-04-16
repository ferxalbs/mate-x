import type { AuditReport } from './audit';

export type MessageRole = 'user' | 'assistant';
export type RunStatus = 'idle' | 'running' | 'completed';

export interface ToolEvent {
  id: string;
  label: string;
  detail: string;
  status: 'done' | 'active';
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  events?: ToolEvent[];
  report?: AuditReport;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  lastUpdatedAt: string;
}
