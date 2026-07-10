import { QuickActionCards } from "./quick-action-cards";

import { useState, type ReactNode } from "react";

import type { WorkspaceSummary } from "../../../contracts/workspace";
import type { AssistantRunOptions } from "../../../contracts/chat";
import { ambientSafetyActions } from "./ambient-safety-actions";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../components/ui/tooltip";

interface EmptyChatStateProps {
  isBootstrapped: boolean;
  lastError: string | null;
  isRunning: boolean;
  onSelectPrompt: (
    prompt: string,
    overrides?: Partial<AssistantRunOptions>,
  ) => Promise<void> | void;
  workspace: WorkspaceSummary | null;
  composer?: ReactNode;
}



export function EmptyChatState({
  isBootstrapped,
  isRunning,
  lastError,
  onSelectPrompt,
  workspace,
  composer,
}: EmptyChatStateProps) {
  const title = lastError
    ? "Something needs attention"
    : !isBootstrapped
      ? "Loading workspace"
      : workspace
        ? `What should we build in ${workspace.name}?`
        : "What should we build today?";
  const statusText =
    lastError ??
    "MaTE X is restoring your previous session and checking local workspace state.";
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const actionsDisabled = isRunning || pendingPrompt !== null;

  async function handlePromptAction(
    prompt: string,
    overrides?: Partial<AssistantRunOptions>,
  ) {
    if (actionsDisabled) return;

    setPendingPrompt(prompt);
    try {
      await onSelectPrompt(prompt, overrides);
    } finally {
      setPendingPrompt(null);
    }
  }

  if (lastError || !isBootstrapped) {
    return (
      <div className="grid min-h-full place-items-center px-4 py-10">
        <div className="w-full max-w-[820px] text-center">
          <h1 className="text-2xl font-medium text-foreground/90 sm:text-[32px]">
            {title}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground/70">
            {statusText}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 w-full max-w-[820px] text-center">
        <h1 className="text-center text-[26px] font-medium tracking-tight text-foreground/90 sm:text-[32px]">
          {title}
        </h1>
      </div>
      <div className="mb-10 w-full max-w-[820px]">{composer}</div>
      <div className="flex w-full max-w-[820px] items-start justify-center">
        <QuickActionCards
          disabled={actionsDisabled}
          onSelectAction={(prompt) => void handlePromptAction(prompt)}
        />
      </div>
    </div>
  );
}

