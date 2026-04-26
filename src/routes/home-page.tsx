import { useEffect, useRef, useState } from 'react';

import { useTheme } from '../hooks/use-theme';
import { useChatStore } from '../store/chat-store';
import { ChatTopbar } from '../features/desktop-shell/components/chat-topbar';
import { ComposerPanel } from '../features/desktop-shell/components/composer-panel';
import { MessageStream } from '../features/desktop-shell/components/message-stream';
import { getAppSettings } from '../services/settings-client';
import { listPolicyStops, resolvePolicyStop } from '../services/policy-client';
import type { AppSettings } from '../contracts/settings';
import type { PolicyStop, PolicyStopAction } from '../contracts/policy';

export function HomePage() {
  const messageScrollerRef = useRef<HTMLDivElement | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [traceVersion, setTraceVersion] = useState<'v1' | 'v2'>('v2');
  const [traceV2InlineEvents, setTraceV2InlineEvents] = useState(false);
  const [pendingPolicyStop, setPendingPolicyStop] = useState<PolicyStop | null>(null);
  const workspace = useChatStore((state) => state.workspace);
  const trustContract = useChatStore((state) => state.trustContract);
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const threadsByWorkspace = useChatStore((state) => state.threadsByWorkspace);
  const activeThreadIds = useChatStore((state) => state.activeThreadIds);
  const runStatus = useChatStore((state) => state.runStatus);
  const importWorkspace = useChatStore((state) => state.importWorkspace);
  const createThread = useChatStore((state) => state.createThread);
  const submitPrompt = useChatStore((state) => state.submitPrompt);
  const undoLastTurn = useChatStore((state) => state.undoLastTurn);
  const settings = useChatStore((state) => state.settings);
  const { resolvedTheme, setTheme } = useTheme();

  const threads = activeWorkspaceId ? (threadsByWorkspace[activeWorkspaceId] ?? []) : [];
  const activeThreadId = activeWorkspaceId ? (activeThreadIds[activeWorkspaceId] ?? '') : '';
  const selectedThread = threads.find((thread) => thread.id === activeThreadId) ?? null;
  const canUndoLastTurn =
    runStatus !== 'running' &&
    (selectedThread?.messages ?? []).some((message) => message.role === 'user');

  useEffect(() => {
    let cancelled = false;
    void getAppSettings()
      .then((settings) => {
        if (!cancelled) {
          setTraceVersion(settings.agentTraceVersion);
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

  async function handleResolvePolicyStop(stop: PolicyStop, action: PolicyStopAction) {
    await resolvePolicyStop({ stopId: stop.id, action });
    setPendingPolicyStop(null);
  }

  useEffect(() => {
    const handleSettingsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<AppSettings>;
      const nextSettings = customEvent.detail;
      if (!nextSettings) return;
      setTraceVersion(nextSettings.agentTraceVersion);
      setTraceV2InlineEvents(nextSettings.agentTraceV2InlineEvents);
    };

    window.addEventListener('mate:app-settings-updated', handleSettingsUpdated as EventListener);
    return () => {
      window.removeEventListener('mate:app-settings-updated', handleSettingsUpdated as EventListener);
    };
  }, []);

  return (
    <section className="relative flex min-w-0 flex-1 flex-col bg-background">
      <ChatTopbar
        conversation={selectedThread}
        onCreateThread={createThread}
        onImportWorkspace={importWorkspace}
        onThemeChange={setTheme}
        resolvedTheme={resolvedTheme}
        runStatus={runStatus}
        workspace={workspace}
      />
      {/*
        padding-bottom (border-box) shrinks the flex content area by the panel
        height — MessageStream fills only the reduced area so content never
        falls behind the floating panel. The gradient overlay in the padding
        zone gives the glass panel real colors to blur against.
      */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        style={{ paddingBottom: settings.floatingInput ? 152 : 0 }}
      >
        <MessageStream
          canUndoLastTurn={canUndoLastTurn}
          hasActiveThread={selectedThread !== null}
          isRunning={runStatus === 'running'}
          messages={selectedThread?.messages ?? []}
          onUndoLastTurn={undoLastTurn}
          onVisibilityChange={setShowScrollButton}
          scrollerRef={messageScrollerRef}
          traceVersion={traceVersion}
          traceV2InlineEvents={traceV2InlineEvents}
          workspace={workspace}
        />
        {settings.floatingInput ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[152px] bg-gradient-to-t from-background via-background/60 to-transparent" />
        ) : null}
      </div>
      <ComposerPanel
        canUndoLastTurn={canUndoLastTurn}
        isRunning={runStatus === 'running'}
        onScrollToBottom={() =>
          messageScrollerRef.current?.scrollTo({
            top: messageScrollerRef.current.scrollHeight,
            behavior: 'smooth',
          })
        }
        onSubmit={submitPrompt}
        onResolvePolicyStop={handleResolvePolicyStop}
        onUndoLastTurn={undoLastTurn}
        pendingPolicyStop={pendingPolicyStop}
        trustContract={trustContract}
        workspace={workspace}
        resolvedTheme={resolvedTheme}
        showScrollButton={showScrollButton}
      />
    </section>
  );
}
