import { useState, type ReactNode } from "react";
import { FolderOpenIcon } from "@phosphor-icons/react";

import { Button } from "../../../components/ui/button";
import type { WorkspaceSummary } from "../../../contracts/workspace";
import type { AssistantRunOptions } from "../../../contracts/chat";
import { QuickActionCards } from "./quick-action-cards";

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
  onOpenRepository: () => Promise<void> | void;
}

export function EmptyChatState({
  isBootstrapped,
  isRunning,
  lastError,
  onSelectPrompt,
  workspace,
  composer,
  onOpenRepository,
}: EmptyChatStateProps) {
  const title = lastError
    ? "Something needs attention"
    : !isBootstrapped
      ? "Loading workspace"
      : workspace
        ? `What do you want to verify in ${workspace.name}?`
        : "Open a repository to begin";
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
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-8 sm:px-8">
      <div className="w-full max-w-[820px] animate-in fade-in slide-in-from-bottom-1 duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:slide-in-from-bottom-0 motion-reduce:duration-150">
        <div className="mb-8 flex flex-col items-center text-center sm:mb-10">
          <h1 className="max-w-[680px] text-balance text-[28px] font-medium leading-[1.08] tracking-[-0.035em] text-foreground sm:text-[38px]">
            {title}
          </h1>
          <p className="mt-3 max-w-[520px] text-[13px] leading-relaxed text-muted-foreground/65 sm:text-sm">
            {workspace
              ? "Choose a verification objective or describe your own."
              : "Repository context keeps analysis precise and tools inside a clear boundary."}
          </p>
        </div>

        {workspace ? (
          <QuickActionCards
            disabled={actionsDisabled}
            onSelectAction={(prompt) => void handlePromptAction(prompt)}
          />
        ) : (
          <div className="flex justify-center">
            <Button
              className="rounded-full px-5 shadow-none"
              onClick={() => void onOpenRepository()}
            >
              <FolderOpenIcon className="size-4" />
              Open repository
            </Button>
          </div>
        )}

        {composer && workspace ? (
          <div className="mt-4 rounded-[32px]">
            {composer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
