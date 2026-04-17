import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useRouterState } from '@tanstack/react-router';
import {
  CheckIcon,
  FolderArchiveIcon,
  KeyRoundIcon,
  Loader2Icon,
  PencilIcon,
  RefreshCcwIcon,
  ServerIcon,
  Settings2Icon,
  WaypointsIcon,
} from 'lucide-react';

import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { SettingsRow, SettingsSection } from '../components/ui/settings-layout';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
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
import { getApiKey, setApiKey } from '../services/settings-client';

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
  const [inputValue, setInputValue] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [diffLineWrapping, setDiffLineWrapping] = useState(false);
  const [assistantOutput, setAssistantOutput] = useState(false);
  const [archiveConfirmation, setArchiveConfirmation] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setIsLoading(true);
      try {
        const apiKey = await getApiKey();
        if (cancelled) return;
        setCurrentKey(apiKey);
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

  const hasKeyDraft = inputValue.trim().length > 0 && inputValue.trim() !== (currentKey ?? '');
  const isBusy = isLoading || saveState === 'saving';
  const saveLabel = saveState === 'saved' ? 'Saved' : 'Save changes';

  const handleSave = useCallback(async () => {
    const trimmedKey = inputValue.trim();
    if (!trimmedKey || trimmedKey === currentKey) {
      return;
    }

    setSaveState('saving');
    setErrorMsg('');

    try {
      if (!isValidRainyApiKey(trimmedKey)) {
        setSaveState('idle');
        setIsApiKeyDialogOpen(true);
        return;
      }

      await setApiKey(trimmedKey);
      setCurrentKey(trimmedKey);
      setInputValue('');
      setIsEditingKey(false);
      setSaveState('saved');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not save settings.');
      setSaveState('error');
    }
  }, [currentKey, inputValue]);

  const handleRestoreDefaults = useCallback(() => {
    setTheme('system');
    setDiffLineWrapping(false);
    setAssistantOutput(false);
    setArchiveConfirmation(false);
    setDeleteConfirmation(true);
  }, [setTheme]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        void handleSave();
      }
    },
    [handleSave],
  );

  const changedSettingLabels = useMemo(
    () => [
      ...(theme !== 'system' ? ['Theme'] : []),
      ...(diffLineWrapping ? ['Diff line wrapping'] : []),
      ...(assistantOutput ? ['Assistant output'] : []),
      ...(archiveConfirmation ? ['Archive confirmation'] : []),
      ...(!deleteConfirmation ? ['Delete confirmation'] : []),
    ],
    [archiveConfirmation, assistantOutput, deleteConfirmation, diffLineWrapping, theme],
  );

  const section: SettingsSectionId =
    pathname === '/settings/connections'
      ? 'connections'
      : pathname === '/settings/archive'
        ? 'archive'
        : 'general';

  return (
    <>
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
              onClick={handleRestoreDefaults}
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
                        ? `Stored locally on this device. Current key ${maskKey(currentKey)}.`
                        : 'Connect your Rainy account to enable live responses.'
                    }
                    control={
                      <div className="flex items-center gap-2">
                        {currentKey && !isEditingKey ? (
                          <div className="flex h-10 w-[220px] items-center rounded-md border border-input bg-background px-3 text-xs text-muted-foreground">
                            Saved: {maskKey(currentKey)}
                          </div>
                        ) : (
                          <Input
                            nativeInput
                            type="password"
                            value={inputValue}
                            onChange={(event) => {
                              setInputValue(event.target.value);
                              if (saveState === 'saved') {
                                setSaveState('idle');
                              }
                            }}
                            onKeyDown={handleKeyDown}
                            placeholder="ra-••••••••••••••••"
                            className="w-[220px]"
                            disabled={isBusy}
                          />
                        )}

                        <span
                          className={cn(
                            'rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]',
                            currentKey
                              ? 'bg-emerald-500/12 text-emerald-500'
                              : 'bg-amber-500/12 text-amber-500',
                          )}
                        >
                          {saveState === 'saved' ? 'Saved' : currentKey ? 'Connected' : 'Missing'}
                        </span>

                        {currentKey && !isEditingKey ? (
                          <Button
                            size="xs"
                            variant="outline"
                            className="h-8 rounded-lg px-3 text-[12px] shadow-none"
                            onClick={() => {
                              setIsEditingKey(true);
                              setInputValue('');
                              setSaveState('idle');
                            }}
                            disabled={isBusy}
                          >
                            <PencilIcon className="size-3.5" />
                            Replace
                          </Button>
                        ) : null}
                      </div>
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
                </>
              </SettingsSection>
            ) : null}

            <div className="mt-4 flex items-center justify-between gap-4">
              <div className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
                {saveState === 'error' ? (
                  <span className="text-destructive-foreground">{errorMsg}</span>
                ) : section === 'connections' ? (
                  <span>
                    {hasKeyDraft
                      ? 'Pending: Rainy API key'
                      : currentKey
                        ? 'Rainy key saved and active'
                        : 'Rainy API key not configured'}
                  </span>
                ) : (
                  <span>
                    {changedSettingLabels.length > 0
                      ? `Pending: ${changedSettingLabels.join(', ')}`
                      : 'No pending settings changes'}
                  </span>
                )}
              </div>

              {section === 'connections' ? (
                <Button
                  size="sm"
                  className="h-9 rounded-lg px-4"
                  onClick={() => void handleSave()}
                  disabled={!hasKeyDraft || isBusy}
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
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <AlertDialog open={isApiKeyDialogOpen} onOpenChange={setIsApiKeyDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rainy API key invalid</AlertDialogTitle>
            <AlertDialogDescription>
              The Rainy API v3 key must start with <code>ra-</code> or <code>rk_live_</code>. Enter a valid key
              before saving.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button />}>Understood</AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function isValidRainyApiKey(value: string) {
  return value.startsWith('ra-') || value.startsWith('rk_live_');
}
