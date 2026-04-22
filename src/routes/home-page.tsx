import { useEffect, useRef, useState } from 'react';

import { useTheme } from '../hooks/use-theme';
import { useChatStore } from '../store/chat-store';
import { ChatTopbar } from '../features/desktop-shell/components/chat-topbar';
import { ComposerPanel } from '../features/desktop-shell/components/composer-panel';
import { MessageStream } from '../features/desktop-shell/components/message-stream';
import { getAppSettings } from '../services/settings-client';

export function HomePage() {
  const messageScrollerRef = useRef<HTMLDivElement | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [traceVersion, setTraceVersion] = useState<'v1' | 'v2'>('v2');
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
  const { theme, resolvedTheme, setTheme } = useTheme();

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
        }
      })
      .catch(() => {
        // Keep default trace mode when settings are unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <ChatTopbar
        conversation={selectedThread}
        onCreateThread={createThread}
        onImportWorkspace={importWorkspace}
        onThemeChange={setTheme}
        resolvedTheme={resolvedTheme}
        runStatus={runStatus}
        theme={theme}
        workspace={workspace}
      />
      <MessageStream
        canUndoLastTurn={canUndoLastTurn}
        hasActiveThread={selectedThread !== null}
        isRunning={runStatus === 'running'}
        messages={selectedThread?.messages ?? []}
        onUndoLastTurn={undoLastTurn}
        onVisibilityChange={setShowScrollButton}
        scrollerRef={messageScrollerRef}
        traceVersion={traceVersion}
        workspace={workspace}
      />
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
        onUndoLastTurn={undoLastTurn}
        trustContract={trustContract}
        workspace={workspace}
        resolvedTheme={resolvedTheme}
        showScrollButton={showScrollButton}
      />
    </section>
  );
}
