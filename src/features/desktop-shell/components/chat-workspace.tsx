import type { ReactNode } from "react";

import type { AssistantRunOptions, ChatMessage } from "../../../contracts/chat";
import type { WorkspaceSummary } from "../../../contracts/workspace";
import { ComposerDock } from "./composer-dock";
import { EmptyChatState } from "./empty-chat-state";
import { MessageStream } from "./message-stream";
import { MessageScroller, MessageScrollerProvider } from "../../../components/ui/message-scroller";

interface ChatWorkspaceProps {
  canUndoLastTurn: boolean;
  composer: ReactNode;
  isBootstrapped: boolean;
  isRunning: boolean;
  lastError: string | null;
  messages: ChatMessage[];
  onSelectPrompt: (
    prompt: string,
    overrides?: Partial<AssistantRunOptions>,
  ) => Promise<void> | void;
  onSubmitPrompt?: (
    prompt: string,
    overrides?: Partial<AssistantRunOptions>,
  ) => Promise<void> | void;
  onUndoLastTurn: () => Promise<string | null>;
  onOpenRepository: () => Promise<void> | void;
  workspace: WorkspaceSummary | null;
}

export function ChatWorkspace({
  canUndoLastTurn,
  composer,
  isBootstrapped,
  isRunning,
  lastError,
  messages,
  onSelectPrompt,
  onSubmitPrompt,
  onUndoLastTurn,
  onOpenRepository,
  workspace,
}: ChatWorkspaceProps) {
  const hasMessages = messages.length > 0;

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="bg-transparent">
        {hasMessages ? (
          <MessageStream
            canUndoLastTurn={canUndoLastTurn}
            isRunning={isRunning}
            messages={messages}
            onSelectPrompt={onSelectPrompt}
            onSubmitPrompt={onSubmitPrompt}
            onUndoLastTurn={onUndoLastTurn}
          />
        ) : (
          <EmptyChatState
            composer={composer}
            isBootstrapped={isBootstrapped}
            isRunning={isRunning}
            lastError={lastError}
            onSelectPrompt={onSubmitPrompt ?? onSelectPrompt}
            onOpenRepository={onOpenRepository}
            workspace={workspace}
          />
        )}
        {hasMessages ? <ComposerDock>{composer}</ComposerDock> : null}
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
