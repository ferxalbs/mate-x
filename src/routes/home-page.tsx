import { useCallback, useEffect, useRef, useState } from 'react';

import { useTheme } from '../hooks/use-theme';
import { useChatStore } from '../store/chat-store';
import { ChatTopbar } from '../features/desktop-shell/components/chat-topbar';
import { ChatWorkspace } from '../features/desktop-shell/components/chat-workspace';
import { ComposerPanel } from '../features/desktop-shell/components/composer-panel';
import type { EngineeringTaskViewModel } from '../features/engineering/engineering-task-panel';
import { getAppSettings } from '../services/settings-client';
import { listPolicyStops, resolvePolicyStop } from '../services/policy-client';
import {
  listEngineeringTasks,
} from '../services/engineering-client';
import type { AppSettings } from '../contracts/settings';
import type { PolicyStop, PolicyStopAction } from '../contracts/policy';
import type { AssistantRunOptions } from '../contracts/chat';
import { buildHomePageSubmission } from './home-page-submit-options';
import { toastManager } from '../components/ui/toast';
import { DEFAULT_BEHAVIOR_PREFERENCE, type BehaviorPreference } from '../contracts/behavior-mode';
import { loadBehaviorPreference, saveBehaviorPreference } from '../lib/behavior-preference';
import { updateWorkspaceTrustContract } from '../services/repo-client';
import type { WorkspaceWriteAccess } from '../contracts/workspace';
import { useVisibilityInterval } from '../hooks/use-visibility-interval';

export function HomePage() {
  const isSubmitting = useRef(false);
  const [, setTraceV2InlineEvents] = useState(false);
  const [pendingPolicyStop, setPendingPolicyStop] = useState<PolicyStop | null>(null);
  const [composerPrompt, setComposerPrompt] = useState('');
  const [activeEngineeringTask, setActiveEngineeringTask] =
    useState<EngineeringTaskViewModel | null>(null);
  const [behavior, setBehavior] = useState<BehaviorPreference>(DEFAULT_BEHAVIOR_PREFERENCE);
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
      const submission = buildHomePageSubmission(prompt, behavior, {
        ...overrides,
          // Resume same EngineeringTask when present — never second Capture on approve.
        engineeringTaskId:
          overrides?.engineeringTaskId ??
          activeEngineeringTask?.engineeringTaskId ??
          null,
      });
      await submitPrompt(submission.prompt, submission.options);
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
      behavior={behavior}
      onBehaviorChange={(next) => {
        setBehavior(next);
        if (activeWorkspaceId) saveBehaviorPreference(activeWorkspaceId, next);
      }}
      onTrustChange={async (writeAccess: WorkspaceWriteAccess) => {
        if (!trustContract) {
          throw new Error('No active workspace policy.');
        }

        const nextContract = await updateWorkspaceTrustContract({
          ...trustContract,
          writeAccess,
        });
        useChatStore.setState({ trustContract: nextContract });
      }}
    />
  );

  useEffect(() => {
    setBehavior(activeWorkspaceId ? loadBehaviorPreference(activeWorkspaceId) : DEFAULT_BEHAVIOR_PREFERENCE);
  }, [activeWorkspaceId]);

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

  const refreshPolicyStops = useCallback(async () => {
    try {
      const stops = await listPolicyStops();
      setPendingPolicyStop(stops.find((stop) => stop.status === 'open') ?? null);
    } catch {
      setPendingPolicyStop(null);
    }
  }, []);

  useVisibilityInterval(refreshPolicyStops, 2_000, { runImmediately: false });

  useEffect(() => {
    void refreshPolicyStops();
  }, [activeThreadId, refreshPolicyStops, runStatus]);

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
      <ChatWorkspace
        canUndoLastTurn={canUndoLastTurn}
        composer={composer}
        isBootstrapped={isBootstrapped}
        isRunning={runStatus === 'running'}
        lastError={lastError}
        messages={messages}
        onSelectPrompt={setComposerPrompt}
        onOpenRepository={importWorkspace}
        onSubmitPrompt={handleSubmitPrompt}
        onUndoLastTurn={undoLastTurn}
        workspace={workspace}
      />
    </section>
  );
}
