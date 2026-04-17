import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Link } from '@tanstack/react-router';
import {
  ArrowLeftIcon,
  CheckIcon,
  Clock3Icon,
  FolderArchiveIcon,
  KeyRoundIcon,
  Loader2Icon,
  MoonStarIcon,
  RefreshCcwIcon,
  ServerIcon,
  Settings2Icon,
  SunMediumIcon,
  Trash2Icon,
  WaypointsIcon,
} from 'lucide-react';

import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { useTheme, type Theme } from '../hooks/use-theme';
import { cn } from '../lib/utils';
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
} from '../services/settings-client';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type SettingsSectionId = 'general' | 'connections' | 'archive';

function maskKey(key: string) {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 24)) + key.slice(-4);
}

function SettingsNavButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Settings2Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-accent/75 text-foreground'
          : 'text-muted-foreground hover:bg-accent/45 hover:text-foreground',
      )}
      onClick={onClick}
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </button>
  );
}

function SettingsRow({
  control,
  description,
  title,
}: {
  control: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-t border-border/60 px-5 py-4 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3">{control}</div>
    </div>
  );
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [section, setSection] = useState<SettingsSectionId>('general');
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [currentApiMode, setCurrentApiMode] = useState<'chat_completions' | 'responses' | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [modelInputValue, setModelInputValue] = useState('');
  const [apiModeInputValue, setApiModeInputValue] = useState<'chat_completions' | 'responses'>('chat_completions');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [diffLineWrapping, setDiffLineWrapping] = useState(false);
  const [assistantOutput, setAssistantOutput] = useState(false);
  const [archiveConfirmation, setArchiveConfirmation] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setIsLoading(true);
      try {
        const [apiKey, model, apiMode] = await Promise.all([getApiKey(), getModel(), getApiMode()]);
        if (cancelled) return;

        setCurrentKey(apiKey);
        setCurrentModel(model);
        setCurrentApiMode(apiMode);
        setApiModeInputValue(apiMode ?? 'chat_completions');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = useCallback(async () => {
    const trimmedKey = inputValue.trim();
    const trimmedModel = modelInputValue.trim();
    const shouldSaveApiMode = currentApiMode !== apiModeInputValue;

    if (!trimmedKey && !trimmedModel && !shouldSaveApiMode) {
      return;
    }

    setSaveState('saving');
    setErrorMsg('');

    try {
      if (trimmedKey) {
        await setApiKey(trimmedKey);
        setCurrentKey(trimmedKey);
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
      window.setTimeout(() => setSaveState('idle'), 2200);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not save settings.');
      setSaveState('error');
    }
  }, [apiModeInputValue, currentApiMode, inputValue, modelInputValue]);

  const handleRestoreDefaults = useCallback(async () => {
    setSaveState('saving');
    setErrorMsg('');

    try {
      await Promise.all([clearApiMode(), clearModel()]);
      setCurrentModel(null);
      setCurrentApiMode(null);
      setModelInputValue('');
      setApiModeInputValue('chat_completions');
      setTheme('system');
      setDiffLineWrapping(false);
      setAssistantOutput(false);
      setArchiveConfirmation(false);
      setDeleteConfirmation(true);
      setSaveState('idle');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not restore defaults.');
      setSaveState('error');
    }
  }, [setTheme]);

  const handleClearSavedConfig = useCallback(async () => {
    setSaveState('saving');
    setErrorMsg('');

    try {
      await Promise.all([clearApiKey(), clearApiMode(), clearModel()]);
      setCurrentKey(null);
      setCurrentModel(null);
      setCurrentApiMode(null);
      setInputValue('');
      setModelInputValue('');
      setApiModeInputValue('chat_completions');
      setSaveState('idle');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not clear saved config.');
      setSaveState('error');
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        void handleSave();
      }
    },
    [handleSave],
  );

  const pendingChanges = useMemo(
    () =>
      inputValue.trim().length > 0 ||
      modelInputValue.trim().length > 0 ||
      currentApiMode !== apiModeInputValue,
    [apiModeInputValue, currentApiMode, inputValue, modelInputValue],
  );
  const isBusy = isLoading || saveState === 'saving';
  const saveLabel = saveState === 'saved' ? 'Saved' : 'Save changes';

  return (
    <section className="flex h-full w-full overflow-hidden bg-background">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border/70 bg-[var(--sidebar)]">
        <div className="drag-region flex h-[44px] items-center border-b border-border/70 px-4 pl-[88px]">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[13px] font-semibold tracking-[-0.02em] text-foreground">
              MaTE X
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/55">
              (Alpha)
            </span>
          </div>
        </div>

        <div className="flex-1 px-3 py-4">
          <div className="space-y-1">
            <SettingsNavButton
              active={section === 'general'}
              icon={Settings2Icon}
              label="General"
              onClick={() => setSection('general')}
            />
            <SettingsNavButton
              active={section === 'connections'}
              icon={WaypointsIcon}
              label="Connections"
              onClick={() => setSection('connections')}
            />
            <SettingsNavButton
              active={section === 'archive'}
              icon={FolderArchiveIcon}
              label="Archive"
              onClick={() => setSection('archive')}
            />
          </div>
        </div>

        <div className="border-t border-border/70 p-3">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/45 hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            Back
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="drag-region flex h-[44px] items-center justify-between border-b border-border/70 px-5">
          <h1 className="text-sm font-medium tracking-tight text-foreground">Settings</h1>
          <div className="no-drag">
            <Button
              size="xs"
              variant="outline"
              className="h-8 rounded-lg border-border/70 bg-background/65 px-3 text-[12px] font-medium shadow-none"
              onClick={() => void handleRestoreDefaults()}
              disabled={isBusy}
            >
              <RefreshCcwIcon className="size-3.5" />
              Restore defaults
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-8 py-7">
          <div className="mx-auto w-full max-w-[920px]">
            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
                {section === 'general'
                  ? 'General'
                  : section === 'connections'
                    ? 'Connections'
                    : 'Archive'}
              </p>
            </div>

            <section className="overflow-hidden rounded-[22px] border border-border/70 bg-card shadow-[0_10px_30px_rgba(0,0,0,0.08)] dark:shadow-none">
              {section === 'general' ? (
                <>
                  <SettingsRow
                    title="Theme"
                    description="Choose how Mate X looks across the app."
                    control={
                      <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
                        <SelectTrigger className="w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="system">System</SelectItem>
                          <SelectItem value="light">Light</SelectItem>
                          <SelectItem value="dark">Dark</SelectItem>
                        </SelectContent>
                      </Select>
                    }
                  />
                  <SettingsRow
                    title="Time format"
                    description="System default follows your browser or OS clock preference."
                    control={
                      <Select defaultValue="system">
                        <SelectTrigger className="w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="system">System default</SelectItem>
                          <SelectItem value="24h">24-hour</SelectItem>
                          <SelectItem value="12h">12-hour</SelectItem>
                        </SelectContent>
                      </Select>
                    }
                  />
                  <SettingsRow
                    title="Diff line wrapping"
                    description="Set the default wrap state when the diff panel opens."
                    control={
                      <Switch checked={diffLineWrapping} onCheckedChange={setDiffLineWrapping} />
                    }
                  />
                  <SettingsRow
                    title="Assistant output"
                    description="Show token-by-token output while a response is in progress."
                    control={
                      <Switch checked={assistantOutput} onCheckedChange={setAssistantOutput} />
                    }
                  />
                  <SettingsRow
                    title="Text generation model"
                    description="Configure the model used for generated commit messages and shell text."
                    control={
                      <div className="flex items-center gap-2">
                        <Input
                          nativeInput
                          value={modelInputValue}
                          onChange={(event) => setModelInputValue(event.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder={currentModel ?? 'gpt-5.4-mini'}
                          className="w-[170px]"
                          disabled={isBusy}
                        />
                        <Select defaultValue="high">
                          <SelectTrigger className="w-[92px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="low">Low</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    }
                  />
                </>
              ) : null}

              {section === 'connections' ? (
                <>
                  <SettingsRow
                    title="Rainy API key"
                    description={
                      currentKey
                        ? `Stored and ready. Current key ${maskKey(currentKey)}.`
                        : 'Connect your Rainy account to enable live responses.'
                    }
                    control={
                      <div className="flex items-center gap-2">
                        <Input
                          nativeInput
                          type="password"
                          value={inputValue}
                          onChange={(event) => setInputValue(event.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder="rainy-••••••••••••••••"
                          className="w-[220px]"
                          disabled={isBusy}
                        />
                        <span
                          className={cn(
                            'rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]',
                            currentKey
                              ? 'bg-emerald-500/12 text-emerald-500'
                              : 'bg-amber-500/12 text-amber-500',
                          )}
                        >
                          {currentKey ? 'Connected' : 'Missing'}
                        </span>
                      </div>
                    }
                  />
                  <SettingsRow
                    title="Request mode"
                    description="Use chat completions by default unless a model requires Responses."
                    control={
                      <Select
                        value={apiModeInputValue}
                        onValueChange={(value) =>
                          setApiModeInputValue(value as 'chat_completions' | 'responses')
                        }
                        disabled={isBusy}
                      >
                        <SelectTrigger className="w-[170px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="chat_completions">chat_completions</SelectItem>
                          <SelectItem value="responses">responses</SelectItem>
                        </SelectContent>
                      </Select>
                    }
                  />
                  <SettingsRow
                    title="Connection status"
                    description="Main-process credentials are isolated from the renderer."
                    control={
                      <div className="flex items-center gap-2 rounded-full bg-accent/50 px-3 py-1.5 text-xs text-muted-foreground">
                        <ServerIcon className="size-3.5" />
                        {currentKey ? 'IPC secured' : 'Waiting for key'}
                      </div>
                    }
                  />
                </>
              ) : null}

              {section === 'archive' ? (
                <>
                  <SettingsRow
                    title="Archive confirmation"
                    description="Require a second click on the inline archive action before a thread is archived."
                    control={
                      <Switch checked={archiveConfirmation} onCheckedChange={setArchiveConfirmation} />
                    }
                  />
                  <SettingsRow
                    title="Delete confirmation"
                    description="Ask before deleting a thread and its local chat history."
                    control={
                      <Switch checked={deleteConfirmation} onCheckedChange={setDeleteConfirmation} />
                    }
                  />
                  <SettingsRow
                    title="Clear saved config"
                    description="Remove the stored Rainy key, request mode, and default model."
                    control={
                      <Button
                        size="xs"
                        variant="outline"
                        className="h-8 rounded-lg border-border/70 bg-background/65 px-3 text-[12px] shadow-none"
                        onClick={() => void handleClearSavedConfig()}
                        disabled={isBusy}
                      >
                        <Trash2Icon className="size-3.5" />
                        Clear config
                      </Button>
                    }
                  />
                </>
              ) : null}
            </section>

            <div className="mt-4 flex items-center justify-between gap-4">
              <div className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
                {saveState === 'error' ? (
                  <span className="text-destructive-foreground">{errorMsg}</span>
                ) : (
                  <>
                    <Clock3Icon className="size-3.5" />
                    {currentModel ?? 'No model configured'}
                  </>
                )}
              </div>

              <Button
                size="sm"
                className="h-9 rounded-lg px-4"
                onClick={() => void handleSave()}
                disabled={!pendingChanges || isBusy}
              >
                {isBusy ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : saveState === 'saved' ? (
                  <CheckIcon className="size-4" />
                ) : (
                  <KeyRoundIcon className="size-4" />
                )}
                {saveLabel}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
