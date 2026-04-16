import { useEffect } from 'react';

import { useChatStore } from '../../store/chat-store';
import { AppSidebar } from './components/app-sidebar';
import { ChatTopbar } from './components/chat-topbar';
import { ComposerPanel } from './components/composer-panel';
import { MessageStream } from './components/message-stream';

export function DesktopShell() {
  const workspace = useChatStore((state) => state.workspace);
  const conversation = useChatStore((state) => state.conversation);
  const runStatus = useChatStore((state) => state.runStatus);
  const bootstrap = useChatStore((state) => state.bootstrap);
  const submitPrompt = useChatStore((state) => state.submitPrompt);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <main className="relative flex h-screen w-full overflow-hidden">
      <div className="relative grid h-full w-full grid-cols-[288px_minmax(0,1fr)] overflow-hidden bg-[var(--background)]">
        <AppSidebar conversation={conversation} workspace={workspace} />

        <section className="flex min-h-0 min-w-0 flex-col bg-[var(--background)]">
          <ChatTopbar conversation={conversation} workspace={workspace} />
          <MessageStream messages={conversation.messages} />
          <ComposerPanel isRunning={runStatus === 'running'} onSubmit={submitPrompt} />
        </section>
      </div>
    </main>
  );
}
