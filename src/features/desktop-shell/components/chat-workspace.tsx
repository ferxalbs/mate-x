import type { RefObject, ReactNode } from "react";

import type { ChatMessage } from "../../../contracts/chat";
import type { WorkspaceSummary } from "../../../contracts/workspace";
import { useChatStore } from "../../../store/chat-store";
import { ComposerDock } from "./composer-dock";
import { EmptyChatState } from "./empty-chat-state";
import { MessageStream } from "./message-stream";

interface ChatWorkspaceProps {
  canUndoLastTurn: boolean;
  composer: ReactNode;
  isBootstrapped: boolean;
  isRunning: boolean;
  lastError: string | null;
  messages: ChatMessage[];
  onScrollToBottom: () => void;
  onSelectPrompt: (prompt: string) => void;
  onUndoLastTurn: () => Promise<string | null>;
  onVisibilityChange: (visible: boolean) => void;
  scrollerRef: RefObject<HTMLDivElement | null>;
  showScrollButton: boolean;
  traceVersion: "v1" | "v2";
  traceV2InlineEvents: boolean;
  workspace: WorkspaceSummary | null;
}

const floatingComposerHeight = 152;

export function ChatWorkspace({
  canUndoLastTurn,
  composer,
  isBootstrapped,
  isRunning,
  lastError,
  messages,
  onScrollToBottom,
  onSelectPrompt,
  onUndoLastTurn,
  onVisibilityChange,
  scrollerRef,
  showScrollButton,
  traceVersion,
  traceV2InlineEvents,
  workspace,
}: ChatWorkspaceProps) {
  const settings = useChatStore((state) => state.settings);
  const hasMessages = messages.length > 0;
  const reserveFloatingSpace = hasMessages && settings.floatingInput;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-transparent">
      <div
        className="relative flex min-h-0 flex-1 flex-col bg-transparent"
        style={{
          paddingBottom: reserveFloatingSpace ? floatingComposerHeight : 0,
        }}
      >
        {hasMessages ? (
          <MessageStream
            canUndoLastTurn={canUndoLastTurn}
            isRunning={isRunning}
            messages={messages}
            onUndoLastTurn={onUndoLastTurn}
            onVisibilityChange={onVisibilityChange}
            scrollerRef={scrollerRef}
            traceVersion={traceVersion}
            traceV2InlineEvents={traceV2InlineEvents}
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
      </div>
      {hasMessages ? (
        <ComposerDock
          hasMessages={hasMessages}
          onScrollToBottom={onScrollToBottom}
          showScrollButton={showScrollButton}
        >
          {composer}
        </ComposerDock>
      ) : null}
    </div>
  );
}
