import { create } from 'zustand';

import type { ChatMessage, Conversation, RunStatus } from '../contracts/chat';
import type { WorkspaceSummary } from '../contracts/workspace';
import { createId } from '../lib/id';
import { runRepositoryAudit } from '../services/audit-service';
import { getWorkspaceSummary } from '../services/workspace-service';

interface ChatState {
  workspace: WorkspaceSummary | null;
  conversation: Conversation;
  runStatus: RunStatus;
  isBootstrapped: boolean;
  bootstrap: () => Promise<void>;
  submitPrompt: (prompt: string) => Promise<void>;
}

const starterConversation: Conversation = {
  id: 'conversation-main',
  title: 'Repo audit session',
  lastUpdatedAt: new Date().toISOString(),
  messages: [
    {
      id: 'assistant-intro',
      role: 'assistant',
      createdAt: new Date().toISOString(),
      content:
        'Workspace loaded. Ask for an audit, repo review, architecture pass, or implementation plan.',
    },
  ],
};

export const useChatStore = create<ChatState>((set, get) => ({
  workspace: null,
  conversation: starterConversation,
  runStatus: 'idle',
  isBootstrapped: false,
  async bootstrap() {
    if (get().isBootstrapped) {
      return;
    }

    const workspace = await getWorkspaceSummary();
    set({
      workspace,
      isBootstrapped: true,
    });
  },
  async submitPrompt(prompt: string) {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || get().runStatus === 'running') {
      return;
    }

    const userMessage: ChatMessage = {
      id: createId('user'),
      role: 'user',
      content: trimmedPrompt,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      runStatus: 'running',
      conversation: {
        ...state.conversation,
        lastUpdatedAt: userMessage.createdAt,
        messages: [...state.conversation.messages, userMessage],
      },
    }));

    const execution = await runRepositoryAudit(trimmedPrompt);

    const assistantMessage: ChatMessage = {
      id: createId('assistant'),
      role: 'assistant',
      content: execution.report.headline,
      createdAt: execution.report.createdAt,
      events: execution.events,
      report: execution.report,
    };

    set((state) => ({
      runStatus: 'completed',
      conversation: {
        ...state.conversation,
        lastUpdatedAt: assistantMessage.createdAt,
        messages: [...state.conversation.messages, assistantMessage],
      },
    }));
  },
}));
