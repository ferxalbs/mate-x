import { CaretDownIcon } from "@phosphor-icons/react";
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
import type {
  BehaviorMode,
  BehaviorPreference,
} from "../../../contracts/behavior-mode";
import type { AssistantRunOptions } from "../../../contracts/chat";
import type {
  RainyModelCatalogEntry,
  RainyServiceTier,
} from "../../../contracts/rainy";
import type { WorkspaceTrustAutonomy } from "../../../contracts/workspace";
import { ComposerPolicySummary, BEHAVIOR_MODE_LABELS } from "./composer-policy-summary";

const TRUST_OPTIONS: Array<{
  description: string;
  label: string;
  value: WorkspaceTrustAutonomy;
}> = [
  {
    value: "plan-only",
    label: "Plan only",
    description: "Inspect and propose changes without modifying files.",
  },
  {
    value: "approval-required",
    label: "Ask before changes",
    description: "Inspect freely, then ask before edits or controlled execution.",
  },
  {
    value: "trusted-patch",
    label: "Scoped changes",
    description: "Allow listed workspace edits; keep risky and Git actions gated.",
  },
];

interface ComposerRunSettingsProps {
  behavior: BehaviorPreference;
  catalog: RainyModelCatalogEntry[];
  effortOptions: AssistantRunOptions["reasoning"][];
  isModelDisabled: boolean;
  isTrustDisabled: boolean;
  modelLabel: string;
  modelValue: string;
  onBehaviorChange: (value: BehaviorPreference) => void;
  onModelChange: (value: string) => void;
  onReasoningChange: (value: AssistantRunOptions["reasoning"]) => void;
  onServiceTierChange: (value: RainyServiceTier) => void;
  onTrustChange: (value: WorkspaceTrustAutonomy) => Promise<void>;
  reasoningValue: AssistantRunOptions["reasoning"];
  serviceTier: RainyServiceTier;
  serviceTierOptions: RainyServiceTier[];
  showServiceTierSelector: boolean;
  supportsReasoningEffort: boolean;
  trust: WorkspaceTrustAutonomy;
}

export function ComposerRunSettings({
  behavior,
  catalog,
  effortOptions,
  isModelDisabled,
  isTrustDisabled,
  modelLabel,
  modelValue,
  onBehaviorChange,
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
        data-testid="run-settings-trigger"
        ref={triggerRef}
      >
        <ComposerPolicySummary behavior={behavior} trust={trust} />
        <CaretDownIcon aria-hidden className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="mate-glass-float max-h-[min(34rem,var(--available-height))] w-[min(22rem,var(--available-width))] overflow-y-auto rounded-2xl border-border/70 bg-panel p-1.5 shadow-none"
        sideOffset={6}
      >
        <MenuSectionLabel>Run settings</MenuSectionLabel>
        <MenuSubLabel>Workspace policy</MenuSubLabel>
        <DropdownMenuRadioGroup
          onValueChange={(value) =>
            void onTrustChange(value as WorkspaceTrustAutonomy)
          }
          value={trust}
        >
          {TRUST_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              className="items-start rounded-xl py-2.5"
              disabled={isTrustDisabled}
              key={option.value}
              value={option.value}
            >
              <span className="min-w-0 pr-2">
                <span className="block text-xs font-medium text-foreground">
                  {option.label}
                </span>
                <span className="mt-0.5 block break-words text-[11px] leading-snug text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <div className="my-1 border-t border-border/70" />
        <MenuSubLabel>Behavior</MenuSubLabel>
        <DropdownMenuRadioGroup
          onValueChange={(mode) =>
            onBehaviorChange({ ...behavior, mode: mode as BehaviorMode })
          }
          value={behavior.mode}
        >
          {(Object.keys(BEHAVIOR_MODE_LABELS) as BehaviorMode[]).map((mode) => (
            <DropdownMenuRadioItem className="rounded-xl" key={mode} value={mode}>
              {BEHAVIOR_MODE_LABELS[mode]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        {behavior.mode === "custom" ? (
          <div className="mt-1 border-t border-border/70 px-2 py-2">
            {([
              ["askBeforeEdits", "Ask before edits"],
              ["askBeforeCommands", "Ask before commands"],
              ["askBeforeNetwork", "Ask before network"],
              ["askBeforeGit", "Ask before Git"],
              ["autoValidate", "Automatically validate"],
            ] as const).map(([key, label]) => (
              <label
                className="flex min-h-8 items-center justify-between gap-3 text-xs"
                key={key}
              >
                <span>{label}</span>
                <input
                  checked={behavior.custom[key]}
                  onChange={(event) =>
                    onBehaviorChange({
                      ...behavior,
                      custom: {
                        ...behavior.custom,
                        [key]: event.target.checked,
                      },
                    })
                  }
                  type="checkbox"
                />
              </label>
            ))}
          </div>
        ) : null}

        <div className="my-1 border-t border-border/70" />
        <MenuSubLabel>Model</MenuSubLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            className="rounded-xl"
            disabled={isModelDisabled}
          >
            <span className="min-w-0 flex-1 truncate">Model</span>
            <span className="max-w-44 truncate text-muted-foreground">
              {modelLabel}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="mate-glass-float max-h-72 w-72 overflow-y-auto rounded-2xl border-border/70 bg-panel p-1.5 shadow-none">
            <DropdownMenuRadioGroup value={modelValue} onValueChange={onModelChange}>
              {catalog.map((model) => (
                <DropdownMenuRadioItem
                  className="rounded-xl"
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
            <DropdownMenuSubTrigger className="rounded-xl">
              <span className="flex-1">Reasoning</span>
              <span className="text-muted-foreground">
                {formatReasoningEffort(reasoningValue)}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="mate-glass-float w-44 rounded-2xl border-border/70 bg-panel p-1.5 shadow-none">
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  onReasoningChange(value as AssistantRunOptions["reasoning"])
                }
                value={reasoningValue}
              >
                {effortOptions.map((effort) => (
                  <DropdownMenuRadioItem
                    className="rounded-xl"
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
            <DropdownMenuSubTrigger className="rounded-xl">
              <span className="flex-1">Service tier</span>
              <span className="text-muted-foreground">
                {formatServiceTier(serviceTier)}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="mate-glass-float w-44 rounded-2xl border-border/70 bg-panel p-1.5 shadow-none">
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  onServiceTierChange(value as RainyServiceTier)
                }
                value={serviceTier}
              >
                {serviceTierOptions.map((tier) => (
                  <DropdownMenuRadioItem
                    className="rounded-xl"
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
    <div className="px-2.5 pb-1.5 pt-1 text-xs font-semibold text-foreground">
      {children}
    </div>
  );
}

function MenuSubLabel({ children }: { children: string }) {
  return (
    <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
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
