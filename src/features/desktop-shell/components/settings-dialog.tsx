import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { CheckIcon, EyeIcon, EyeOffIcon, KeyRoundIcon, Loader2Icon, X } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import {
  clearApiKey,
  clearApiMode,
  clearModel,
  getApiKey,
  getApiMode,
  getModel,
  setApiKey,
  setApiMode,
  setModel,
} from '../../../services/settings-client';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function maskKey(key: string) {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 24)) + key.slice(-4);
}

interface SettingsDialogProps {
  trigger?: ReactElement;
}

export function SettingsDialog({ trigger }: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [currentApiMode, setCurrentApiMode] = useState<'chat_completions' | 'responses' | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [modelInputValue, setModelInputValue] = useState('');
  const [apiModeInputValue, setApiModeInputValue] =
    useState<'chat_completions' | 'responses'>('chat_completions');
  const [showKey, setShowKey] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Load stored key when dialog opens
  useEffect(() => {
    if (!open) return;
    setInputValue('');
    setModelInputValue('');
    setApiModeInputValue('chat_completions');
    setSaveState('idle');
    setErrorMsg('');
    setShowKey(false);
    void Promise.all([getApiKey(), getModel(), getApiMode()]).then(([apiKey, model, apiMode]) => {
      setCurrentKey(apiKey);
      setCurrentModel(model);
      setCurrentApiMode(apiMode);
      setApiModeInputValue(apiMode ?? 'chat_completions');
    });
  }, [open]);

  const handleSave = useCallback(async () => {
    const trimmed = inputValue.trim();
    const trimmedModel = modelInputValue.trim();
    const shouldSaveApiMode = currentApiMode !== apiModeInputValue;
    if (!trimmed && !trimmedModel && !shouldSaveApiMode) return;
    setSaveState('saving');
    setErrorMsg('');
    try {
      if (trimmed) {
        await setApiKey(trimmed);
        setCurrentKey(trimmed);
        setInputValue('');
      }
      if (trimmedModel) {
        await setModel(trimmedModel);
        setCurrentModel(trimmedModel);
        setModelInputValue('');
      }
      if (shouldSaveApiMode) {
        await setApiMode(apiModeInputValue);
        setCurrentApiMode(apiModeInputValue);
      }
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2200);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save the key.');
      setSaveState('error');
    }
  }, [apiModeInputValue, currentApiMode, inputValue, modelInputValue]);

  const handleClear = useCallback(async () => {
    setSaveState('saving');
    try {
      await Promise.all([clearApiKey(), clearModel(), clearApiMode()]);
      setCurrentKey(null);
      setCurrentModel(null);
      setCurrentApiMode(null);
      setApiModeInputValue('chat_completions');
      setSaveState('idle');
    } catch {
      setSaveState('idle');
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') void handleSave();
    },
    [handleSave],
  );

  const hasNewInput =
    inputValue.trim().length > 0 ||
    modelInputValue.trim().length > 0 ||
    currentApiMode !== apiModeInputValue;
  const isBusy = saveState === 'saving';

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={
          trigger ?? (
            <Button size="icon-sm" variant="ghost" aria-label="Open settings">
              <KeyRoundIcon className="size-4" />
            </Button>
          )
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[4px]" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] border border-[var(--panel-border)] bg-[var(--panel)] shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
          {/* ── Header ── */}
          <div className="flex items-start justify-between gap-4 border-b border-[var(--panel-border)] px-6 py-5">
            <div>
              <Dialog.Title className="text-lg font-semibold text-[var(--foreground)]">
                Settings
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[var(--muted-foreground)]">
                Configure your Rainy API key to start using MaTE X.
              </Dialog.Description>
            </div>
            <Dialog.Close
              render={
                <Button size="icon-sm" variant="ghost" aria-label="Close settings">
                  <X className="size-4" />
                </Button>
              }
            />
          </div>

          {/* ── Body ── */}
          <div className="flex flex-col gap-5 px-6 py-5">
            {/* Current key status */}
            <div className="flex items-start gap-3 rounded-[22px] border border-[var(--panel-border)] bg-[var(--surface)] p-4">
              <div className="rounded-2xl bg-[var(--surface-soft)] p-3 text-[var(--foreground)]">
                <KeyRoundIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
                  Rainy API Key
                </p>
                {currentKey ? (
                  <>
                    <p className="mt-1 font-mono text-sm font-medium text-[var(--foreground)]">
                      {maskKey(currentKey)}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        Connected
                      </span>
                      <button
                        onClick={() => void handleClear()}
                        disabled={isBusy}
                        className="text-[11px] text-[var(--muted-foreground)] underline-offset-2 hover:text-red-400 hover:underline disabled:opacity-50"
                      >
                        Remove key
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      No key configured
                    </p>
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <span className="size-1.5 rounded-full bg-amber-500" />
                      Not connected
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-[22px] border border-[var(--panel-border)] bg-[var(--surface)] p-4">
              <div className="rounded-2xl bg-[var(--surface-soft)] p-3 text-[var(--foreground)]">
                <KeyRoundIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
                  Rainy API Mode
                </p>
                <p className="mt-1 font-mono text-sm font-medium text-[var(--foreground)]">
                  {currentApiMode ?? 'chat_completions'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-[22px] border border-[var(--panel-border)] bg-[var(--surface)] p-4">
              <div className="rounded-2xl bg-[var(--surface-soft)] p-3 text-[var(--foreground)]">
                <KeyRoundIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
                  Rainy Model
                </p>
                {currentModel ? (
                  <p className="mt-1 font-mono text-sm font-medium text-[var(--foreground)]">
                    {currentModel}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    No model configured
                  </p>
                )}
              </div>
            </div>

            {/* Input */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="settings-api-key-input"
                className="text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--muted-foreground)]"
              >
                {currentKey ? 'Replace key' : 'Enter your API key'}
              </label>
              <div className="relative flex items-center">
                <input
                  id="settings-api-key-input"
                  ref={inputRef}
                  type={showKey ? 'text' : 'password'}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="rainy-••••••••••••••••••••••"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={isBusy}
                  className="w-full rounded-2xl border border-[var(--panel-border)] bg-[var(--surface)] px-4 py-3 pr-10 font-mono text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/40 outline-none transition-colors focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-3 text-[var(--muted-foreground)]/50 transition-colors hover:text-[var(--foreground)]"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </button>
              </div>
              {saveState === 'error' && (
                <p className="text-xs text-destructive-foreground">{errorMsg}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="settings-model-input"
                className="text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--muted-foreground)]"
              >
                {currentModel ? 'Replace model' : 'Enter Rainy model'}
              </label>
              <input
                id="settings-model-input"
                type="text"
                value={modelInputValue}
                onChange={(e) => setModelInputValue(e.target.value)}
                placeholder="gpt-5.4-mini"
                autoComplete="off"
                spellCheck={false}
                disabled={isBusy}
                className="w-full rounded-2xl border border-[var(--panel-border)] bg-[var(--surface)] px-4 py-3 font-mono text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/40 outline-none transition-colors focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20 disabled:opacity-50"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="settings-api-mode-input"
                className="text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--muted-foreground)]"
              >
                API mode
              </label>
              <select
                id="settings-api-mode-input"
                value={apiModeInputValue}
                onChange={(e) =>
                  setApiModeInputValue(e.target.value as 'chat_completions' | 'responses')
                }
                disabled={isBusy}
                className="w-full rounded-2xl border border-[var(--panel-border)] bg-[var(--surface)] px-4 py-3 font-mono text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20 disabled:opacity-50"
              >
                <option value="chat_completions">chat_completions</option>
                <option value="responses">responses</option>
              </select>
            </div>

            {/* Action row */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--muted-foreground)]/60">
                Get your key at{' '}
                <span className="font-medium text-[var(--muted-foreground)]">rainy.dev</span>
              </p>
              <button
                onClick={() => void handleSave()}
                disabled={!hasNewInput || isBusy}
                className="inline-flex items-center gap-2 rounded-2xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isBusy ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : saveState === 'saved' ? (
                  <CheckIcon className="size-3.5" />
                ) : null}
                {saveState === 'saved' ? 'Saved' : 'Save key'}
              </button>
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="border-t border-[var(--panel-border)] px-6 py-4">
            <p className="text-xs text-[var(--muted-foreground)]/50">
              Your key and model are stored locally in the app database. Live calls use {` `}
              <span className="font-mono">{'https://rainy-api-v3-us-179843975974.us-east4.run.app'}</span>.
            </p>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
