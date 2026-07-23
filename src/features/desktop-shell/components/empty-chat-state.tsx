import { HugeiconsIcon } from "@hugeicons/react";
import { FolderOpenIcon } from "@hugeicons/core-free-icons";
import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

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
  const shouldReduceMotion = useReducedMotion();
  const title = lastError
    ? "Something needs attention"
    : !isBootstrapped
      ? "Loading workspace"
      : workspace
        ? "What do you want to verify?"
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
        <motion.div
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
          className="w-full max-w-[820px] text-center"
        >
          <h1 className="text-2xl font-medium text-foreground/90 sm:text-[32px]">
            {title}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground/70">
            {statusText}
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
      className="flex min-h-full flex-col items-center justify-center px-4 py-8 sm:px-8"
    >
      <div className="w-full max-w-[820px]">
        <div className="mb-6 flex flex-col items-center text-center sm:mb-8">
          <h1 className="max-w-[680px] text-balance text-[28px] font-semibold leading-[1.08] tracking-[-0.035em] text-foreground sm:text-[38px]">
            {title}
          </h1>
        </div>

        {composer && workspace ? (
          <div className="rounded-[32px]">{composer}</div>
        ) : null}

        {workspace ? (
          <div className="mt-4 sm:mt-5">
            <QuickActionCards
              disabled={actionsDisabled}
              onSelectAction={(prompt) => void handlePromptAction(prompt)}
            />
          </div>
        ) : (
          <div className="mt-6 flex justify-center">
            <Button
              className="rounded-full px-5 shadow-none"
              onClick={() => void onOpenRepository()}
            >
              <HugeiconsIcon icon={FolderOpenIcon} className="size-4" />
              Open repository
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
