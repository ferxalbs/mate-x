import {
  BrainIcon,
  CheckCircle2Icon,
  FileTextIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { WorkspaceSummary } from "../../../contracts/workspace";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../components/ui/tooltip";

interface EmptyChatStateProps {
  isBootstrapped: boolean;
  lastError: string | null;
  onSelectPrompt: (prompt: string) => void;
  workspace: WorkspaceSummary | null;
  composer?: ReactNode;
}

const quickPrompts = [
  {
    icon: <ShieldCheckIcon className="size-3.5 text-emerald-500" />,
    label: "Can I ship?",
    prompt:
      "Tell me if I can ship the current repo changes. Use existing git, validation, proof, and risk signals only. Give one verdict, one reason, and one next action.",
  },
  {
    icon: <BrainIcon className="size-3.5 text-purple-500" />,
    label: "Explain changes",
    prompt:
      "Explain the current changes in plain language. Highlight what changed, why it matters, likely blast radius, and what I should inspect first.",
  },
  {
    icon: <CheckCircle2Icon className="size-3.5 text-blue-500" />,
    label: "Find risky changes",
    prompt:
      "Find risky changes in the current diff. Focus on auth, sessions, IPC, dependencies, network, secrets, privacy, and runtime boundaries. Separate real risk from reference noise.",
  },
  {
    icon: <FileTextIcon className="size-3.5 text-amber-500" />,
    label: "Run safety check",
    prompt:
      "Run the smallest useful safety check for the current changes. Do not claim Ready unless validation passes and proof is available.",
  },
];



export function EmptyChatState({
  isBootstrapped,
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
        ? "Can I ship this?"
        : "Open a repo. See risk first.";
  const statusText =
    lastError ??
    "MaTE X is restoring your previous session and checking local workspace state.";

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
    <div className="grid min-h-full grid-rows-[1fr_auto_1fr] px-4 py-10">
      <div className="flex items-end justify-center pb-6">
        <div className="w-full max-w-[820px] text-center">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Safety Status
          </p>
          <h1 className="text-center text-2xl font-medium text-foreground/90 sm:text-[32px]">
            {title}
          </h1>
          <p className="mx-auto mt-2 max-w-[620px] text-[13px] leading-relaxed text-muted-foreground/75">
            {workspace
              ? `${workspace.name} is ready for a safety decision. Ask MaTE X to check whether you can ship, fix, or prove the current changes.`
              : "Open a workspace to get one verdict, one reason, and one next action."}
          </p>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[820px]">{composer}</div>
      <div className="flex items-start justify-center pt-7">
        <div className="grid w-full max-w-[760px] grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-start sm:justify-center sm:gap-2.5">
          {quickPrompts.map((item) => (
            <FeatureChip
              icon={item.icon}
              key={item.label}
              label={item.label}
              prompt={item.prompt}
              onClick={() => onSelectPrompt(item.prompt)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FeatureChip({
  icon,
  label,
  prompt,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  prompt: string;
  onClick: () => void;
}) {
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onClick}
              className="group flex h-9 min-w-0 items-center justify-center gap-2 rounded-2xl border border-[var(--panel-border)]/40 bg-[var(--mate-panel-bg)] px-3 text-[12px] font-medium text-muted-foreground/85 backdrop-blur-md transition-colors hover:bg-accent hover:text-foreground sm:justify-start sm:px-3.5"
            />
          }
        >
          <div className="flex items-center justify-center text-foreground/70 transition-colors group-hover:text-foreground">
            {icon}
          </div>
          <span className="truncate">{label}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8} className="max-w-[280px]">
          <p className="text-center leading-relaxed text-muted-foreground">
            {prompt}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
