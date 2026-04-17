import { ArrowUpIcon, LoaderCircle } from 'lucide-react';
import { startTransition, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '../../../components/ui/button';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import type { RainyApiMode, RainyModelCatalogEntry } from '../../../contracts/rainy';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import { cn } from '../../../lib/utils';
import { getApiMode, getModel, listModels, setApiMode, setModel } from '../../../services/settings-client';

interface ComposerPanelProps {
  isRunning: boolean;
  workspace: WorkspaceSummary | null;
  resolvedTheme: 'light' | 'dark';
  onSubmit: (prompt: string) => Promise<void>;
}

export function ComposerPanel({
  isRunning,
  workspace,
  resolvedTheme,
  onSubmit,
}: ComposerPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [modelValue, setModelValue] = useState('');
  const [catalog, setCatalog] = useState<RainyModelCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [isModelSaving, setIsModelSaving] = useState(false);
  const [currentApiMode, setCurrentApiMode] = useState<RainyApiMode>('chat_completions');
  const [reasoningValue, setReasoningValue] = useState('high');
  const [modeValue, setModeValue] = useState('build');
  const [accessValue, setAccessValue] = useState('full');

  useEffect(() => {
    let cancelled = false;

    async function loadModelState(forceRefresh = false) {
      setIsCatalogLoading(true);
      setCatalogError('');

      try {
        const [storedModel, storedApiMode, nextCatalog] = await Promise.all([
          getModel(),
          getApiMode(),
          listModels(forceRefresh),
        ]);

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setCatalog(nextCatalog);
          setCurrentApiMode(storedApiMode ?? 'chat_completions');
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

    void loadModelState();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedModel = useMemo(
    () => catalog.find((entry) => entry.id === modelValue) ?? null,
    [catalog, modelValue],
  );
  const modelLabel = selectedModel?.label ?? (modelValue || 'Select model');

  async function handleSubmit() {
    const nextPrompt = prompt.trim();

    if (!nextPrompt || isRunning || isModelSaving) {
      return;
    }

    if (modelValue) {
      const nextApiMode = resolveNextApiMode(selectedModel, currentApiMode);

      setIsModelSaving(true);
      setCatalogError('');

      try {
        await setModel(modelValue);

        if (nextApiMode !== currentApiMode) {
          await setApiMode(nextApiMode);
          setCurrentApiMode(nextApiMode);
        }
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
    await onSubmit(nextPrompt);
  }

  async function handleModelChange(nextModel: string) {
    if (!nextModel || nextModel === modelValue) {
      return;
    }

    const selectedEntry = catalog.find((entry) => entry.id === nextModel) ?? null;
    const nextApiMode = resolveNextApiMode(selectedEntry, currentApiMode);

    setCatalogError('');
    setIsModelSaving(true);

    try {
      await setModel(nextModel);

      if (nextApiMode && nextApiMode !== currentApiMode) {
        await setApiMode(nextApiMode);
        setCurrentApiMode(nextApiMode);
      }

      setModelValue(nextModel);
    } catch (error) {
      setCatalogError(
        error instanceof Error ? error.message : 'Could not update Rainy model.',
      );
    } finally {
      setIsModelSaving(false);
    }
  }

  const isModelDisabled = isCatalogLoading || isModelSaving || catalog.length === 0;

  return (
    <div className="px-6 pb-5 pt-2">
      <div className="mx-auto w-full max-w-[980px]">
        <div className="rounded-[22px] border border-[var(--panel-border)] bg-[var(--panel)] shadow-none">
          <div className="px-4 pt-4">
            <textarea
              className="min-h-[118px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
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

          <div className="flex items-center justify-between gap-3 border-t border-[var(--panel-border)] px-3 py-2.5">
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
              <InlineSelect value={accessValue} onValueChange={setAccessValue}>
                <SelectItem value="full">Full access</SelectItem>
                <SelectItem value="approval">Approval required</SelectItem>
              </InlineSelect>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                aria-label={isRunning ? 'Thinking' : 'Send'}
                className={cn(
                  'size-9 rounded-full border-0 bg-[#2f5cff] p-0 text-white shadow-none hover:bg-[#3b66ff]',
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

        <div className="mt-2 flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span>{catalogError ? catalogError : `Model: ${modelLabel}`}</span>
          <span>{workspace?.branch ?? 'main'}</span>
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
        className="h-6 min-w-fit shrink-0 rounded-md border-0 px-2 text-[12px] text-muted-foreground shadow-none hover:bg-accent"
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

function resolveNextApiMode(
  model: RainyModelCatalogEntry | null,
  currentApiMode: RainyApiMode,
) {
  if (!model) {
    return currentApiMode;
  }

  if (model.preferredApiMode) {
    return model.preferredApiMode;
  }

  if (model.supportedApiModes.includes(currentApiMode)) {
    return currentApiMode;
  }

  return model.supportedApiModes[0] ?? currentApiMode;
}
