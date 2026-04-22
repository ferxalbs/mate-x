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
  ShieldCheckIcon,
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
import type {
  WorkspaceTrustAutonomy,
  WorkspaceTrustContract,
} from '../contracts/workspace';
import {
  DEFAULT_APP_SETTINGS,
  type AgentTraceVersion,
  type AppSettings,
  type TimeFormat,
} from '../contracts/settings';
import { useTheme, type Theme } from '../hooks/use-theme';
import { cn } from '../lib/utils';
import {
  getWorkspaceTrustContract,
  updateWorkspaceTrustContract,
} from '../services/repo-client';
import {
  applyRendererSettings,
  getApiKey,
  getAppSettings,
  setApiKey,
  updateAppSettings,
} from '../services/settings-client';
import { useChatStore } from '../store/chat-store';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type SettingsSectionId = 'general' | 'connections' | 'trust' | 'archive';

function maskKey(key: string) {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 24)) + key.slice(-4);
}

export function SettingsPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { setTheme } = useTheme();
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const activeWorkspace = useChatStore((state) => state.workspace);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(false);
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>({ ...DEFAULT_APP_SETTINGS });
  const [savedAppSettings, setSavedAppSettings] = useState<AppSettings>({ ...DEFAULT_APP_SETTINGS });
  const [trustContract, setTrustContract] = useState<WorkspaceTrustContract | null>(null);
  const [trustDraft, setTrustDraft] = useState<WorkspaceTrustContract | null>(null);

  const section: SettingsSectionId =
    pathname === '/settings/connections'
      ? 'connections'
      : pathname === '/settings/trust'
        ? 'trust'
        : pathname === '/settings/archive'
          ? 'archive'
          : 'general';

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setIsLoading(true);
      try {
        const [apiKey, contract, persistedAppSettings] = await Promise.all([
          getApiKey(),
          activeWorkspaceId
            ? getWorkspaceTrustContract(activeWorkspaceId)
            : Promise.resolve(null),
          getAppSettings(),
        ]);
        if (cancelled) return;
        setCurrentKey(apiKey);
        setTrustContract(contract);
        setTrustDraft(contract);
        setAppSettings(persistedAppSettings);
        setSavedAppSettings(persistedAppSettings);
        setTheme(persistedAppSettings.theme as Theme);
        applyRendererSettings(persistedAppSettings);
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
  }, [activeWorkspaceId, setTheme]);

  const hasKeyDraft = inputValue.trim().length > 0 && inputValue.trim() !== (currentKey ?? '');
  const hasAppSettingsDraft =
    serializeAppSettings(appSettings) !== serializeAppSettings(savedAppSettings);
  const hasTrustDraft = Boolean(
    trustContract &&
      trustDraft &&
      serializeTrustContract(trustDraft) !== serializeTrustContract(trustContract),
  );
  const isBusy = isLoading || saveState === 'saving';
  const saveLabel = saveState === 'saved' ? 'Saved' : 'Save changes';

  const handleSave = useCallback(async () => {
    if (section === 'trust') {
      if (!trustDraft || !hasTrustDraft) {
        return;
      }

      setSaveState('saving');
      setErrorMsg('');

      try {
        const nextContract = await updateWorkspaceTrustContract(trustDraft);
        setTrustContract(nextContract);
        setTrustDraft(nextContract);
        useChatStore.setState({ trustContract: nextContract });
        setSaveState('saved');
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : 'Could not save trust contract.');
        setSaveState('error');
      }
      return;
    }

    if (section === 'general' || section === 'archive') {
      if (!hasAppSettingsDraft) {
        return;
      }

      setSaveState('saving');
      setErrorMsg('');

      try {
        const nextSettings = await updateAppSettings(appSettings);
        setSavedAppSettings(nextSettings);
        applyRendererSettings(nextSettings);
        setSaveState('saved');
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : 'Could not save settings.');
        setSaveState('error');
      }
      return;
    }

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
  }, [appSettings, currentKey, hasAppSettingsDraft, hasTrustDraft, inputValue, section, trustDraft]);

  const handleRestoreDefaults = useCallback(() => {
    if (section === 'general') {
      setAppSettings((current) => ({
        ...current,
        theme: DEFAULT_APP_SETTINGS.theme,
        timeFormat: DEFAULT_APP_SETTINGS.timeFormat,
        diffLineWrapping: DEFAULT_APP_SETTINGS.diffLineWrapping,
        assistantOutput: DEFAULT_APP_SETTINGS.assistantOutput,
      }));
      setTheme('system');
    } else if (section === 'archive') {
      setAppSettings((current) => ({
        ...current,
        archiveConfirmation: DEFAULT_APP_SETTINGS.archiveConfirmation,
        deleteConfirmation: DEFAULT_APP_SETTINGS.deleteConfirmation,
      }));
    } else if (section === 'trust' && trustContract) {
      setTrustDraft(trustContract);
    } else if (section === 'connections') {
      setInputValue('');
      setIsEditingKey(false);
    }
    setSaveState('idle');
  }, [section, setTheme, trustContract]);

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
      ...(appSettings.theme !== savedAppSettings.theme ? ['Theme'] : []),
      ...(appSettings.timeFormat !== savedAppSettings.timeFormat ? ['Time format'] : []),
      ...(appSettings.agentTraceVersion !== savedAppSettings.agentTraceVersion ? ['Agent Trace mode'] : []),
      ...(appSettings.diffLineWrapping !== savedAppSettings.diffLineWrapping ? ['Diff line wrapping'] : []),
      ...(appSettings.assistantOutput !== savedAppSettings.assistantOutput ? ['Assistant output'] : []),
      ...(appSettings.archiveConfirmation !== savedAppSettings.archiveConfirmation ? ['Archive confirmation'] : []),
      ...(appSettings.deleteConfirmation !== savedAppSettings.deleteConfirmation ? ['Delete confirmation'] : []),
      ...(hasTrustDraft ? ['Workspace trust contract'] : []),
    ],
    [
      appSettings.archiveConfirmation,
      appSettings.assistantOutput,
      appSettings.deleteConfirmation,
      appSettings.diffLineWrapping,
      appSettings.agentTraceVersion,
      appSettings.theme,
      appSettings.timeFormat,
      hasTrustDraft,
      savedAppSettings.archiveConfirmation,
      savedAppSettings.assistantOutput,
      savedAppSettings.deleteConfirmation,
      savedAppSettings.diffLineWrapping,
      savedAppSettings.agentTraceVersion,
      savedAppSettings.theme,
      savedAppSettings.timeFormat,
    ],
  );

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
                      <Select
                        value={appSettings.theme}
                        onValueChange={(value) => {
                          setTheme(value as Theme);
                          setAppSettings((current) => ({ ...current, theme: value as Theme }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      >
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
                      <Select
                        value={appSettings.timeFormat}
                        onValueChange={(value) => {
                          setAppSettings((current) => ({
                            ...current,
                            timeFormat: value as TimeFormat,
                          }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      >
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
                    title="Agent Trace mode"
                    description="Select the trace protocol version used for assistant runs."
                    control={
                      <Select
                        value={appSettings.agentTraceVersion}
                        onValueChange={(value) => {
                          setAppSettings((current) => ({
                            ...current,
                            agentTraceVersion: value as AgentTraceVersion,
                          }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      >
                        <SelectTrigger className="w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="v1">Version 1</SelectItem>
                          <SelectItem value="v2">Version 2</SelectItem>
                        </SelectContent>
                      </Select>
                    }
                  />
                  <SettingsRow
                    title="Diff line wrapping"
                    description="Set the default wrap state when the diff panel opens."
                    control={
                      <Switch
                        checked={appSettings.diffLineWrapping}
                        onCheckedChange={(value) => {
                          setAppSettings((current) => ({ ...current, diffLineWrapping: value }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      />
                    }
                  />
                  <SettingsRow
                    title="Assistant output"
                    description="Show token-by-token output while a response is in progress."
                    control={
                      <Switch
                        checked={appSettings.assistantOutput}
                        onCheckedChange={(value) => {
                          setAppSettings((current) => ({ ...current, assistantOutput: value }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      />
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

            {section === 'trust' ? (
              <SettingsSection title="Workspace Trust Contract" icon={<ShieldCheckIcon className="size-3.5" />}>
                {trustDraft ? (
                  <>
                    <SettingsRow
                      title="Operational profile"
                      description={`Versioned contract for ${activeWorkspace?.name ?? 'the active workspace'}. This profile is sent into each run and enforced before tool execution.`}
                      status={`Updated ${formatDateTime(trustDraft.updatedAt)}`}
                      control={
                        <Select
                          value={trustDraft.autonomy}
                          onValueChange={(value) =>
                            setTrustDraft((draft) =>
                              draft
                                ? {
                                    ...draft,
                                    autonomy: value as WorkspaceTrustAutonomy,
                                  }
                                : draft,
                            )
                          }
                        >
                          <SelectTrigger className="w-[190px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="plan-only">Plan only</SelectItem>
                            <SelectItem value="approval-required">Approval required</SelectItem>
                            <SelectItem value="trusted-patch">Trusted patch</SelectItem>
                          </SelectContent>
                        </Select>
                      }
                    />
                    <TrustTextareaRow
                      title="Scope"
                      description="Folders and files the agent can inspect or modify when a tool accepts a path."
                      value={trustDraft.allowedPaths}
                      onChange={(allowedPaths) =>
                        setTrustDraft((draft) => draft ? { ...draft, allowedPaths } : draft)
                      }
                    />
                    <TrustTextareaRow
                      title="Forbidden"
                      description="Paths that remain blocked even when they sit under an allowed folder."
                      value={trustDraft.forbiddenPaths}
                      onChange={(forbiddenPaths) =>
                        setTrustDraft((draft) => draft ? { ...draft, forbiddenPaths } : draft)
                      }
                    />
                    <TrustTextareaRow
                      title="Commands"
                      description="Exact command prefixes allowed for controlled execution tools."
                      value={trustDraft.allowedCommands}
                      onChange={(allowedCommands) =>
                        setTrustDraft((draft) => draft ? { ...draft, allowedCommands } : draft)
                      }
                    />
                    <TrustTextareaRow
                      title="Network"
                      description="Domains the main process may query during governed runs."
                      value={trustDraft.allowedDomains}
                      onChange={(allowedDomains) =>
                        setTrustDraft((draft) => draft ? { ...draft, allowedDomains } : draft)
                      }
                    />
                    <TrustTextareaRow
                      title="Secrets"
                      description="Secret labels available to runs. Empty means no workspace secrets are released."
                      value={trustDraft.allowedSecrets}
                      placeholder="none"
                      onChange={(allowedSecrets) =>
                        setTrustDraft((draft) => draft ? { ...draft, allowedSecrets } : draft)
                      }
                    />
                    <TrustTextareaRow
                      title="Allowed actions"
                      description="Action classes the tool loop may perform inside this workspace."
                      value={trustDraft.allowedActions}
                      onChange={(allowedActions) =>
                        setTrustDraft((draft) => draft ? { ...draft, allowedActions } : draft)
                      }
                    />
                    <TrustTextareaRow
                      title="Blocked actions"
                      description="High-risk action classes the contract rejects before execution."
                      value={trustDraft.blockedActions}
                      onChange={(blockedActions) =>
                        setTrustDraft((draft) => draft ? { ...draft, blockedActions } : draft)
                      }
                    />
                  </>
                ) : (
                  <SettingsRow
                    title="No active workspace"
                    description="Import or activate a workspace before editing its trust contract."
                    control={null}
                  />
                )}
              </SettingsSection>
            ) : null}

            {section === 'archive' ? (
              <SettingsSection title="Archive" icon={<FolderArchiveIcon className="size-3.5" />}>
                <>
                  <SettingsRow
                    title="Archive confirmation"
                    description="Require a second click on the inline archive action before a thread is archived."
                    control={
                      <Switch
                        checked={appSettings.archiveConfirmation}
                        onCheckedChange={(value) => {
                          setAppSettings((current) => ({ ...current, archiveConfirmation: value }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      />
                    }
                  />
                  <SettingsRow
                    title="Delete confirmation"
                    description="Ask before deleting a thread and its local chat history."
                    control={
                      <Switch
                        checked={appSettings.deleteConfirmation}
                        onCheckedChange={(value) => {
                          setAppSettings((current) => ({ ...current, deleteConfirmation: value }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      />
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
                ) : section === 'trust' ? (
                  <span>
                    {hasTrustDraft
                      ? 'Pending: workspace trust contract'
                      : trustContract
                        ? `Contract ${trustContract.name} v${trustContract.version} active`
                        : 'No active trust contract'}
                  </span>
                ) : (
                  <span>
                    {changedSettingLabels.length > 0
                      ? `Pending: ${changedSettingLabels.join(', ')}`
                      : 'No pending settings changes'}
                  </span>
                )}
              </div>

              {section === 'general' || section === 'archive' || section === 'connections' || section === 'trust' ? (
                <Button
                  size="sm"
                  className="h-9 rounded-lg px-4"
                  onClick={() => void handleSave()}
                  disabled={
                    section === 'connections'
                      ? !hasKeyDraft || isBusy
                      : section === 'trust'
                        ? !hasTrustDraft || isBusy
                        : !hasAppSettingsDraft || isBusy
                  }
                >
                  {isBusy ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : saveState === 'saved' ? (
                    <CheckIcon className="size-4" />
                  ) : section === 'trust' ? (
                    <ShieldCheckIcon className="size-4" />
                  ) : section === 'general' || section === 'archive' ? (
                    <Settings2Icon className="size-4" />
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

function TrustTextareaRow({
  title,
  description,
  value,
  placeholder,
  onChange,
}: {
  title: string;
  description: string;
  value: string[];
  placeholder?: string;
  onChange: (value: string[]) => void;
}) {
  return (
    <SettingsRow
      title={title}
      description={description}
      control={
        <textarea
          className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground/50 focus-visible:border-ring sm:w-[360px]"
          value={value.join('\n')}
          placeholder={placeholder}
          onChange={(event) => onChange(parseLines(event.target.value))}
        />
      }
    />
  );
}

function parseLines(value: string) {
  return Array.from(
    new Set(
      value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  );
}

function serializeAppSettings(settings: AppSettings) {
  return JSON.stringify(settings);
}

function serializeTrustContract(contract: WorkspaceTrustContract) {
  return JSON.stringify({
    name: contract.name,
    version: contract.version,
    autonomy: contract.autonomy,
    allowedPaths: contract.allowedPaths,
    forbiddenPaths: contract.forbiddenPaths,
    allowedCommands: contract.allowedCommands,
    allowedDomains: contract.allowedDomains,
    allowedSecrets: contract.allowedSecrets,
    allowedActions: contract.allowedActions,
    blockedActions: contract.blockedActions,
  });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
