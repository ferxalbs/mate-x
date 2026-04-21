import {
  ArrowUpIcon,
  ChevronDownIcon,
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
import type { RainyModelCatalogEntry } from '../../../contracts/rainy';
import type {
  WorkspaceSummary,
  WorkspaceTrustContract,
} from '../../../contracts/workspace';
import { cn } from '../../../lib/utils';
import { getModel, listModels, setModel } from '../../../services/settings-client';

interface ComposerPanelProps {
  canUndoLastTurn: boolean;
  isRunning: boolean;
  onScrollToBottom: () => void;
  workspace: WorkspaceSummary | null;
  resolvedTheme: 'light' | 'dark';
  onSubmit: (prompt: string, options: AssistantRunOptions) => Promise<void>;
  onUndoLastTurn: () => Promise<string | null>;
  showScrollButton: boolean;
  trustContract: WorkspaceTrustContract | null;
}

export function ComposerPanel({
  canUndoLastTurn,
  isRunning,
  onScrollToBottom,
  workspace,
  resolvedTheme: _resolvedTheme,
  onSubmit,
  onUndoLastTurn,
  showScrollButton,
  trustContract,
}: ComposerPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [modelValue, setModelValue] = useState('');
  const [catalog, setCatalog] = useState<RainyModelCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [isModelSaving, setIsModelSaving] = useState(false);
  const [reasoningValue, setReasoningValue] = useState('high');
  const [modeValue, setModeValue] = useState('build');

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
  const modelLabel = selectedModel?.label ?? (modelValue || 'Select model');
  const isModelDisabled = isCatalogLoading || isModelSaving || catalog.length === 0;
  const accessValue = trustContract?.autonomy === 'trusted-patch' ? 'full' : 'approval';

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
      reasoning: reasoningValue as AssistantRunOptions['reasoning'],
      mode: modeValue as AssistantRunOptions['mode'],
      access: accessValue as AssistantRunOptions['access'],
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

  return (
    <div className="px-8 pb-6 pt-2">
      <div className="relative mx-auto w-full max-w-[820px]">
        {showScrollButton ? (
          <div className="pointer-events-none absolute inset-x-0 -top-11 z-10 flex justify-center">
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
        <div className="rounded-[24px] border border-[var(--panel-border)] bg-[var(--panel)]/92 shadow-[0_22px_80px_-42px_rgba(0,0,0,0.75)] backdrop-blur-xl">
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
                    {entry.label}
                  </SelectItem>
                ))}
              </InlineSelect>
              <InlineSelect value={reasoningValue} onValueChange={setReasoningValue}>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="max">Max</SelectItem>
              </InlineSelect>
              <InlineSelect value={modeValue} onValueChange={setModeValue}>
                <SelectItem value="build">Build</SelectItem>
                <SelectItem value="plan">Plan</SelectItem>
              </InlineSelect>
              <div className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-emerald-600 dark:text-emerald-300/90">
                <ShieldCheckIcon className="size-3.5" />
                <span>
                  {trustContract
                    ? `Contract v${trustContract.version}: ${trustContract.autonomy}`
                    : 'Contract pending'}
                </span>
              </div>
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
        <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground/45">
          <span className="truncate">
            Scope {trustContract?.allowedPaths.slice(0, 3).join(', ') ?? 'loading'}
          </span>
          <span className="max-w-[42%] truncate text-right">
            {workspace?.branch ?? 'main'} / blocked {trustContract?.blockedActions.slice(0, 2).join(', ') ?? 'loading'}
          </span>
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

function resolveModelValue(
  storedModel: string | null,
  catalog: RainyModelCatalogEntry[],
) {
  if (storedModel && catalog.some((entry) => entry.id === storedModel)) {
    return storedModel;
  }

  return catalog[0]?.id ?? storedModel ?? '';
}
