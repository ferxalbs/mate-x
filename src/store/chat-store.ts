import { create } from 'zustand';

import type { ChatMessage, Conversation, RunStatus } from '../contracts/chat';
import type { SearchMatch, WorkspaceSummary } from '../contracts/workspace';
import { createId } from '../lib/id';
import { runAssistant } from '../services/assistant-service';
import { getWorkspaceSummary, listRepoFiles, searchRepoFiles } from '../services/repo-client';
import { buildThreadTitle } from '../features/desktop-shell/model';

interface ChatState {
  workspace: WorkspaceSummary | null;
  repoFiles: string[];
  repoSignals: SearchMatch[];
  threads: Conversation[];
  activeThreadId: string;
  runStatus: RunStatus;
  isBootstrapped: boolean;
  bootstrap: () => Promise<void>;
  createThread: () => void;
  selectThread: (threadId: string) => void;
  submitPrompt: (prompt: string) => Promise<void>;
}

function createEmptyConversation(partial?: Partial<Conversation>): Conversation {
  return {
    id: partial?.id ?? createId('thread'),
    title: partial?.title ?? 'New thread',
    lastUpdatedAt: partial?.lastUpdatedAt ?? new Date().toISOString(),
    messages: partial?.messages ?? [],
  };
}

const starterConversation = createEmptyConversation({
  id: 'thread-main',
  title: 'Mate-X workspace',
  lastUpdatedAt: new Date().toISOString(),
  messages: [
    {
      id: 'assistant-intro',
      role: 'assistant',
      createdAt: new Date().toISOString(),
      content:
        'Mate-X is ready. Ask for a UI pass, repo change, implementation step, or code review.',
      artifacts: [
        { id: 'intro-provider', label: 'Provider', value: 'OpenAI-ready', tone: 'success' },
        { id: 'intro-surface', label: 'Surface', value: 'Desktop shell' },
      ],
    },
  ],
});

export const useChatStore = create<ChatState>((set, get) => ({
  workspace: null,
  repoFiles: [],
  repoSignals: [],
  threads: [starterConversation],
  activeThreadId: starterConversation.id,
  runStatus: 'idle',
  isBootstrapped: false,
  async bootstrap() {
    if (get().isBootstrapped) {
      return;
    }

    const [workspace, repoFiles, repoSignals] = await Promise.all([
      getWorkspaceSummary(),
      listRepoFiles(18),
      searchRepoFiles('OpenAI|ipc|thread|sidebar|composer', 10),
    ]);

    set({
      workspace,
      repoFiles,
      repoSignals,
      isBootstrapped: true,
    });
  },
  createThread() {
    const nextThread = createEmptyConversation();
    set((state) => ({
      activeThreadId: nextThread.id,
      threads: [nextThread, ...state.threads],
    }));
  },
  selectThread(threadId) {
    set({ activeThreadId: threadId });
  },
  async submitPrompt(prompt: string) {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || get().runStatus === 'running') {
      return;
    }

    const currentThread = get().threads.find((thread) => thread.id === get().activeThreadId);
    if (!currentThread) {
      return;
    }
    const historyBeforePrompt = currentThread.messages.map(
      (message) => `${message.role}: ${message.content}`,
    );

    const userMessage: ChatMessage = {
      id: createId('user'),
      role: 'user',
      content: trimmedPrompt,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      runStatus: 'running',
      threads: state.threads.map((thread) =>
        thread.id !== state.activeThreadId
          ? thread
          : {
              ...thread,
              title:
                thread.messages.length === 0 || thread.title === 'New thread'
                  ? buildThreadTitle(trimmedPrompt)
                  : thread.title,
              lastUpdatedAt: userMessage.createdAt,
              messages: [...thread.messages, userMessage],
            },
      ),
    }));

    try {
      const execution = await runAssistant(trimmedPrompt, historyBeforePrompt);

      set((state) => ({
        runStatus: 'completed',
        threads: state.threads
          .map((thread) =>
            thread.id !== state.activeThreadId
              ? thread
              : {
                  ...thread,
                  title: execution.suggestedTitle ?? thread.title,
                  lastUpdatedAt: execution.message.createdAt,
                  messages: [...thread.messages, execution.message],
                },
          )
          .toSorted((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt)),
      }));
    } catch (error) {
      const fallbackMessage: ChatMessage = {
        id: createId('assistant'),
        role: 'assistant',
        content:
          error instanceof Error
            ? `The assistant failed before responding.\n\n${error.message}`
            : 'The assistant failed before responding.',
        createdAt: new Date().toISOString(),
        artifacts: [{ id: 'assistant-error', label: 'Status', value: 'Failed', tone: 'warning' }],
      };

      set((state) => ({
        runStatus: 'failed',
        threads: state.threads.map((thread) =>
          thread.id !== state.activeThreadId
            ? thread
            : {
                ...thread,
                lastUpdatedAt: fallbackMessage.createdAt,
                messages: [...thread.messages, fallbackMessage],
              },
        ),
      }));
    }
  },
}));
