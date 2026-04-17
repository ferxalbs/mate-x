import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useRouterState } from '@tanstack/react-router';
import {
  CheckIcon,
  FolderArchiveIcon,
  KeyRoundIcon,
  Loader2Icon,
  RefreshCcwIcon,
  ServerIcon,
  Settings2Icon,
  Trash2Icon,
  WaypointsIcon,
} from 'lucide-react';

import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { SettingsRow, SettingsSection } from '../components/ui/settings-layout';
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

export function SettingsPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { theme, setTheme } = useTheme();
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
  const changedSettingLabels = [
    ...(theme !== 'system' ? ['Theme'] : []),
    ...(diffLineWrapping ? ['Diff line wrapping'] : []),
    ...(assistantOutput ? ['Assistant output'] : []),
    ...(archiveConfirmation ? ['Archive confirmation'] : []),
    ...(!deleteConfirmation ? ['Delete confirmation'] : []),
    ...(inputValue.trim().length > 0 ? ['Rainy API key'] : []),
    ...(modelInputValue.trim().length > 0 ? ['Text generation model'] : []),
    ...(currentApiMode !== apiModeInputValue ? ['Request mode'] : []),
  ];
  const section: SettingsSectionId =
    pathname === '/settings/connections'
      ? 'connections'
      : pathname === '/settings/archive'
        ? 'archive'
        : 'general';

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="drag-region flex h-[52px] shrink-0 items-center border-b border-border/70 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-sm font-medium tracking-tight text-foreground">Settings</span>
          <span className="rounded-full bg-muted/45 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
            {section}
          </span>
        </div>
        <div className="ms-auto no-drag">
          <Button
            size="xs"
            variant="outline"
            className="h-8 rounded-lg border-border/70 bg-background/65 px-3 text-[12px] font-medium shadow-none"
            onClick={() => void handleRestoreDefaults()}
            disabled={isBusy || changedSettingLabels.length === 0}
          >
            <RefreshCcwIcon className="size-3.5" />
            Restore defaults
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          {section === 'general' ? (
            <SettingsSection title="General" icon={<Settings2Icon className="size-3.5" />}>
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
                  status={
                    currentModel ? (
                      <span className="font-mono text-[11px] text-muted-foreground/80">
                        Current: {currentModel}
                      </span>
                    ) : null
                  }
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
            </SettingsSection>
          ) : null}

          {section === 'connections' ? (
            <SettingsSection title="Connections" icon={<WaypointsIcon className="size-3.5" />}>
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
            </SettingsSection>
          ) : null}

          {section === 'archive' ? (
            <SettingsSection title="Archive" icon={<FolderArchiveIcon className="size-3.5" />}>
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
            </SettingsSection>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
              {saveState === 'error' ? (
                <span className="text-destructive-foreground">{errorMsg}</span>
              ) : (
                <span>
                  {changedSettingLabels.length > 0
                    ? `Pending: ${changedSettingLabels.join(', ')}`
                    : currentModel ?? 'No model configured'}
                </span>
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
    </section>
  );
}
