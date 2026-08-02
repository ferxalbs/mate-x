import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

import { useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../components/ui/menu";
import type { AssistantRunOptions } from "../../../contracts/chat";
import type {
  RainyModelCatalogEntry,
  RainyServiceTier,
} from "../../../contracts/rainy";
import type { WorkspaceWriteAccess } from "../../../contracts/workspace";
import { ComposerPolicySummary } from "./composer-policy-summary";

const TRUST_OPTIONS: Array<{
  description: string;
  label: string;
  value: WorkspaceWriteAccess;
}> = [
  {
    value: "read-only",
    label: "Read only",
    description: "Allow repository inspection only.",
  },
  {
    value: "approval-required",
    label: "Ask before changes",
    description: "Inspect freely, ask before edits or commands.",
  },
  {
    value: "workspace",
    label: "Workspace changes",
    description: "Allow scoped workspace edits; keep risky actions gated.",
  },
];

interface ComposerRunSettingsProps {
  catalog: RainyModelCatalogEntry[];
  effortOptions: AssistantRunOptions["reasoning"][];
  isModelDisabled: boolean;
  isTrustDisabled: boolean;
  modelLabel: string;
  modelValue: string;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: AssistantRunOptions["reasoning"]) => void;
  onServiceTierChange: (value: RainyServiceTier) => void;
  onTrustChange: (value: WorkspaceWriteAccess) => Promise<void>;
  reasoningValue: AssistantRunOptions["reasoning"];
  serviceTier: RainyServiceTier;
  serviceTierOptions: RainyServiceTier[];
  showServiceTierSelector: boolean;
  supportsReasoningEffort: boolean;
  trust: WorkspaceWriteAccess;
}

export function ComposerRunSettings({
  catalog,
  effortOptions,
  isModelDisabled,
  isTrustDisabled,
  modelLabel,
  modelValue,
  onModelChange,
  onReasoningChange,
  onServiceTierChange,
  onTrustChange,
  reasoningValue,
  serviceTier,
  serviceTierOptions,
  showServiceTierSelector,
  supportsReasoningEffort,
  trust,
}: ComposerRunSettingsProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) restoreRunSettingsFocus(triggerRef.current);
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange} open={open}>
      <DropdownMenuTrigger
        aria-label="Run settings"
        className="flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-border/70 px-2.5 text-[11px] font-medium text-foreground shadow-none transition-[background-color,border-color,color,transform] duration-[var(--motion-press)] ease-[var(--ease-out)] motion-reduce:transform-none [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-px hover:bg-foreground/5"
        data-model-selector-trigger
        data-testid="run-settings-trigger"
        ref={triggerRef}
      >
        <ComposerPolicySummary trust={trust} />
        <span className="h-3 w-px bg-border/60" />
        <span className="truncate text-muted-foreground">
          {modelLabel}
          {supportsReasoningEffort && ` ${formatReasoningEffort(reasoningValue)}`}
        </span>
        <HugeiconsIcon icon={ArrowDown01Icon} aria-hidden className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(32rem,var(--available-height))] w-[268px] rounded-2xl border-border/40 p-1.5 shadow-none"
        sideOffset={6}
      >
        <MenuSectionLabel>Run settings</MenuSectionLabel>

        <MenuSubLabel>Workspace policy</MenuSubLabel>
        <DropdownMenuRadioGroup
          onValueChange={(value) =>
            void onTrustChange(value as WorkspaceWriteAccess)
          }
          value={trust}
        >
          {TRUST_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              className="items-start rounded-lg px-2 py-1.5"
              disabled={isTrustDisabled}
              key={option.value}
              value={option.value}
            >
              <span className="min-w-0 pr-1">
                <span className="block text-[12px] font-medium text-foreground">
                  {option.label}
                </span>
                <span className="mt-0.5 block break-words text-[10.5px] leading-tight text-muted-foreground/80">
                  {option.description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <div className="my-1 border-t border-border/50" />
        <MenuSubLabel>Model &amp; Execution</MenuSubLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            className="rounded-lg px-2 py-1.5 text-[12px] gap-2"
            disabled={isModelDisabled}
          >
            <span className="min-w-0 flex-1 truncate">Model</span>
            <span className="max-w-36 truncate text-right text-[11px] text-muted-foreground">
              {modelLabel}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-64 w-60 rounded-xl border-border/40 p-1 shadow-none">
            <DropdownMenuRadioGroup value={modelValue} onValueChange={onModelChange}>
              {catalog.map((model) => (
                <DropdownMenuRadioItem
                  className="rounded-lg px-2 py-1.5 text-[12px]"
                  key={model.id}
                  value={model.id}
                >
                  <span className="min-w-0 truncate">{model.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {supportsReasoningEffort ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="rounded-lg px-2 py-1.5 text-[12px] gap-2">
              <span className="flex-1 truncate">Reasoning</span>
              <span className="text-right text-[11px] text-muted-foreground truncate">
                {formatReasoningEffort(reasoningValue)}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40 rounded-xl border-border/40 p-1 shadow-none">
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  onReasoningChange(value as AssistantRunOptions["reasoning"])
                }
                value={reasoningValue}
              >
                {effortOptions.map((effort) => (
                  <DropdownMenuRadioItem
                    className="rounded-lg px-2 py-1.5 text-[12px]"
                    key={effort}
                    value={effort}
                  >
                    {formatReasoningEffort(effort)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}

        {showServiceTierSelector ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="rounded-lg px-2 py-1.5 text-[12px] gap-2">
              <span className="flex-1 truncate">Service tier</span>
              <span className="text-right text-[11px] text-muted-foreground truncate">
                {formatServiceTier(serviceTier)}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40 rounded-xl border-border/40 p-1 shadow-none">
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  onServiceTierChange(value as RainyServiceTier)
                }
                value={serviceTier}
              >
                {serviceTierOptions.map((tier) => (
                  <DropdownMenuRadioItem
                    className="rounded-lg px-2 py-1.5 text-[12px]"
                    key={tier}
                    value={tier}
                  >
                    {formatServiceTier(tier)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function restoreRunSettingsFocus(trigger: HTMLButtonElement | null) {
  queueMicrotask(() => trigger?.focus());
}

function MenuSectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pt-1 pb-1 text-[11px] font-semibold text-foreground tracking-tight">
      {children}
    </div>
  );
}

function MenuSubLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pt-1.5 pb-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
      {children}
    </div>
  );
}

function formatReasoningEffort(effort: AssistantRunOptions["reasoning"]) {
  if (effort === "xhigh") return "X High";
  return effort
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function formatServiceTier(tier: RainyServiceTier) {
  switch (tier) {
    case "flex":
      return "Flex";
    case "priority":
      return "Priority";
    case "scale":
      return "Scale";
    default:
      return "Standard";
  }
}
