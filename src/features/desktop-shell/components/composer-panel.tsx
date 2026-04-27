import {
  ArrowUpIcon,
  BrainIcon,
  ChevronDownIcon,
  ImageIcon,
  LoaderCircle,
  RotateCcwIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { startTransition, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '../../../components/ui/button';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import type { AssistantRunOptions } from '../../../contracts/chat';
import type { PolicyStop, PolicyStopAction } from '../../../contracts/policy';
import type { RainyModelCatalogEntry } from '../../../contracts/rainy';
import type {
  WorkspaceSummary,
  WorkspaceTrustContract,
} from '../../../contracts/workspace';
import {
  getReasoningEffortValues,
  supportsImageInput as modelSupportsImageInput,
  supportsReasoning as modelSupportsReasoning,
  supportsStructuredOutput,
  supportsTools,
} from '../../../lib/rainy-model-capabilities';
import { cn } from '../../../lib/utils';
import { getModel, listModels, setModel } from '../../../services/settings-client';
import { useChatStore } from '../../../store/chat-store';

interface ComposerPanelProps {
  canUndoLastTurn: boolean;
  isRunning: boolean;
  onScrollToBottom: () => void;
  onResolvePolicyStop: (stop: PolicyStop, action: PolicyStopAction) => Promise<void>;
  workspace: WorkspaceSummary | null;
  resolvedTheme: 'light' | 'dark';
  onSubmit: (prompt: string, options: AssistantRunOptions) => Promise<void>;
  onUndoLastTurn: () => Promise<string | null>;
  showScrollButton: boolean;
  pendingPolicyStop: PolicyStop | null;
  trustContract: WorkspaceTrustContract | null;
}

export function ComposerPanel({
  canUndoLastTurn,
  isRunning,
  onScrollToBottom,
  onResolvePolicyStop,
  workspace,
  resolvedTheme,
  onSubmit,
  onUndoLastTurn,
  showScrollButton,
  pendingPolicyStop,
  trustContract,
}: ComposerPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [modelValue, setModelValue] = useState('');
  const [catalog, setCatalog] = useState<RainyModelCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [isModelSaving, setIsModelSaving] = useState(false);
  const [reasoningEnabled, setReasoningEnabled] = useState(true);
  const [reasoningValue, setReasoningValue] =
    useState<AssistantRunOptions['reasoning']>('high');
  const [capabilityNotice, setCapabilityNotice] = useState('');
  const [modeValue, setModeValue] = useState('build');
  const [runbookValue, setRunbookValue] =
    useState<AssistantRunOptions['runbookId']>('patch_test_verify');
  const [isResolvingPolicyStop, setIsResolvingPolicyStop] = useState(false);
  const settings = useChatStore((state) => state.settings);

  useEffect(() => {
    let cancelled = false;

    async function loadModelState(forceRefresh = false) {
      setIsCatalogLoading(true);
      setCatalogError('');

      try {
        const [storedModel, nextCatalog] = await Promise.all([
          getModel(),
          listModels(forceRefresh),
        ]);

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setCatalog(nextCatalog);
          setModelValue(resolveModelValue(storedModel, nextCatalog));
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setCatalog([]);
        setCatalogError(
          error instanceof Error ? error.message : 'Could not load Rainy models.',
        );
      } finally {
        if (!cancelled) {
          setIsCatalogLoading(false);
        }
      }
    }

    void loadModelState(true);

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedModel = useMemo(
    () => catalog.find((entry) => entry.id === modelValue) ?? null,
    [catalog, modelValue],
  );
  const modelLabel = selectedModel?.label ?? (modelValue || `Select model (${catalog.length})`);
  const supportsImageInput = modelSupportsImageInput(selectedModel);
  const reasoningSupported = modelSupportsReasoning(selectedModel);
  const toolCallingSupported = supportsTools(selectedModel);
  const structuredOutputSupported = supportsStructuredOutput(selectedModel);
  const effortOptions = useMemo(
    () => getReasoningEffortValues(selectedModel).filter(isAssistantReasoningLevel),
    [selectedModel],
  );
  const supportsReasoningEffort = reasoningSupported && effortOptions.length > 0;
  const isModelDisabled = isCatalogLoading || isModelSaving || catalog.length === 0;
  const accessValue = trustContract?.autonomy === 'trusted-patch' ? 'full' : 'approval';

  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    if (!reasoningSupported && reasoningEnabled) {
      setReasoningEnabled(false);
      setCapabilityNotice('Razonamiento desactivado: este modelo no lo soporta.');
      return;
    }

    if (reasoningSupported && supportsReasoningEffort && !effortOptions.includes(reasoningValue)) {
      setReasoningValue(effortOptions[0]);
      setCapabilityNotice(`Esfuerzo ajustado para ${selectedModel.label}.`);
      return;
    }

    if (reasoningSupported && !supportsReasoningEffort && reasoningEnabled) {
      setCapabilityNotice('Este modelo usa razonamiento ON/OFF sin nivel de esfuerzo.');
      return;
    }

    setCapabilityNotice('');
  }, [
    effortOptions,
    reasoningEnabled,
    reasoningSupported,
    reasoningValue,
    selectedModel,
    supportsReasoningEffort,
  ]);

  async function handleSubmit() {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || isRunning || isModelSaving) {
      return;
    }

    if (modelValue) {
      setIsModelSaving(true);
      setCatalogError('');

      try {
        await setModel(modelValue);
      } catch (error) {
        setCatalogError(
          error instanceof Error ? error.message : 'Could not activate Rainy model.',
        );
        setIsModelSaving(false);
        return;
      }

      setIsModelSaving(false);
    }

    setPrompt('');
    await onSubmit(nextPrompt, {
      reasoningEnabled: reasoningSupported && reasoningEnabled,
      reasoning: reasoningValue,
      mode: modeValue as AssistantRunOptions['mode'],
      access: accessValue as AssistantRunOptions['access'],
      runbookId: runbookValue,
    });
  }

  async function handleModelChange(nextModel: string) {
    if (!nextModel || nextModel === modelValue) {
      return;
    }

    setCatalogError('');
    setIsModelSaving(true);

    try {
      await setModel(nextModel);
      setModelValue(nextModel);
    } catch (error) {
      setCatalogError(
        error instanceof Error ? error.message : 'Could not update Rainy model.',
      );
    } finally {
      setIsModelSaving(false);
    }
  }

  async function handleUndoLastTurn() {
    const restoredPrompt = await onUndoLastTurn();
    if (restoredPrompt) {
      setPrompt(restoredPrompt);
    }
  }

  async function handlePolicyAction(action: PolicyStopAction) {
    if (!pendingPolicyStop || isResolvingPolicyStop) {
      return;
    }

    setIsResolvingPolicyStop(true);
    try {
      await onResolvePolicyStop(pendingPolicyStop, action);
    } finally {
      setIsResolvingPolicyStop(false);
    }
  }

  return (
    <div
      className={cn(
        'transition-all duration-300',
        settings.floatingInput
          // Truly float: exit flex flow, sit above message content.
          // pointer-events-none on wrapper so transparent area is click-through.
          ? 'pointer-events-none absolute bottom-0 inset-x-0 z-40 pb-4'
          : 'pt-2 pb-6 px-8',
      )}
    >
      {/* Soft gradient fade above the panel */}
      {settings.floatingInput ? (
        <div className="pointer-events-none absolute inset-x-0 top-[-64px] h-[64px] bg-gradient-to-t from-background/60 to-transparent" />
      ) : null}

      <div
        className={cn(
          'mx-auto w-full transition-all duration-300',
          // Re-enable pointer events only on the actual panel area.
          settings.floatingInput ? 'pointer-events-auto px-4' : 'relative',
          settings.compactMode ? 'max-w-[680px]' : 'max-w-[820px]',
        )}
      >
        {showScrollButton ? (
          <div
            className={cn(
              'pointer-events-none absolute inset-x-0 z-10 flex justify-center transition-all',
              settings.floatingInput ? '-top-12' : '-top-11',
            )}
          >
            <Button
              className="pointer-events-auto h-8 rounded-full border-border/60 bg-background/88 px-3 text-[11px] text-muted-foreground shadow-[0_10px_30px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md hover:bg-accent"
              onClick={onScrollToBottom}
              size="xs"
              variant="outline"
            >
              <ChevronDownIcon className="size-3.5" />
              Scroll to bottom
            </Button>
          </div>
        ) : null}
        <div
          className={cn(
            'rounded-[28px] border border-[var(--panel-border)] shadow-[0_32px_120px_-40px_rgba(0,0,0,0.85)] transition-all duration-300',
            // Floating: ultra-transparent glass (30% dark / 75% light).
            // Compact: same premium dark-glass aesthetic at higher opacity.
            settings.floatingInput
              ? cn(
                  'backdrop-blur-3xl',
                  resolvedTheme === 'dark'
                    ? 'bg-[var(--panel)]/30'
                    : 'bg-[var(--panel)]/75',
                )
              : cn(
                  'backdrop-blur-2xl',
                  resolvedTheme === 'dark'
                    ? 'bg-[var(--panel)]/30'
                    : 'bg-[var(--panel)]/75',
                ),
          )}
        >
          {pendingPolicyStop ? (
            <PermissionPrompt
              disabled={isResolvingPolicyStop}
              onAction={handlePolicyAction}
              stop={pendingPolicyStop}
            />
          ) : null}
          <div className="px-5 py-4">
            <textarea
              className="min-h-[60px] w-full resize-none bg-transparent text-[14px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/65"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="Ask anything, @tag files/folders, or use / to show available commands"
              value={prompt}
            />
          </div>
          {catalogError ? (
            <div className="px-5 pb-1 text-[11px] text-amber-300/90">{catalogError}</div>
          ) : null}

          <div className="flex items-center justify-between gap-3 px-3 pb-3 pt-0.5">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto turn-chip-strip">
              <InlineSelect
                value={modelValue}
                onValueChange={handleModelChange}
                disabled={isModelDisabled}
                label={isCatalogLoading ? 'Loading models' : modelLabel}
              >
                {catalog.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{entry.label}</span>
                      <span className="truncate text-[10px] text-muted-foreground/75">{entry.id}</span>
                    </div>
                  </SelectItem>
                ))}
              </InlineSelect>
              {reasoningSupported ? (
                <button
                  type="button"
                  className={cn(
                    'flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent',
                    reasoningEnabled ? 'text-foreground' : 'text-muted-foreground/60',
                  )}
                  onClick={() => setReasoningEnabled((value) => !value)}
                >
                  <BrainIcon className="size-3.5" />
                  {reasoningEnabled ? 'Reasoning on' : 'Reasoning off'}
                </button>
              ) : null}
              <div
                className={cn(
                  'grid shrink-0 transition-all duration-300 ease-out',
                  reasoningEnabled && supportsReasoningEffort
                    ? 'grid-cols-[1fr] opacity-100'
                    : 'grid-cols-[0fr] opacity-0',
                )}
              >
                <div className="min-w-0 overflow-hidden">
                  <InlineSelect
                    value={reasoningValue}
                    onValueChange={(value) =>
                      setReasoningValue(value as AssistantRunOptions['reasoning'])
                    }
                  >
                    {effortOptions.map((effort) => (
                      <SelectItem key={effort} value={effort}>
                        {formatReasoningEffort(effort)}
                      </SelectItem>
                    ))}
                  </InlineSelect>
                </div>
              </div>
              {!supportsImageInput ? (
                <button
                  aria-label="Images unavailable"
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/35"
                  disabled
                  title="Este modelo no procesa imágenes."
                  type="button"
                >
                  <ImageIcon className="size-3.5" />
                </button>
              ) : null}
              {toolCallingSupported ? (
                <div className="flex h-6 shrink-0 items-center rounded-md px-2 text-[11px] text-muted-foreground">
                  Tools
                </div>
              ) : null}
              {structuredOutputSupported ? (
                <div className="flex h-6 shrink-0 items-center rounded-md px-2 text-[11px] text-muted-foreground">
                  Structured
                </div>
              ) : null}
              <InlineSelect value={modeValue} onValueChange={setModeValue}>
                <SelectItem value="build">Build</SelectItem>
                <SelectItem value="plan">Plan</SelectItem>
              </InlineSelect>
              <InlineSelect
                value={runbookValue ?? 'patch_test_verify'}
                onValueChange={(value) =>
                  setRunbookValue(value as AssistantRunOptions['runbookId'])
                }
              >
                <SelectItem value="patch_test_verify">Patch - Test - Verify</SelectItem>
                <SelectItem value="audit_reproduce_remediate">Audit - Reproduce - Remediate</SelectItem>
                <SelectItem value="review_classify_summarize">Review - Classify - Summarize</SelectItem>
                <SelectItem value="scan_contain_report">Scan - Contain - Report</SelectItem>
              </InlineSelect>
              <div className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-emerald-600 dark:text-emerald-300/90">
                <ShieldCheckIcon className="size-3.5" />
                <span>
                  {trustContract
                    ? `Contract v${trustContract.version}: ${trustContract.autonomy}`
                    : 'Contract pending'}
                </span>
              </div>
              {capabilityNotice ? (
                <div className="h-6 shrink-0 rounded-md px-2 text-[11px] leading-6 text-amber-600 dark:text-amber-300/90">
                  {capabilityNotice}
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 text-[11px] text-muted-foreground/60">
              {canUndoLastTurn ? (
                <Button
                  aria-label="Undo last turn"
                  className="h-8 rounded-full border-border/60 bg-transparent px-3 text-[11px] text-muted-foreground shadow-none hover:bg-accent"
                  disabled={isRunning || isModelSaving}
                  onClick={() => void handleUndoLastTurn()}
                  size="xs"
                  variant="outline"
                >
                  <RotateCcwIcon className="size-3.5" />
                  Undo
                </Button>
              ) : null}
              <Button
                aria-label={isRunning ? 'Thinking' : 'Send'}
                className={cn(
                  'size-9 rounded-full border-0 bg-[#2454ff] p-0 text-white shadow-none hover:bg-[#3462ff]',
                  isRunning ? 'opacity-90' : '',
                )}
                disabled={isRunning || isModelSaving}
                onClick={handleSubmit}
                size="icon-sm"
                variant="outline"
              >
                {isRunning ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowUpIcon className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
        {!settings.floatingInput ? (
          <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground/45">
            <span className="truncate">
              Scope {trustContract?.allowedPaths.slice(0, 3).join(', ') ?? 'loading'}
            </span>
            <span className="max-w-[42%] truncate text-right">
              {workspace?.branch ?? 'main'} / blocked{' '}
              {trustContract?.blockedActions.slice(0, 2).join(', ') ?? 'loading'}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PermissionPrompt({
  disabled,
  onAction,
  stop,
}: {
  disabled: boolean;
  onAction: (action: PolicyStopAction) => void;
  stop: PolicyStop;
}) {
  const toolName = stop.attemptedAction.toolName ?? 'tool action';
  const target = stop.attemptedAction.command ?? stop.attemptedAction.target ?? stop.policyId;
  const canApprove = stop.availableActions.includes('approve_once');
  const canDecline = stop.availableActions.includes('safer_alternative') || stop.availableActions.includes('abort');

  return (
    <div className="border-b border-border/50 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-md border border-amber-300/30 bg-amber-400/8 px-2 py-1 font-medium text-amber-200">
              Approval required
            </span>
            <span className="text-muted-foreground">{toolName}</span>
            <span className="truncate rounded-md border border-border/55 bg-background/45 px-2 py-1 font-mono text-[10px] text-muted-foreground">
              {target}
            </span>
          </div>
          <div className="mt-2 text-[12px] font-medium text-foreground/90">{stop.title}</div>
          <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
            {stop.explanation}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canDecline ? (
            <Button
              className="h-8 rounded-full border-border/60 bg-transparent px-3 text-[11px] text-muted-foreground shadow-none hover:bg-accent"
              disabled={disabled}
              onClick={() => onAction(stop.availableActions.includes('safer_alternative') ? 'safer_alternative' : 'abort')}
              size="xs"
              variant="outline"
            >
              Continue without it
            </Button>
          ) : null}
          {canApprove ? (
            <Button
              className="h-8 rounded-full bg-emerald-500 px-3 text-[11px] text-white shadow-none hover:bg-emerald-400"
              disabled={disabled}
              onClick={() => onAction('approve_once')}
              size="xs"
              variant="outline"
            >
              Approve once
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InlineSelect({
  value,
  onValueChange,
  disabled = false,
  label,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  children: ReactNode;
}) {
  return (
    <Select
      disabled={disabled}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onValueChange(nextValue);
        }
      }}
    >
      <SelectTrigger
        size="xs"
        variant="ghost"
        className="h-6 min-w-fit shrink-0 rounded-md border-0 px-2 text-[11px] text-muted-foreground shadow-none hover:bg-accent"
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectPopup>{children}</SelectPopup>
    </Select>
  );
}

function isAssistantReasoningLevel(
  value: string,
): value is AssistantRunOptions['reasoning'] {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh';
}

function formatReasoningEffort(effort: AssistantRunOptions['reasoning']) {
  return effort === 'xhigh' ? 'X High' : effort[0].toUpperCase() + effort.slice(1);
}

function resolveModelValue(
  storedModel: string | null,
  catalog: RainyModelCatalogEntry[],
) {
  if (storedModel && catalog.some((entry) => entry.id === storedModel)) {
    return storedModel;
  }

  return catalog[0]?.id ?? storedModel ?? '';
}
