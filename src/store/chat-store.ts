import { create } from 'zustand';

import type { ChatMessage, Conversation, RunStatus } from '../contracts/chat';
import type { SearchMatch, WorkspaceEntry, WorkspaceSnapshot, WorkspaceSummary } from '../contracts/workspace';
import { createId } from '../lib/id';
import {
  bootstrapWorkspaceState,
  openWorkspacePicker,
  removeWorkspace,
  runAssistant,
  setActiveWorkspace,
} from '../services/repo-client';
import { buildThreadTitle } from '../features/desktop-shell/model';

interface ChatState {
  workspaces: WorkspaceEntry[];
  workspace: WorkspaceSummary | null;
  activeWorkspaceId: string | null;
  repoFiles: string[];
  repoSignals: SearchMatch[];
  threadsByWorkspace: Record<string, Conversation[]>;
  activeThreadIds: Record<string, string>;
  runStatus: RunStatus;
  isBootstrapped: boolean;
  bootstrap: () => Promise<void>;
  importWorkspace: () => Promise<void>;
  activateWorkspace: (workspaceId: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
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

function ensureWorkspaceThreads(
  threadsByWorkspace: Record<string, Conversation[]>,
  activeThreadIds: Record<string, string>,
  workspaceId: string,
) {
  const existingThreads = threadsByWorkspace[workspaceId];
  if (existingThreads && existingThreads.length > 0) {
    return {
      threadsByWorkspace,
      activeThreadIds: {
        ...activeThreadIds,
        [workspaceId]: activeThreadIds[workspaceId] ?? existingThreads[0].id,
      },
    };
  }

  const starterConversation = createEmptyConversation({
    id: createId(`thread-${workspaceId}`),
    title: 'New thread',
  });

  return {
    threadsByWorkspace: {
      ...threadsByWorkspace,
      [workspaceId]: [starterConversation],
    },
    activeThreadIds: {
      ...activeThreadIds,
      [workspaceId]: starterConversation.id,
    },
  };
}

function applyWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  threadsByWorkspace: Record<string, Conversation[]>,
  activeThreadIds: Record<string, string>,
) {
  const nextWorkspaceId = snapshot.activeWorkspaceId;
  const ensured = ensureWorkspaceThreads(threadsByWorkspace, activeThreadIds, nextWorkspaceId);

  return {
    workspaces: snapshot.workspaces,
    workspace: snapshot.workspace,
    activeWorkspaceId: snapshot.activeWorkspaceId,
    repoFiles: snapshot.files,
    repoSignals: snapshot.signals,
    threadsByWorkspace: ensured.threadsByWorkspace,
    activeThreadIds: ensured.activeThreadIds,
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  workspaces: [],
  workspace: null,
  activeWorkspaceId: null,
  repoFiles: [],
  repoSignals: [],
  threadsByWorkspace: {},
  activeThreadIds: {},
  runStatus: 'idle',
  isBootstrapped: false,
  async bootstrap() {
    if (get().isBootstrapped) {
      return;
    }

    const snapshot = await bootstrapWorkspaceState();

    set((state) => ({
      ...applyWorkspaceSnapshot(snapshot, state.threadsByWorkspace, state.activeThreadIds),
      isBootstrapped: true,
    }));
  },
  async importWorkspace() {
    const snapshot = await openWorkspacePicker();
    if (!snapshot) {
      return;
    }

    set((state) => ({
      ...applyWorkspaceSnapshot(snapshot, state.threadsByWorkspace, state.activeThreadIds),
      runStatus: 'idle',
    }));
  },
  async activateWorkspace(workspaceId) {
    const snapshot = await setActiveWorkspace(workspaceId);
    set((state) => ({
      ...applyWorkspaceSnapshot(snapshot, state.threadsByWorkspace, state.activeThreadIds),
      runStatus: 'idle',
    }));
  },
  async removeWorkspace(workspaceId) {
    const snapshot = await removeWorkspace(workspaceId);

    set((state) => {
      const nextThreadsByWorkspace = { ...state.threadsByWorkspace };
      const nextActiveThreadIds = { ...state.activeThreadIds };
      delete nextThreadsByWorkspace[workspaceId];
      delete nextActiveThreadIds[workspaceId];

      return {
        ...applyWorkspaceSnapshot(snapshot, nextThreadsByWorkspace, nextActiveThreadIds),
        runStatus: 'idle',
      };
    });
  },
  createThread() {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) {
      return;
    }

    const nextThread = createEmptyConversation();
    set((state) => ({
      activeThreadIds: {
        ...state.activeThreadIds,
        [workspaceId]: nextThread.id,
      },
      threadsByWorkspace: {
        ...state.threadsByWorkspace,
        [workspaceId]: [nextThread, ...(state.threadsByWorkspace[workspaceId] ?? [])],
      },
    }));
  },
  selectThread(threadId) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) {
      return;
    }

    set((state) => ({
      activeThreadIds: {
        ...state.activeThreadIds,
        [workspaceId]: threadId,
      },
    }));
  },
  async submitPrompt(prompt: string) {
    const trimmedPrompt = prompt.trim();
    const workspaceId = get().activeWorkspaceId;

    if (!trimmedPrompt || get().runStatus === 'running' || !workspaceId) {
      return;
    }

    const workspaceThreads = get().threadsByWorkspace[workspaceId] ?? [];
    const activeThreadId = get().activeThreadIds[workspaceId];
    const currentThread = workspaceThreads.find((thread) => thread.id === activeThreadId);
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
      threadsByWorkspace: {
        ...state.threadsByWorkspace,
        [workspaceId]: (state.threadsByWorkspace[workspaceId] ?? []).map((thread) =>
          thread.id !== state.activeThreadIds[workspaceId]
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
      },
    }));

    try {
      const execution = await runAssistant(trimmedPrompt, historyBeforePrompt);

      set((state) => ({
        runStatus: 'completed',
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [workspaceId]: (state.threadsByWorkspace[workspaceId] ?? [])
            .map((thread) =>
              thread.id !== state.activeThreadIds[workspaceId]
                ? thread
                : {
                    ...thread,
                    title: execution.suggestedTitle ?? thread.title,
                    lastUpdatedAt: execution.message.createdAt,
                    messages: [...thread.messages, execution.message],
                  },
            )
            .toSorted((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt)),
        },
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
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [workspaceId]: (state.threadsByWorkspace[workspaceId] ?? []).map((thread) =>
            thread.id !== state.activeThreadIds[workspaceId]
              ? thread
              : {
                  ...thread,
                  lastUpdatedAt: fallbackMessage.createdAt,
                  messages: [...thread.messages, fallbackMessage],
                },
          ),
        },
      }));
    }
  },
}));
