import { useEffect, useRef, useState } from 'react';

import { useTheme } from '../hooks/use-theme';
import { useChatStore } from '../store/chat-store';
import { ChatTopbar } from '../features/desktop-shell/components/chat-topbar';
import { ChatWorkspace } from '../features/desktop-shell/components/chat-workspace';
import { ComposerPanel } from '../features/desktop-shell/components/composer-panel';
import { getAppSettings } from '../services/settings-client';
import { listPolicyStops, resolvePolicyStop } from '../services/policy-client';
import type { AppSettings } from '../contracts/settings';
import type { PolicyStop, PolicyStopAction } from '../contracts/policy';

export function HomePage() {
  const [traceV2InlineEvents, setTraceV2InlineEvents] = useState(false);
  const [pendingPolicyStop, setPendingPolicyStop] = useState<PolicyStop | null>(null);
  const [composerPrompt, setComposerPrompt] = useState('');
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

  const composer = (
    <ComposerPanel
      canUndoLastTurn={canUndoLastTurn}
      isRunning={runStatus === 'running'}
      onSubmit={submitPrompt}
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
      <ChatWorkspace
        canUndoLastTurn={canUndoLastTurn}
        composer={composer}
        isBootstrapped={isBootstrapped}
        isRunning={runStatus === 'running'}
        lastError={lastError}
        messages={messages}
        onSelectPrompt={setComposerPrompt}
        onUndoLastTurn={undoLastTurn}
        workspace={workspace}
      />
    </section>
  );
}
