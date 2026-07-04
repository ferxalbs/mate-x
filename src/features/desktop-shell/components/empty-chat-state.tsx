import {
  ActivityIcon,
  BrainIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  FileTextIcon,
  GaugeIcon,
  ShieldCheckIcon,
  ZapIcon,
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
    label: "Audit Repo",
    prompt:
      "Open with an instant repo orientation, then run a focused high-impact security audit. Prioritize runtime surfaces, trust boundaries, data validation, auth, secrets, and dependency risk. Separate active findings from tests, docs, examples, fixtures, and generated files.",
  },
  {
    icon: <BrainIcon className="size-3.5 text-purple-500" />,
    label: "Triage Risk",
    prompt:
      "Triage vulnerability candidates in recent changes. For each candidate, show exploit path, affected runtime surface, confidence, proof, fix plan, verification command, and excluded noise.",
  },
  {
    icon: <CheckCircle2Icon className="size-3.5 text-blue-500" />,
    label: "Verify Fix",
    prompt:
      "Validate recent security fixes with available tests, traces, and evidence. Identify remaining exploitability conditions, missing mitigations, and the exact verification proof.",
  },
  {
    icon: <FileTextIcon className="size-3.5 text-amber-500" />,
    label: "Export Evidence",
    prompt:
      "Prepare an evidence-ready security report for this workspace. Include prioritized risks, remediation status, and audit-ready local evidence.",
  },
];

const cockpitSteps = [
  { icon: <ExternalLinkIcon className="size-4" />, label: "Open repo", detail: "local trust contract" },
  { icon: <ActivityIcon className="size-4" />, label: "Risk map", detail: "runtime surfaces" },
  { icon: <ShieldCheckIcon className="size-4" />, label: "Focused audit", detail: "high-signal only" },
  { icon: <CheckCircle2Icon className="size-4" />, label: "Verify", detail: "proof + evidence" },
];

const cockpitMetrics = [
  { icon: <ZapIcon className="size-3.5" />, label: "First signal", value: "instant" },
  { icon: <GaugeIcon className="size-3.5" />, label: "Power mode", value: "idle-light" },
  { icon: <FileTextIcon className="size-3.5" />, label: "Evidence", value: "live" },
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
        ? `${workspace.name} mission cockpit`
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
        <div className="w-full max-w-[820px]">
          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {cockpitSteps.map((step) => (
              <div
                key={step.label}
                className="rounded-2xl border border-[var(--panel-border)]/35 bg-[var(--mate-panel-bg)]/70 px-3 py-3 text-left backdrop-blur-xl"
              >
                <div className="mb-2 text-foreground/70">{step.icon}</div>
                <div className="text-[12px] font-medium text-foreground/90">{step.label}</div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{step.detail}</div>
              </div>
            ))}
          </div>
          <h1 className="text-center text-2xl font-medium text-foreground/90 sm:text-[32px]">
            {title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {cockpitMetrics.map((metric) => (
              <div
                key={metric.label}
                className="flex h-8 items-center gap-2 rounded-full border border-[var(--panel-border)]/35 bg-[var(--mate-panel-bg)]/65 px-3 text-[11px] text-muted-foreground/80 backdrop-blur-xl"
              >
                <span className="text-foreground/65">{metric.icon}</span>
                <span>{metric.label}</span>
                <span className="font-medium text-foreground/85">{metric.value}</span>
              </div>
            ))}
          </div>
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
