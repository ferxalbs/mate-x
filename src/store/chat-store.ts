import { create } from 'zustand';

import type {
  AssistantRunOptions,
  ChatMessage,
  Conversation,
  RunStatus,
} from '../contracts/chat';
import type {
  SearchMatch,
  WorkspaceEntry,
  WorkspaceSnapshot,
  WorkspaceSummary,
  WorkspaceTrustContract,
} from '../contracts/workspace';
import { createId } from '../lib/id';
import {
  bootstrapWorkspaceState,
  onAssistantProgress,
  openWorkspacePicker,
  removeWorkspace,
  runAssistant,
  saveWorkspaceSession,
  setActiveWorkspace,
} from '../services/repo-client';
import { buildThreadTitle } from '../features/desktop-shell/model';

interface ChatState {
  workspaces: WorkspaceEntry[];
  workspace: WorkspaceSummary | null;
  trustContract: WorkspaceTrustContract | null;
  activeWorkspaceId: string | null;
  repoFiles: string[];
  repoSignals: SearchMatch[];
  threadsByWorkspace: Record<string, Conversation[]>;
  activeThreadIds: Record<string, string>;
  activeRun: {
    runId: string;
    workspaceId: string;
    threadId: string;
    messageId: string;
  } | null;
  runStatus: RunStatus;
  isBootstrapped: boolean;
  bootstrap: () => Promise<void>;
  importWorkspace: () => Promise<void>;
  activateWorkspace: (workspaceId: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  createThread: () => void;
  selectThread: (threadId: string) => void;
  submitPrompt: (prompt: string, options: AssistantRunOptions) => Promise<void>;
  undoLastTurn: () => Promise<string | null>;
}

let assistantProgressUnsubscribe: (() => void) | null = null;

function createEmptyConversation(partial?: Partial<Conversation>): Conversation {
  return {
    id: partial?.id ?? createId('thread'),
    title: partial?.title ?? 'New thread',
    lastUpdatedAt: partial?.lastUpdatedAt ?? new Date().toISOString(),
    messages: partial?.messages ?? [],
  };
}

function applyWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  threadsByWorkspace: Record<string, Conversation[]>,
  activeThreadIds: Record<string, string>,
) {
  const nextWorkspaceId = snapshot.activeWorkspaceId;
  const snapshotThreads =
    snapshot.threads.length > 0
      ? snapshot.threads
      : [
          createEmptyConversation({
            id: createId(`thread-${nextWorkspaceId}`),
            title: 'New thread',
          }),
        ];
  const nextActiveThreadId = snapshot.activeThreadId || snapshotThreads[0].id;

  return {
    workspaces: snapshot.workspaces,
    workspace: snapshot.workspace,
    trustContract: snapshot.trustContract,
    activeWorkspaceId: snapshot.activeWorkspaceId,
    repoFiles: snapshot.files,
    repoSignals: snapshot.signals,
    threadsByWorkspace: {
      ...threadsByWorkspace,
      [nextWorkspaceId]: snapshotThreads,
    },
    activeThreadIds: {
      ...activeThreadIds,
      [nextWorkspaceId]: nextActiveThreadId,
    },
  };
}

async function persistWorkspaceState(
  workspaceId: string,
  threadsByWorkspace: Record<string, Conversation[]>,
  activeThreadIds: Record<string, string>,
) {
  const threads = threadsByWorkspace[workspaceId] ?? [];
  const activeThreadId = activeThreadIds[workspaceId] ?? threads[0]?.id;

  if (!activeThreadId) {
    return;
  }

  await saveWorkspaceSession(workspaceId, threads, activeThreadId);
}

function replaceMessageById(
  messages: ChatMessage[],
  messageId: string,
  nextMessage: ChatMessage,
) {
  const messageIndex = messages.findIndex((message) => message.id === messageId);

  if (messageIndex === -1) {
    return [...messages, nextMessage];
  }

  return messages.map((message, index) => (index === messageIndex ? nextMessage : message));
}

export const useChatStore = create<ChatState>((set, get) => ({
  workspaces: [],
  workspace: null,
  trustContract: null,
  activeWorkspaceId: null,
  repoFiles: [],
  repoSignals: [],
  threadsByWorkspace: {},
  activeThreadIds: {},
  activeRun: null,
  runStatus: 'idle',
  isBootstrapped: false,
  async bootstrap() {
    if (get().isBootstrapped) {
      return;
    }

    if (!assistantProgressUnsubscribe) {
      assistantProgressUnsubscribe = onAssistantProgress((progress) => {
        set((state) => {
          const activeRun = state.activeRun;
          if (!activeRun || activeRun.runId !== progress.runId) {
            return state;
          }

          const nextThreadsByWorkspace = {
            ...state.threadsByWorkspace,
            [activeRun.workspaceId]: (state.threadsByWorkspace[activeRun.workspaceId] ?? []).map(
              (thread) =>
                thread.id !== activeRun.threadId
                  ? thread
                  : {
                      ...thread,
                      lastUpdatedAt: new Date().toISOString(),
                      messages: thread.messages.map((message) =>
                        message.id !== activeRun.messageId
                          ? message
                          : {
                              ...message,
                              content: progress.content,
                              thought: progress.thought,
                              events: progress.events,
                              artifacts: progress.artifacts,
                            },
                      ),
                    },
            ),
          };

          return {
            runStatus: progress.status,
            threadsByWorkspace: nextThreadsByWorkspace,
          };
        });
      });
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
      activeRun: null,
      runStatus: 'idle',
    }));
  },
  async activateWorkspace(workspaceId) {
    const snapshot = await setActiveWorkspace(workspaceId);
    set((state) => ({
      ...applyWorkspaceSnapshot(snapshot, state.threadsByWorkspace, state.activeThreadIds),
      activeRun: null,
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
        activeRun: null,
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
    set((state) => {
      const nextState = {
        activeThreadIds: {
          ...state.activeThreadIds,
          [workspaceId]: nextThread.id,
        },
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [workspaceId]: [nextThread, ...(state.threadsByWorkspace[workspaceId] ?? [])],
        },
      };

      void persistWorkspaceState(workspaceId, nextState.threadsByWorkspace, nextState.activeThreadIds);

      return nextState;
    });
  },
  selectThread(threadId) {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) {
      return;
    }

    set((state) => {
      const nextState = {
        activeThreadIds: {
          ...state.activeThreadIds,
          [workspaceId]: threadId,
        },
      };

      void persistWorkspaceState(
        workspaceId,
        state.threadsByWorkspace,
        nextState.activeThreadIds,
      );

      return nextState;
    });
  },
  async submitPrompt(prompt: string, options: AssistantRunOptions) {
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
    const runId = createId('run');
    const assistantPlaceholder: ChatMessage = {
      id: createId('assistant'),
      role: 'assistant',
      content:
        "Reviewing the repository structure and locating the files tied to your request. I'll keep iterating with tools before answering.",
      createdAt: new Date().toISOString(),
      events: [],
      artifacts: [],
    };

    set((state) => {
      const nextThreadsByWorkspace = {
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
                lastUpdatedAt: assistantPlaceholder.createdAt,
                messages: [...thread.messages, userMessage, assistantPlaceholder],
              },
        ),
      };

      void persistWorkspaceState(workspaceId, nextThreadsByWorkspace, state.activeThreadIds);

      return {
        activeRun: {
          runId,
          workspaceId,
          threadId: activeThreadId,
          messageId: assistantPlaceholder.id,
        },
        runStatus: 'running',
        threadsByWorkspace: nextThreadsByWorkspace,
      };
    });

    try {
      const execution = await runAssistant(trimmedPrompt, historyBeforePrompt, options, runId);

      set((state) => {
        const activeRun = state.activeRun;
        const nextThreadsByWorkspace = {
          ...state.threadsByWorkspace,
          [workspaceId]: (state.threadsByWorkspace[workspaceId] ?? [])
            .map((thread) =>
              thread.id !== (activeRun?.threadId ?? state.activeThreadIds[workspaceId])
                ? thread
                : {
                    ...thread,
                    title: execution.suggestedTitle ?? thread.title,
                    lastUpdatedAt: execution.message.createdAt,
                    messages:
                      activeRun && activeRun.runId === runId
                        ? replaceMessageById(
                            thread.messages,
                            activeRun.messageId,
                            execution.message,
                          )
                        : [...thread.messages, execution.message],
                  },
            )
            .toSorted((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt)),
        };

        void persistWorkspaceState(workspaceId, nextThreadsByWorkspace, state.activeThreadIds);

        return {
          activeRun:
            state.activeRun?.runId === runId ? null : state.activeRun,
          runStatus: 'completed',
          threadsByWorkspace: nextThreadsByWorkspace,
        };
      });
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

      set((state) => {
        const activeRun = state.activeRun;
        const nextThreadsByWorkspace = {
          ...state.threadsByWorkspace,
          [workspaceId]: (state.threadsByWorkspace[workspaceId] ?? []).map((thread) =>
            thread.id !== (activeRun?.threadId ?? state.activeThreadIds[workspaceId])
              ? thread
              : {
                  ...thread,
                  lastUpdatedAt: fallbackMessage.createdAt,
                  messages:
                    activeRun && activeRun.runId === runId
                      ? replaceMessageById(
                          thread.messages,
                          activeRun.messageId,
                          fallbackMessage,
                        )
                      : [...thread.messages, fallbackMessage],
                },
          ),
        };

        void persistWorkspaceState(workspaceId, nextThreadsByWorkspace, state.activeThreadIds);

        return {
          activeRun:
            state.activeRun?.runId === runId ? null : state.activeRun,
          runStatus: 'failed',
          threadsByWorkspace: nextThreadsByWorkspace,
        };
      });
    }
  },
  async undoLastTurn() {
    const workspaceId = get().activeWorkspaceId;

    if (!workspaceId || get().runStatus === 'running') {
      return null;
    }

    const threads = get().threadsByWorkspace[workspaceId] ?? [];
    const activeThreadId = get().activeThreadIds[workspaceId];
    const currentThread = threads.find((thread) => thread.id === activeThreadId);

    if (!currentThread) {
      return null;
    }

    const lastUserIndex = currentThread.messages.findLastIndex((message) => message.role === 'user');
    if (lastUserIndex === -1) {
      return null;
    }

    const restoredPrompt = currentThread.messages[lastUserIndex]?.content ?? null;
    const nextMessages = currentThread.messages.slice(0, lastUserIndex);
    const nextLastUpdatedAt =
      nextMessages.at(-1)?.createdAt ?? new Date().toISOString();

    const nextThreads = threads.map((thread) =>
      thread.id !== activeThreadId
        ? thread
        : {
            ...thread,
            lastUpdatedAt: nextLastUpdatedAt,
            messages: nextMessages,
            title: nextMessages.length === 0 ? 'New thread' : thread.title,
          },
    );

    set((state) => ({
      threadsByWorkspace: {
        ...state.threadsByWorkspace,
        [workspaceId]: nextThreads,
      },
    }));

    await persistWorkspaceState(
      workspaceId,
      {
        ...get().threadsByWorkspace,
        [workspaceId]: nextThreads,
      },
      get().activeThreadIds,
    );

    return restoredPrompt;
  },
}));
