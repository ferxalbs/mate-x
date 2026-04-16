import { useEffect } from 'react';

import { Composer } from './components/composer';
import { ChatHeader } from './components/chat-header';
import { MessageCard } from './components/message-card';
import { WorkspacePanel } from './components/workspace-panel';
import { useChatStore } from '../../store/chat-store';

export function ChatShell() {
  const workspace = useChatStore((state) => state.workspace);
  const conversation = useChatStore((state) => state.conversation);
  const runStatus = useChatStore((state) => state.runStatus);
  const bootstrap = useChatStore((state) => state.bootstrap);
  const submitPrompt = useChatStore((state) => state.submitPrompt);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(119,195,255,0.12),transparent_28%),linear-gradient(180deg,var(--background),color-mix(in_oklab,var(--background)_86%,black))] text-[var(--foreground)]">
      <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col px-4 py-4 sm:px-6">
        <div className="overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_70%,transparent)] backdrop-blur">
          <ChatHeader workspace={workspace} />

          <div className="grid gap-6 p-4 lg:grid-cols-[330px_1fr] lg:p-6">
            <WorkspacePanel workspace={workspace} />

            <section className="flex min-h-[78vh] flex-col gap-4 rounded-[1.75rem] border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_92%,transparent)] p-4 sm:p-5">
              <div className="flex flex-1 flex-col gap-4 overflow-auto pr-1">
                {conversation.messages.map((message) => (
                  <MessageCard key={message.id} message={message} />
                ))}
              </div>

              <Composer isRunning={runStatus === 'running'} onSubmit={submitPrompt} />
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
