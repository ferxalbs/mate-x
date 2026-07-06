import type { RefObject, ReactNode } from "react";

import type { ChatMessage } from "../../../contracts/chat";
import type { WorkspaceSummary } from "../../../contracts/workspace";
import { useChatStore } from "../../../store/chat-store";
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
  onSelectPrompt: (prompt: string) => void;
  onUndoLastTurn: () => Promise<string | null>;
  workspace: WorkspaceSummary | null;
}

const floatingComposerHeight = 228;

export function ChatWorkspace({
  canUndoLastTurn,
  composer,
  isBootstrapped,
  isRunning,
  lastError,
  messages,
  onSelectPrompt,
  onUndoLastTurn,
  workspace,
}: ChatWorkspaceProps) {
  const settings = useChatStore((state) => state.settings);
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
            onUndoLastTurn={onUndoLastTurn}
          />
        ) : (
          <EmptyChatState
            composer={composer}
            isBootstrapped={isBootstrapped}
            lastError={lastError}
            onSelectPrompt={onSelectPrompt}
            workspace={workspace}
          />
        )}
        {hasMessages ? (
          <ComposerDock hasMessages={hasMessages}>
            {composer}
          </ComposerDock>
        ) : null}
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
