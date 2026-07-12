import { useCallback, useEffect, useRef, useState } from 'react';

import { useTheme } from '../hooks/use-theme';
import { useChatStore } from '../store/chat-store';
import { ChatTopbar } from '../features/desktop-shell/components/chat-topbar';
import { ChatWorkspace } from '../features/desktop-shell/components/chat-workspace';
import { ComposerPanel } from '../features/desktop-shell/components/composer-panel';
import {
  EngineeringTaskPanel,
  type EngineeringPrimaryAction,
  type EngineeringTaskViewModel,
} from '../features/engineering/engineering-task-panel';
import { getAppSettings } from '../services/settings-client';
import { listPolicyStops, resolvePolicyStop } from '../services/policy-client';
import {
  dispatchPrimaryEngineeringAction,
  listEngineeringTasks,
} from '../services/engineering-client';
import type { AppSettings } from '../contracts/settings';
import type { PolicyStop, PolicyStopAction } from '../contracts/policy';
import type { AssistantRunOptions } from '../contracts/chat';
import { buildHomePageSubmitOptions } from './home-page-submit-options';
import { toastManager } from '../components/ui/toast';

export function HomePage() {
  const isSubmitting = useRef(false);
  const [, setTraceV2InlineEvents] = useState(false);
  const [pendingPolicyStop, setPendingPolicyStop] = useState<PolicyStop | null>(null);
  const [composerPrompt, setComposerPrompt] = useState('');
  const [activeEngineeringTask, setActiveEngineeringTask] =
    useState<EngineeringTaskViewModel | null>(null);
  const [ctaBusy, setCtaBusy] = useState(false);
  const workspace = useChatStore((state) => state.workspace);
  const trustContract = useChatStore((state) => state.trustContract);
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const threadsByWorkspace = useChatStore((state) => state.threadsByWorkspace);
  const activeThreadIds = useChatStore((state) => state.activeThreadIds);
  const runStatus = useChatStore((state) => state.runStatus);
  const isBootstrapped = useChatStore((state) => state.isBootstrapped);
  const lastError = useChatStore((state) => state.lastError);
  const importWorkspace = useChatStore((state) => state.importWorkspace);
  const createThread = useChatStore((state) => state.createThread);
  const submitPrompt = useChatStore((state) => state.submitPrompt);
  const undoLastTurn = useChatStore((state) => state.undoLastTurn);
  const { resolvedTheme, setAppearance } = useTheme();

  const threads = activeWorkspaceId ? (threadsByWorkspace[activeWorkspaceId] ?? []) : [];
  const activeThreadId = activeWorkspaceId ? (activeThreadIds[activeWorkspaceId] ?? '') : '';
  const selectedThread = threads.find((thread) => thread.id === activeThreadId) ?? null;
  const messages = selectedThread?.messages ?? [];
  const canUndoLastTurn =
    runStatus !== 'running' &&
    messages.some((message) => message.role === 'user');

  async function handleResolvePolicyStop(stop: PolicyStop, action: PolicyStopAction) {
    await resolvePolicyStop({ stopId: stop.id, action });
    setPendingPolicyStop(null);
  }

  const handleSubmitPrompt = async (prompt: string, overrides?: Partial<AssistantRunOptions>) => {
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    
    try {
      await submitPrompt(prompt, {
        ...buildHomePageSubmitOptions({
          ...overrides,
          // Resume same EngineeringTask when present — never second Capture on approve.
          engineeringTaskId:
            overrides?.engineeringTaskId ??
            activeEngineeringTask?.engineeringTaskId ??
            null,
        }),
      });
    } catch (err) {
      toastManager.add({
        type: "error",
        title: "Submission failed",
        description: err instanceof Error ? err.message : "An error occurred.",
      });
    } finally {
      isSubmitting.current = false;
    }
  };

  const composer = (
    <ComposerPanel
      canUndoLastTurn={canUndoLastTurn}
      isRunning={runStatus === 'running'}
      onSubmit={handleSubmitPrompt}
      onResolvePolicyStop={handleResolvePolicyStop}
      onUndoLastTurn={undoLastTurn}
      pendingPolicyStop={pendingPolicyStop}
      trustContract={trustContract}
      workspace={workspace}
      prompt={composerPrompt}
      onPromptChange={setComposerPrompt}
    />
  );

  useEffect(() => {
    let cancelled = false;
    void getAppSettings()
      .then((settings) => {
        if (!cancelled) {
          setTraceV2InlineEvents(settings.agentTraceV2InlineEvents);
        }
      })
      .catch(() => {
        // Keep default trace mode when settings are unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshEngineeringTasks = useCallback(async () => {
    if (!activeWorkspaceId) {
      setActiveEngineeringTask(null);
      return;
    }
    try {
      const tasks = await listEngineeringTasks(activeWorkspaceId);
      const latest = Array.isArray(tasks) ? tasks[0] : null;
      if (
        latest &&
        typeof latest === 'object' &&
        latest !== null &&
        'engineeringTaskId' in latest
      ) {
        const row = latest as Record<string, unknown>;
        setActiveEngineeringTask({
          engineeringTaskId: String(row.engineeringTaskId),
          title: String(row.title ?? 'Engineering task'),
          status: row.status as EngineeringTaskViewModel['status'],
          readiness: row.readiness as EngineeringTaskViewModel['readiness'],
          objectivePreview: String(
            row.objectivePreview ?? row.title ?? '',
          ),
          aggregateVersion: Number(row.aggregateVersion ?? 1),
        });
      }
    } catch {
      // IPC unavailable in pure renderer unit tests
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void refreshEngineeringTasks();
  }, [refreshEngineeringTasks, runStatus, messages.length]);

  const handlePrimaryAction = useCallback(
    async (action: EngineeringPrimaryAction) => {
      if (!activeWorkspaceId || !activeEngineeringTask) return;
      setCtaBusy(true);
      try {
        const result = (await dispatchPrimaryEngineeringAction({
          workspaceId: activeWorkspaceId,
          engineeringTaskId: activeEngineeringTask.engineeringTaskId,
          action,
          aggregateVersion: activeEngineeringTask.aggregateVersion,
        })) as { ok?: boolean; error?: { message?: string }; data?: { status?: string } };

        if (result && result.ok === false) {
          toastManager.add({
            type: 'error',
            title: 'Action failed',
            description: result.error?.message ?? 'Command rejected',
          });
          return;
        }

        await refreshEngineeringTasks();

        // After approval, start a new execution run ID on the same EngineeringTask.
        if (
          action.id === 'approve_plan' &&
          action.commandType === 'ApprovePlanAndTasks'
        ) {
          const executionRunPrompt =
            `Execute the approved plan for engineering task ${activeEngineeringTask.engineeringTaskId}. ` +
            `Apply the planned patch, run validation, and produce Ship Proof. Do not recapture the objective.`;
          await handleSubmitPrompt(executionRunPrompt, {
            engineeringTaskId: activeEngineeringTask.engineeringTaskId,
            pathKind: 'full',
            access: 'approval',
            runbookId: 'patch_test_verify',
          });
        } else if (action.id === 'start_execution') {
          await handleSubmitPrompt(
            `Continue execution for ${activeEngineeringTask.engineeringTaskId}`,
            {
              engineeringTaskId: activeEngineeringTask.engineeringTaskId,
              pathKind: 'full',
              access: 'approval',
            },
          );
        } else if (action.id === 'run_validation') {
          await handleSubmitPrompt(
            `Run validation for ${activeEngineeringTask.engineeringTaskId}`,
            {
              engineeringTaskId: activeEngineeringTask.engineeringTaskId,
              pathKind: 'verify_only',
              access: 'approval',
              runbookId: 'patch_test_verify',
            },
          );
        }
      } catch (err) {
        toastManager.add({
          type: 'error',
          title: 'Action failed',
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setCtaBusy(false);
        void refreshEngineeringTasks();
      }
    },
    [activeWorkspaceId, activeEngineeringTask, refreshEngineeringTasks],
  );

  useEffect(() => {
    let cancelled = false;

    async function refreshPolicyStops() {
      try {
        const stops = await listPolicyStops();
        if (!cancelled) {
          setPendingPolicyStop(stops.find((stop) => stop.status === 'open') ?? null);
        }
      } catch {
        if (!cancelled) {
          setPendingPolicyStop(null);
        }
      }
    }

    void refreshPolicyStops();
    const interval = window.setInterval(refreshPolicyStops, 750);
    window.addEventListener('focus', refreshPolicyStops);
    document.addEventListener('visibilitychange', refreshPolicyStops);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshPolicyStops);
      document.removeEventListener('visibilitychange', refreshPolicyStops);
    };
  }, [activeThreadId, runStatus]);

  useEffect(() => {
    const handleSettingsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<AppSettings>;
      const nextSettings = customEvent.detail;
      if (!nextSettings) return;
      setTraceV2InlineEvents(nextSettings.agentTraceV2InlineEvents);
    };

    window.addEventListener('mate:app-settings-updated', handleSettingsUpdated as EventListener);
    return () => {
      window.removeEventListener('mate:app-settings-updated', handleSettingsUpdated as EventListener);
    };
  }, []);

  return (
    <section className="relative flex h-full min-w-0 flex-1 flex-col bg-transparent text-foreground">
      <ChatTopbar
        conversation={selectedThread}
        onCreateThread={createThread}
        onImportWorkspace={importWorkspace}
        onAppearanceChange={setAppearance}
        resolvedTheme={resolvedTheme}
        runStatus={runStatus}
        workspace={workspace}
      />
      <div className="shrink-0 border-b border-border/40 px-4 py-2">
        <EngineeringTaskPanel
          task={activeEngineeringTask}
          busy={runStatus === 'running' || ctaBusy}
          onPrimaryAction={handlePrimaryAction}
        />
      </div>
      <ChatWorkspace
        canUndoLastTurn={canUndoLastTurn}
        composer={composer}
        isBootstrapped={isBootstrapped}
        isRunning={runStatus === 'running'}
        lastError={lastError}
        messages={messages}
        onSelectPrompt={setComposerPrompt}
        onSubmitPrompt={handleSubmitPrompt}
        onUndoLastTurn={undoLastTurn}
        workspace={workspace}
      />
    </section>
  );
}

