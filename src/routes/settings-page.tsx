import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import {
  ReloadIcon,
  Tick01Icon,
  Download01Icon,
  FolderOpenIcon,
  Settings02Icon,
  LockKeyIcon,
  ComputerIcon,
  PencilEdit01Icon,
  PuzzleIcon,
  ShieldKeyIcon,
  Shield01Icon,
  DirectionsIcon,
  Loading01Icon,
} from '@hugeicons/core-free-icons';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

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
import type { WorkspaceTrustContract } from '../contracts/workspace';
import {
  DEFAULT_APP_SETTINGS,
  type AgentIntegrationId,
  type AppSettings,
  type PrivacyMode,
  type PrivacyPlaceholderStyle,
  type TimeFormat,
  type VibrancyMode,
} from '../contracts/settings';
import type {
  MobileBridgeDeviceSession,
  MobileBridgePairingPayload,
  MobileBridgeStatus,
  MobilePendingPairingRequest,
} from '../contracts/mobile-bridge';
import type {
  GitHubIntegrationStatus,
  GitHubIntegrationState,
} from '../contracts/github-integration';
import type {
  PrivacyModelDownloadProgress,
  PrivacyModelStatus,
  PrivacySafeScanResult,
} from '../contracts/privacy';
import { useTheme } from '../hooks/use-theme';
import { WorkspaceMemorySettings } from '../features/workspace-memory/workspace-memory-settings';
import { AgentProfilerSettings } from '../features/agent-profiler/agent-profiler-settings';
import { cn } from '../lib/utils';
import {
  getWorkspaceTrustContract,
  updateWorkspaceTrustContract,
} from '../services/repo-client';
import {
  applyRendererSettings,
  getApiKeyStatus,
  getAppSettings,
  setApiKey,
  updateAppSettings,
} from '../services/settings-client';
import { useChatStore } from "@/store/chat-store";
import { usePlatform } from "@/hooks/use-platform";
import { useSidebar } from '@/components/ui/sidebar';
import {
  getRainyApiKeyStatusLabel,
  isValidRainyApiKey,
  serializeAppSettings,
  serializeTrustContract,
} from './settings-page-utils';
import { SettingsTrustSection } from './settings-trust-section';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type SettingsSectionId =
  | 'general'
  | 'connections'
  | 'trust'
  | 'privacy'
  | 'archive'
  | 'integrations'
  | 'agent-profiler'
  | 'workspace-memory';

export function SettingsPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { setAppearance, setTheme, setBlurEnabled } = useTheme();
  const { state } = useSidebar();
  const platform = usePlatform();
  const shouldReduceMotion = useReducedMotion();
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const activeWorkspace = useChatStore((state) => state.workspace);
  const [currentKeyPrefix, setCurrentKeyPrefix] = useState<string | null>(null);
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
  const [privacyModelStatus, setPrivacyModelStatus] = useState<PrivacyModelStatus | null>(null);
  const [privacyModelProgress, setPrivacyModelProgress] = useState<PrivacyModelDownloadProgress | null>(null);
  const [isPrivacyModelBusy, setIsPrivacyModelBusy] = useState(false);
  const [privacyDebugResult, setPrivacyDebugResult] = useState<PrivacySafeScanResult | null>(null);
  const [isPrivacyActionBusy, setIsPrivacyActionBusy] = useState(false);
  const [githubStatus, setGithubStatus] = useState<GitHubIntegrationStatus | null>(null);
  const [isGithubStatusBusy, setIsGithubStatusBusy] = useState(false);
  const [mobileStatus, setMobileStatus] = useState<MobileBridgeStatus | null>(null);
  const [mobilePairingPayload, setMobilePairingPayload] = useState<MobileBridgePairingPayload | null>(null);
  const [mobilePendingPairing, setMobilePendingPairing] = useState<MobilePendingPairingRequest | null>(null);
  const [mobileDevices, setMobileDevices] = useState<MobileBridgeDeviceSession[]>([]);
  const [isMobileBusy, setIsMobileBusy] = useState(false);

  const section: SettingsSectionId =
    pathname === '/settings/workspace-memory'
      ? 'workspace-memory'
      : pathname === '/settings/connections'
      ? 'connections'
      : pathname === '/settings/trust'
        ? 'trust'
        : pathname === '/settings/privacy'
          ? 'privacy'
          : pathname === '/settings/archive'
            ? 'archive'
            : pathname === '/settings/integrations'
              ? 'integrations'
              : pathname === '/settings/agent-profiler'
                ? 'agent-profiler'
                : 'general';

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setIsLoading(true);
      try {
        const [apiKeyStatus, contract, persistedAppSettings] = await Promise.all([
          getApiKeyStatus(),
          activeWorkspaceId
            ? getWorkspaceTrustContract(activeWorkspaceId)
            : Promise.resolve(null),
          getAppSettings(),
        ]);
        if (cancelled) return;
        setCurrentKeyPrefix(apiKeyStatus.configured ? apiKeyStatus.prefix ?? 'configured' : null);
        setTrustContract(contract);
        setTrustDraft(contract);
        setAppSettings(persistedAppSettings);
        setSavedAppSettings(persistedAppSettings);
        setAppearance(persistedAppSettings.appearance);
        setTheme(persistedAppSettings.theme);
        setBlurEnabled(persistedAppSettings.blurEnabled);
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
  }, [activeWorkspaceId, setAppearance, setTheme, setBlurEnabled]);

  useEffect(() => {
    setSaveState('idle');
    setErrorMsg('');
  }, [section]);

  const refreshPrivacyModelStatus = useCallback(async () => {
    const status = await window.mate.privacy.getModelStatus();
    setPrivacyModelStatus(status);
  }, []);

  useEffect(() => {
    void refreshPrivacyModelStatus();
  }, [refreshPrivacyModelStatus]);

  const refreshGithubStatus = useCallback(async () => {
    if (!activeWorkspace?.path) {
      setGithubStatus({
        state: appSettings.githubIntegrationEnabled ? 'enabled_not_configured' : 'disabled',
        repository: null,
        branch: null,
        message: 'Select a workspace to detect local GitHub evidence.',
      });
      return;
    }

    setIsGithubStatusBusy(true);
    try {
      setGithubStatus(await window.mate.github.getIntegrationStatus(activeWorkspace.path));
    } finally {
      setIsGithubStatusBusy(false);
    }
  }, [activeWorkspace?.path, appSettings.githubIntegrationEnabled]);

  useEffect(() => {
    if (section === 'integrations') {
      void refreshGithubStatus();
    }
  }, [refreshGithubStatus, section]);

  const refreshMobileBridge = useCallback(async () => {
    const [status, pending, devices] = await Promise.all([
      window.mate.mobile.getStatus(),
      window.mate.mobile.getPendingPairing(),
      window.mate.mobile.listDevices(),
    ]);
    setMobileStatus(status);
    setMobilePendingPairing(pending);
    setMobileDevices(devices);
  }, []);

  useEffect(() => {
    if (section === 'connections') {
      void refreshMobileBridge();
    }
  }, [refreshMobileBridge, section]);

  useEffect(() => {
    if (section !== 'connections' || !mobilePairingPayload) return;
    const timer = window.setInterval(() => void refreshMobileBridge(), 1500);
    return () => window.clearInterval(timer);
  }, [mobilePairingPayload, refreshMobileBridge, section]);

  const handleStartMobilePairing = useCallback(async () => {
    setIsMobileBusy(true);
    setErrorMsg('');
    try {
      const payload = await window.mate.mobile.startPairing();
      setMobilePairingPayload(payload);
      await refreshMobileBridge();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not start mobile pairing.');
      setSaveState('error');
    } finally {
      setIsMobileBusy(false);
    }
  }, [refreshMobileBridge]);

  const handleStopMobilePairing = useCallback(async () => {
    setIsMobileBusy(true);
    try {
      setMobilePairingPayload(null);
      await window.mate.mobile.stopPairing();
      await refreshMobileBridge();
    } finally {
      setIsMobileBusy(false);
    }
  }, [refreshMobileBridge]);

  const handleApproveMobilePairing = useCallback(async (approved: boolean) => {
    setIsMobileBusy(true);
    try {
      await window.mate.mobile.approvePendingPairing(approved);
      setMobilePairingPayload(null);
      await refreshMobileBridge();
    } finally {
      setIsMobileBusy(false);
    }
  }, [refreshMobileBridge]);

  useEffect(() => {
    return window.mate.privacy.onModelDownloadProgress((progress) => {
      setPrivacyModelProgress(progress);
      setIsPrivacyModelBusy(progress.state === 'downloading' || progress.state === 'verifying');
      if (progress.state === 'ready') {
        void refreshPrivacyModelStatus();
      }
    });
  }, [refreshPrivacyModelStatus]);

  const handleDownloadPrivacyModel = useCallback(async () => {
    setIsPrivacyModelBusy(true);
    setPrivacyModelProgress({
      state: 'downloading',
      fileIndex: 0,
      fileCount: privacyModelStatus
        ? privacyModelStatus.requiredFiles.length + privacyModelStatus.externalDataFiles.length
        : 0,
      receivedBytes: 0,
      message: 'Starting MaTE X Privacy model download.',
    });
    try {
      const status = await window.mate.privacy.downloadModel();
      setPrivacyModelStatus(status);
      if (status.error) {
        setPrivacyModelProgress({
          state: 'failed',
          fileIndex: 0,
          fileCount: 0,
          receivedBytes: 0,
          message: status.error,
        });
      }
    } finally {
      setIsPrivacyModelBusy(false);
    }
  }, [privacyModelStatus]);

  const handlePrivacyCanaryScan = useCallback(async () => {
    setIsPrivacyActionBusy(true);
    try {
      const result = await window.mate.privacy.scanText(
        'OPENAI_API_KEY=sk-proj-demo-123456789\nDATABASE_URL=postgresql://user:pass@db.internal.invalid:5432/main',
      );
      setPrivacyDebugResult(result);
    } finally {
      setIsPrivacyActionBusy(false);
    }
  }, []);

  const handleClearPrivacyVault = useCallback(async () => {
    setIsPrivacyActionBusy(true);
    try {
      await window.mate.privacy.clearVault();
    } finally {
      setIsPrivacyActionBusy(false);
    }
  }, []);

  const hasKeyDraft = inputValue.trim().length > 0;
  const hasAppSettingsDraft =
    serializeAppSettings(appSettings) !== serializeAppSettings(savedAppSettings);
  const hasTrustDraft = Boolean(
    trustContract &&
      trustDraft &&
      serializeTrustContract(trustDraft) !== serializeTrustContract(trustContract),
  );
  const isBusy = isLoading || saveState === 'saving';
  const saveLabel = saveState === 'saved' ? 'Saved' : 'Save changes';
  const rainyApiKeyStatusLabel = getRainyApiKeyStatusLabel({
    hasKeyDraft,
    currentKeyPrefix,
    saveState,
  });

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

    if (section === 'workspace-memory') {
      return;
    }

    if (section === 'general' || section === 'archive' || section === 'agent-profiler' || section === 'privacy') {
      if (!hasAppSettingsDraft) {
        return;
      }

      setSaveState('saving');
      setErrorMsg('');

      try {
        const nextSettings = await updateAppSettings(appSettings);
        setAppSettings(nextSettings);
        setSavedAppSettings(nextSettings);
        applyRendererSettings(nextSettings);
        useChatStore.getState().setSettings(nextSettings);
        window.dispatchEvent(
          new CustomEvent('mate:app-settings-updated', {
            detail: nextSettings,
          }),
        );
        setSaveState('saved');
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : 'Could not save settings.');
        setSaveState('error');
      }
      return;
    }

    if (section === 'integrations') {
      if (!hasAppSettingsDraft) {
        return;
      }

      setSaveState('saving');
      setErrorMsg('');

      try {
        const nextSettings = await updateAppSettings(appSettings);
        setAppSettings(nextSettings);
        setSavedAppSettings(nextSettings);
        applyRendererSettings(nextSettings);
        useChatStore.getState().setSettings(nextSettings);
        setSaveState('saved');
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : 'Could not save integrations.');
        setSaveState('error');
      }
      return;
    }

    if (section === 'connections' && hasAppSettingsDraft) {
      setSaveState('saving');
      setErrorMsg('');
      try {
        const nextSettings = await updateAppSettings(appSettings);
        setAppSettings(nextSettings);
        setSavedAppSettings(nextSettings);
        useChatStore.getState().setSettings(nextSettings);
        setSaveState('saved');
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : 'Could not save mobile companion settings.');
        setSaveState('error');
        return;
      }
      if (!hasKeyDraft) {
        return;
      }
    }

    const trimmedKey = inputValue.trim();
    if (!trimmedKey) {
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
      setCurrentKeyPrefix(`${trimmedKey.slice(0, 7)}...`);
      setInputValue('');
      setIsEditingKey(false);
      setSaveState('saved');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not save settings.');
      setSaveState('error');
    }
  }, [appSettings, hasAppSettingsDraft, hasTrustDraft, inputValue, section, trustDraft]);

  const handleRestoreDefaults = useCallback(() => {
    if (section === 'general') {
      setAppSettings((current) => ({
        ...current,
        appearance: DEFAULT_APP_SETTINGS.appearance,
        theme: DEFAULT_APP_SETTINGS.theme,
        blurEnabled: DEFAULT_APP_SETTINGS.blurEnabled,
        vibrancyMode: DEFAULT_APP_SETTINGS.vibrancyMode,
        diffLineWrapping: DEFAULT_APP_SETTINGS.diffLineWrapping,
        assistantOutput: DEFAULT_APP_SETTINGS.assistantOutput,
        compactMode: DEFAULT_APP_SETTINGS.compactMode,
      }));
      setAppearance('system');
      setTheme('default');
      setBlurEnabled(DEFAULT_APP_SETTINGS.blurEnabled);
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
    } else if (section === 'integrations') {
      setAppSettings((current) => ({
        ...current,
        supermemoryApiKey: DEFAULT_APP_SETTINGS.supermemoryApiKey,
        githubIntegrationEnabled: DEFAULT_APP_SETTINGS.githubIntegrationEnabled,
      }));
    } else if (section === 'agent-profiler') {
      setAppSettings((current) => ({
        ...current,
        agentProfilerAutoSwitch: DEFAULT_APP_SETTINGS.agentProfilerAutoSwitch,
      }));
    } else if (section === 'privacy') {
      setAppSettings((current) => ({
        ...current,
        privacyFirewallEnabled: DEFAULT_APP_SETTINGS.privacyFirewallEnabled,
        privacyMode: DEFAULT_APP_SETTINGS.privacyMode,
        privacyUseOnnxModel: DEFAULT_APP_SETTINGS.privacyUseOnnxModel,
        privacyUseRegex: DEFAULT_APP_SETTINGS.privacyUseRegex,
        privacyBlockP0CloudSend: DEFAULT_APP_SETTINGS.privacyBlockP0CloudSend,
        privacyPlaceholderStyle: DEFAULT_APP_SETTINGS.privacyPlaceholderStyle,
        privacyMinModelConfidence: DEFAULT_APP_SETTINGS.privacyMinModelConfidence,
        privacyShowPreviewBeforeCloudSend: DEFAULT_APP_SETTINGS.privacyShowPreviewBeforeCloudSend,
      }));
    }
    setSaveState('idle');
  }, [section, setAppearance, setTheme, setBlurEnabled, trustContract]);

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
      ...(appSettings.appearance !== savedAppSettings.appearance ? ['Appearance'] : []),
      ...(appSettings.theme !== savedAppSettings.theme ? ['Theme'] : []),
      ...(appSettings.blurEnabled !== savedAppSettings.blurEnabled ? ['Interface blur'] : []),
      ...(appSettings.vibrancyMode !== savedAppSettings.vibrancyMode ? ['Transparency Mode'] : []),
      ...(appSettings.timeFormat !== savedAppSettings.timeFormat ? ['Time format'] : []),
      ...(appSettings.diffLineWrapping !== savedAppSettings.diffLineWrapping ? ['Diff line wrapping'] : []),
      ...(appSettings.assistantOutput !== savedAppSettings.assistantOutput ? ['Assistant output'] : []),
      ...(appSettings.compactMode !== savedAppSettings.compactMode ? ['Compact UI'] : []),
      ...(appSettings.archiveConfirmation !== savedAppSettings.archiveConfirmation ? ['Archive confirmation'] : []),
      ...(appSettings.deleteConfirmation !== savedAppSettings.deleteConfirmation ? ['Delete confirmation'] : []),
      ...(appSettings.supermemoryApiKey !== savedAppSettings.supermemoryApiKey ? ['Supermemory API key'] : []),
      ...(appSettings.agentProfilerAutoSwitch !== savedAppSettings.agentProfilerAutoSwitch
        ? ['Agent profiler auto-switch']
        : []),
      ...(appSettings.privacyFirewallEnabled !== savedAppSettings.privacyFirewallEnabled ? ['Privacy firewall'] : []),
      ...(appSettings.privacyMode !== savedAppSettings.privacyMode ? ['Privacy mode'] : []),
      ...(appSettings.privacyUseOnnxModel !== savedAppSettings.privacyUseOnnxModel ? ['Privacy ONNX model'] : []),
      ...(appSettings.privacyUseRegex !== savedAppSettings.privacyUseRegex ? ['Privacy regex scanner'] : []),
      ...(appSettings.privacyBlockP0CloudSend !== savedAppSettings.privacyBlockP0CloudSend
        ? ['Privacy P0 blocking']
        : []),
      ...(appSettings.privacyPlaceholderStyle !== savedAppSettings.privacyPlaceholderStyle
        ? ['Privacy placeholders']
        : []),
      ...(appSettings.privacyMinModelConfidence !== savedAppSettings.privacyMinModelConfidence
        ? ['Privacy model confidence']
        : []),
      ...(appSettings.privacyShowPreviewBeforeCloudSend !== savedAppSettings.privacyShowPreviewBeforeCloudSend
        ? ['Privacy preview']
        : []),
      ...(appSettings.codexIntegrationEnabled !== savedAppSettings.codexIntegrationEnabled ? ['Codex integration'] : []),
      ...(appSettings.antigravityIntegrationEnabled !== savedAppSettings.antigravityIntegrationEnabled
        ? ['Antigravity integration']
        : []),
      ...(appSettings.cursorIntegrationEnabled !== savedAppSettings.cursorIntegrationEnabled ? ['Cursor integration'] : []),
      ...(appSettings.githubIntegrationEnabled !== savedAppSettings.githubIntegrationEnabled ? ['GitHub integration'] : []),
      ...(appSettings.preferredAgentIntegration !== savedAppSettings.preferredAgentIntegration
        ? ['Preferred agent integration']
        : []),
      ...(hasTrustDraft ? ['Workspace trust contract'] : []),
    ],
    [
      appSettings.appearance,
      appSettings.theme,
      appSettings.blurEnabled,
      appSettings.vibrancyMode,
      appSettings.archiveConfirmation,
      appSettings.assistantOutput,
      appSettings.deleteConfirmation,
      appSettings.diffLineWrapping,
      appSettings.codexIntegrationEnabled,
      appSettings.antigravityIntegrationEnabled,
      appSettings.cursorIntegrationEnabled,
      appSettings.githubIntegrationEnabled,
      appSettings.preferredAgentIntegration,
      appSettings.timeFormat,
      appSettings.agentProfilerAutoSwitch,
      appSettings.privacyBlockP0CloudSend,
      appSettings.privacyFirewallEnabled,
      appSettings.privacyMinModelConfidence,
      appSettings.privacyMode,
      appSettings.privacyPlaceholderStyle,
      appSettings.privacyShowPreviewBeforeCloudSend,
      appSettings.privacyUseOnnxModel,
      appSettings.privacyUseRegex,
      hasTrustDraft,
      savedAppSettings.appearance,
      savedAppSettings.theme,
      savedAppSettings.blurEnabled,
      savedAppSettings.vibrancyMode,
      savedAppSettings.archiveConfirmation,
      savedAppSettings.assistantOutput,
      savedAppSettings.deleteConfirmation,
      savedAppSettings.diffLineWrapping,
      savedAppSettings.timeFormat,
      savedAppSettings.codexIntegrationEnabled,
      savedAppSettings.antigravityIntegrationEnabled,
      savedAppSettings.cursorIntegrationEnabled,
      savedAppSettings.githubIntegrationEnabled,
      savedAppSettings.preferredAgentIntegration,
      savedAppSettings.supermemoryApiKey,
      savedAppSettings.agentProfilerAutoSwitch,
      savedAppSettings.privacyBlockP0CloudSend,
      savedAppSettings.privacyFirewallEnabled,
      savedAppSettings.privacyMinModelConfidence,
      savedAppSettings.privacyMode,
      savedAppSettings.privacyPlaceholderStyle,
      savedAppSettings.privacyShowPreviewBeforeCloudSend,
      savedAppSettings.privacyUseOnnxModel,
      savedAppSettings.privacyUseRegex,
    ],
  );

  return (
    <>
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--mate-page-bg)] text-foreground">
        <header
          className={cn(
            "drag-region sticky top-0 z-10 flex h-[52px] shrink-0 items-center gap-2 px-4",
            appSettings.vibrancyMode === 'special'
              ? "mate-glass-float border-b border-border/70"
              : "bg-[var(--titlebar)] border-b border-[var(--titlebar-border)]",
            state === "collapsed" && platform === "mac" && "pl-[88px]",
            platform === "windows" && "pr-[138px]"
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-sm font-medium tracking-tight text-foreground">Settings</span>
            <span className="mate-text-metadata rounded-full bg-muted/45 px-2 py-0.5">
              {section}
            </span>
          </div>
          <div className="ms-auto no-drag">
            <Button
              size="xs"
              variant="outline"
              className="h-8 rounded-full border-border/70 bg-[var(--mate-panel-bg)] px-3 text-[12px] font-medium shadow-none backdrop-blur-md hover:bg-accent"
              onClick={handleRestoreDefaults}
              disabled={isBusy || changedSettingLabels.length === 0}
            >
              <HugeiconsIcon icon={ReloadIcon} className="size-4" />
              Restore defaults
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-transparent p-6">
          <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={section}
                initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -6 }}
                transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                className="flex flex-col gap-6"
              >
                {section === 'general' ? (
                  <SettingsSection title="General" icon={<HugeiconsIcon icon={Settings02Icon} className="size-4" />}>
                    <>
                  <SettingsRow
                    title="Appearance"
                    description="Choose how Mate X feels. System follows your OS setting."
                    control={
                      <Select
                        value={appSettings.appearance}
                        onValueChange={(value) => {
                          const appearance = value as any;
                          setAppearance(appearance);
                          setAppSettings((current) => ({ ...current, appearance }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      >
                        <SelectTrigger className="w-full sm:w-[150px]">
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
                    title="Theme"
                    description="Choose a color palette for the interface."
                    control={
                      <Select
                        value={appSettings.theme}
                        onValueChange={(value) => {
                          const theme = value as any;
                          setTheme(theme);
                          setAppSettings((current) => ({ ...current, theme }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      >
                        <SelectTrigger className="w-full sm:w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Default</SelectItem>
                          <SelectItem value="oled">OLED (True Black)</SelectItem>
                          <SelectItem value="blue">Deep Blue</SelectItem>
                          <SelectItem value="deepblue">Ocean Abyss</SelectItem>
                          <SelectItem value="deeppurple">Royal Purple</SelectItem>
                          <SelectItem value="casimiri">Casimiri</SelectItem>
                          <SelectItem value="greenspace">Green Space</SelectItem>
                          <SelectItem value="midnight">Midnight Blue</SelectItem>
                        </SelectContent>
                      </Select>
                    }
                  />
                  <SettingsRow
                    title="Interface blur"
                    description="Premium CSS glass on inputs, selects, menus, dialogs, and floating chrome. Independent of transparency mode."
                    control={
                      <Switch
                        checked={appSettings.blurEnabled}
                        onCheckedChange={(value) => {
                          setBlurEnabled(value);
                          setAppSettings((current) => ({
                            ...current,
                            blurEnabled: value,
                          }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      />
                    }
                  />
                  <SettingsRow
                    title="Transparency Mode"
                    description="Layout glass: solid chrome, sidebar glass over ambient, or floating glass chrome. Native mica/vibrancy stay off."
                    control={
                      <Select
                        value={appSettings.vibrancyMode || 'solid'}
                        onValueChange={(value) => {
                          const mode = value as VibrancyMode;
                          setAppSettings((current) => ({
                            ...current,
                            vibrancyMode: mode,
                          }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      >
                        <SelectTrigger className="w-full sm:w-[185px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="solid">Solid (Default)</SelectItem>
                          <SelectItem value="sidebar">Sidebar glass</SelectItem>
                          <SelectItem value="special">Floating glass</SelectItem>
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
                        <SelectTrigger className="w-full sm:w-[150px]">
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
                  <SettingsRow
                    title="Compact UI"
                    description="Reduce the interface width for a more focused auditing experience."
                    control={
                      <Switch
                        checked={appSettings.compactMode}
                        onCheckedChange={(value) => {
                          setAppSettings((current) => ({ ...current, compactMode: value }));
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
              <SettingsSection title="Connections" icon={<HugeiconsIcon icon={DirectionsIcon} className="size-4" />}>
                <>
                  <SettingsRow
                    title="Rainy API key"
                    description={
                      currentKeyPrefix
                        ? `Stored locally on this device. Current key ${currentKeyPrefix}.`
                        : 'Connect your Rainy account to enable live responses.'
                    }
                    control={
                      <div className="flex items-center gap-2">
                        {currentKeyPrefix && !isEditingKey ? (
                          <div className="control-surface flex min-h-10 w-full items-center rounded-xl border border-input bg-mate-control-bg px-3 text-[13px] text-muted-foreground sm:w-[220px]">
                            Saved: {currentKeyPrefix}
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
                            className="w-full sm:w-[220px]"
                            disabled={isBusy}
                          />
                        )}

                        <span
                          className={cn(
                            'rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]',
                            rainyApiKeyStatusLabel === 'Connected' || rainyApiKeyStatusLabel === 'Saved'
                              ? 'bg-emerald-500/12 text-emerald-500'
                              : 'bg-amber-500/12 text-amber-500',
                          )}
                        >
                          {rainyApiKeyStatusLabel}
                        </span>

                        {currentKeyPrefix && !isEditingKey ? (
                          <Button
                            size="xs"
                            variant="outline"
                            className="h-8 rounded-xl px-3 text-[12px] shadow-none"
                            onClick={() => {
                              setIsEditingKey(true);
                              setInputValue('');
                              setSaveState('idle');
                            }}
                            disabled={isBusy}
                          >
                            <HugeiconsIcon icon={PencilEdit01Icon} className="size-4" />
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
                        <HugeiconsIcon icon={ComputerIcon} className="size-4" />
                        {currentKeyPrefix ? 'IPC secured' : 'Waiting for key'}
                      </div>
                    }
                  />
                  <SettingsRow
                    title="Mobile Companion"
                    description="Expose a scoped local WebSocket bridge for paired devices on your LAN."
                    control={
                      <Switch
                        checked={appSettings.mobileCompanionEnabled}
                        onCheckedChange={(value) => {
                          setAppSettings((current) => ({ ...current, mobileCompanionEnabled: value }));
                          if (saveState === 'saved') setSaveState('idle');
                        }}
                        disabled={isBusy}
                      />
                    }
                  />
                  <SettingsRow
                    title="Pair mobile device"
                    description={
                      mobileStatus?.running
                         ? `Bridge listening on ${mobileStatus.host}:${mobileStatus.port}`
                        : appSettings.mobileCompanionEnabled
                          ? 'Save settings, then start pairing to show a QR code.'
                          : 'Enable Mobile Companion and save before pairing.'
                    }
                    control={
                      <div className="flex items-center gap-2">
                        <Button
                          size="xs"
                          variant="outline"
                          className="h-8 rounded-xl px-3 text-[12px] shadow-none"
                          onClick={() => void handleStartMobilePairing()}
                          disabled={isBusy || isMobileBusy || !savedAppSettings.mobileCompanionEnabled}
                        >
                          {isMobileBusy ? <HugeiconsIcon icon={Loading01Icon} className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                          Start pairing
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-8 rounded-xl px-3 text-[12px] shadow-none"
                          onClick={() => void handleStopMobilePairing()}
                          disabled={isBusy || isMobileBusy || !mobilePairingPayload}
                        >
                          Stop
                        </Button>
                      </div>
                    }
                  />
                  {mobilePairingPayload ? (
                    <div className="rounded-2xl border border-[var(--panel-border)]/40 bg-[var(--panel)]/70 p-4">
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="rounded-2xl bg-white p-3">
                          <QRCodeSVG value={JSON.stringify(mobilePairingPayload)} size={168} />
                        </div>
                        <div className="min-w-0 w-full flex-1 space-y-2 text-sm">
                          <div className="font-medium text-foreground">Scan with MaTE X Mobile</div>
                          <div className="text-xs text-muted-foreground">
                            Expires {new Date(mobilePairingPayload.expiresAt).toLocaleTimeString()}.
                            Desktop code {mobilePairingPayload.desktopPublicKey.slice(0, 6).toUpperCase()}.
                          </div>
                          <div className="break-all rounded-xl border border-[var(--panel-border)]/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                            {mobilePairingPayload.host}:{mobilePairingPayload.port}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {mobilePendingPairing ? (
                    <SettingsRow
                      title="Approve device"
                      description={`${mobilePendingPairing.deviceName} · ${mobilePendingPairing.deviceFingerprint}`}
                      control={
                        <div className="flex items-center gap-2">
                          <Button
                            size="xs"
                            className="h-8 rounded-xl px-3 text-[12px]"
                            onClick={() => void handleApproveMobilePairing(true)}
                            disabled={isBusy || isMobileBusy}
                          >
                            Approve
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            className="h-8 rounded-xl px-3 text-[12px] shadow-none"
                            onClick={() => void handleApproveMobilePairing(false)}
                            disabled={isBusy || isMobileBusy}
                          >
                            Deny
                          </Button>
                        </div>
                      }
                    />
                  ) : null}
                  {mobileDevices.length > 0 ? (
                    <SettingsRow
                      title="Paired devices"
                      description={`${mobileDevices.length} remembered device${mobileDevices.length === 1 ? '' : 's'}.`}
                      control={
                        <div className="flex w-full max-w-[360px] flex-col gap-2">
                          {mobileDevices.map((device) => (
                            <div key={device.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--panel-border)]/40 px-3 py-2 text-xs">
                              <span className="truncate">{device.deviceName}</span>
                              <Button
                                size="xs"
                                variant="ghost"
                                className="h-7 rounded-xl px-2 text-[11px]"
                                onClick={async () => {
                                  setMobileDevices(await window.mate.mobile.revokeDevice(device.id));
                                  await refreshMobileBridge();
                                }}
                              >
                                Revoke
                              </Button>
                            </div>
                          ))}
                        </div>
                      }
                    />
                  ) : null}
                </>
              </SettingsSection>
            ) : null}

            {section === 'trust' ? (
              <SettingsTrustSection
                activeWorkspaceName={activeWorkspace?.name}
                trustDraft={trustDraft}
                setTrustDraft={setTrustDraft}
              />
            ) : null}

            {section === 'privacy' ? (
              <SettingsSection title="Privacy Firewall" icon={<HugeiconsIcon icon={Shield01Icon} className="size-3.5" />}>
                <>
                  <SettingsRow
                    title="Enable Privacy Firewall"
                    description="Scan outbound cloud context locally before Rainy/model requests."
                    control={
                      <Switch
                        checked={appSettings.privacyFirewallEnabled}
                        onCheckedChange={(value) => {
                          setAppSettings((current) => ({ ...current, privacyFirewallEnabled: value }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      />
                    }
                  />
                  <SettingsRow
                    title="Mode"
                    description="Strict fails closed on cloud-send paths; review is default."
                    control={
                      <Select
                        value={appSettings.privacyMode}
                        onValueChange={(value) => {
                          setAppSettings((current) => ({ ...current, privacyMode: value as PrivacyMode }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      >
                        <SelectTrigger className="w-full sm:w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="off">Off</SelectItem>
                          <SelectItem value="warn">Warn</SelectItem>
                          <SelectItem value="review">Review</SelectItem>
                          <SelectItem value="strict">Strict</SelectItem>
                        </SelectContent>
                      </Select>
                    }
                  />
                  <SettingsRow
                    title="ONNX model"
                    description={
                      privacyModelStatus
                        ? `${privacyModelStatus.huggingFaceRepo ?? privacyModelStatus.model}: ${privacyModelStatus.loaded ? `loaded from ${privacyModelStatus.source}` : 'missing'} (${privacyModelStatus.presentFiles.length}/${privacyModelStatus.requiredFiles.length + privacyModelStatus.externalDataFiles.length})`
                        : 'Checking local model assets.'
                    }
                    status={
                      privacyModelStatus?.error ??
                      privacyModelStatus?.inferenceError ??
                      privacyModelProgress?.message ??
                      (privacyModelStatus?.missingFiles.length
                        ? `Missing: ${privacyModelStatus.missingFiles.join(', ')}`
                        : `Active: ${privacyModelStatus?.assetPath}`)
                    }
                    control={
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]',
                            privacyModelStatus?.loaded
                              ? 'bg-emerald-500/12 text-emerald-500'
                              : 'bg-amber-500/12 text-amber-500',
                          )}
                        >
                          {privacyModelStatus?.loaded ? 'Loaded' : 'Missing'}
                        </span>
                        <Button
                          size="xs"
                          variant="outline"
                          className="h-8 rounded-xl px-3 text-[12px] shadow-none"
                          onClick={() => void refreshPrivacyModelStatus()}
                          disabled={isPrivacyModelBusy}
                        >
                          <HugeiconsIcon icon={ReloadIcon} className="size-4" />
                          Refresh
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          className="h-8 rounded-xl px-3 text-[12px] shadow-none"
                          onClick={() => void handleDownloadPrivacyModel()}
                          disabled={isPrivacyModelBusy || !privacyModelStatus?.downloadUrl}
                        >
                          {isPrivacyModelBusy ? (
                            <HugeiconsIcon icon={Loading01Icon} className="size-4 animate-spin motion-reduce:animate-none" />
                          ) : (
                            <HugeiconsIcon icon={Download01Icon} className="size-4" />
                          )}
                          Download
                        </Button>
                      </div>
                    }
                  />
                  {privacyModelProgress &&
                    privacyModelProgress.state !== 'idle' &&
                    privacyModelProgress.state !== 'ready' ? (
                      <div className="border-b border-border/60 px-5 py-3">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-medium text-foreground">
                            {privacyModelProgress.state === 'failed'
                              ? 'Download failed'
                              : privacyModelProgress.state === 'verifying'
                                ? 'Installing model'
                                : `Downloading ${privacyModelProgress.file ?? 'model assets'}`}
                          </span>
                          <span className="text-muted-foreground">
                            {privacyModelProgress.percent != null
                              ? `${privacyModelProgress.percent}%`
                              : `${privacyModelProgress.fileIndex}/${privacyModelProgress.fileCount}`}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              privacyModelProgress.state === 'failed' ? 'bg-destructive' : 'bg-primary',
                            )}
                            style={{ width: `${privacyModelProgress.percent ?? 10}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                  <SettingsRow
                    title="Use ONNX scanner"
                    description="Run MaTE X Privacy v0.15 token classifier when assets are present."
                    control={
                      <Switch
                        checked={appSettings.privacyUseOnnxModel}
                        onCheckedChange={(value) => {
                          setAppSettings((current) => ({ ...current, privacyUseOnnxModel: value }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      />
                    }
                  />
                  <SettingsRow
                    title="Use deterministic scanner"
                    description="Regex and heuristic scanner for known P0 secret patterns."
                    control={
                      <Switch
                        checked={appSettings.privacyUseRegex}
                        onCheckedChange={(value) => {
                          setAppSettings((current) => ({ ...current, privacyUseRegex: value }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      />
                    }
                  />
                  <SettingsRow
                    title="Block P0 cloud sends"
                    description="Stop outbound payloads when redaction assertion fails."
                    control={
                      <Switch
                        checked={appSettings.privacyBlockP0CloudSend}
                        onCheckedChange={(value) => {
                          setAppSettings((current) => ({ ...current, privacyBlockP0CloudSend: value }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      />
                    }
                  />
                  <SettingsRow
                    title="Placeholder style"
                    description="Choose how protected values appear to cloud models."
                    control={
                      <Select
                        value={appSettings.privacyPlaceholderStyle}
                        onValueChange={(value) => {
                          setAppSettings((current) => ({
                            ...current,
                            privacyPlaceholderStyle: value as PrivacyPlaceholderStyle,
                          }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                      >
                        <SelectTrigger className="w-full sm:w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="simple">Simple</SelectItem>
                          <SelectItem value="typed">Typed</SelectItem>
                          <SelectItem value="stable">Stable</SelectItem>
                        </SelectContent>
                      </Select>
                    }
                  />
                  <SettingsRow
                    title="Minimum model confidence"
                    description="Applies to contextual ONNX labels before postprocessing."
                    control={
                      <Input
                        nativeInput
                        type="number"
                        min={0}
                        max={0.99}
                        step={0.05}
                        value={appSettings.privacyMinModelConfidence}
                        onChange={(event) => {
                          setAppSettings((current) => ({
                            ...current,
                            privacyMinModelConfidence: Number(event.target.value),
                          }));
                          if (saveState === 'saved') {
                            setSaveState('idle');
                          }
                        }}
                        className="w-full sm:w-[110px]"
                        disabled={isBusy}
                      />
                    }
                  />
                  <SettingsRow
                    title="Local scan check"
                    description={
                      privacyDebugResult
                        ? `${privacyDebugResult.stats.totalSpans} spans, ${privacyDebugResult.stats.p0Count} P0, output: ${privacyDebugResult.redactedText.replace(/\n/g, ' ')}`
                        : 'Run deterministic redaction locally without persisting plaintext.'
                    }
                    control={
                      <Button
                        size="xs"
                        variant="outline"
                        className="h-8 rounded-xl px-3 text-[12px] shadow-none"
                        onClick={() => void handlePrivacyCanaryScan()}
                        disabled={isPrivacyActionBusy}
                      >
                        {isPrivacyActionBusy ? (
                          <HugeiconsIcon icon={Loading01Icon} className="size-4 animate-spin motion-reduce:animate-none" />
                        ) : (
                          <HugeiconsIcon icon={Shield01Icon} className="size-3.5" />
                        )}
                        Scan canary
                      </Button>
                    }
                  />
                  <SettingsRow
                    title="Clear local privacy vault"
                    description="Delete encrypted original span values stored for local audit dedupe."
                    control={
                      <Button
                        size="xs"
                        variant="outline"
                        className="h-8 rounded-xl px-3 text-[12px] shadow-none"
                        onClick={() => void handleClearPrivacyVault()}
                        disabled={isPrivacyActionBusy}
                      >
                        <HugeiconsIcon icon={ReloadIcon} className="size-4" />
                        Clear vault
                      </Button>
                    }
                  />
                </>
              </SettingsSection>
            ) : null}

            {section === 'workspace-memory' ? <WorkspaceMemorySettings /> : null}

            {section === 'agent-profiler' ? (
              <AgentProfilerSettings
                activeWorkspaceId={activeWorkspaceId}
                appSettings={appSettings}
                onSettingsChange={(settings) => {
                  setAppSettings(settings);
                  if (saveState === 'saved') {
                    setSaveState('idle');
                  }
                }}
                isBusy={isBusy}
              />
            ) : null}

            {section === 'integrations' ? (
              <SettingsSection title="Integrations" icon={<HugeiconsIcon icon={PuzzleIcon} className="size-4" />}>
                <>
                  <SettingsRow
                    title="Codex"
                    description="Allow MaTE X to use Codex as an external agent integration when explicitly selected."
                    control={
                      <Switch
                        checked={appSettings.codexIntegrationEnabled}
                        onCheckedChange={(checked) =>
                          setAppSettings((current) => ({
                            ...current,
                            codexIntegrationEnabled: checked,
                            preferredAgentIntegration:
                              !checked && current.preferredAgentIntegration === 'codex'
                                ? 'none'
                                : current.preferredAgentIntegration,
                          }))
                        }
                        disabled={isBusy}
                      />
                    }
                  />
                  <SettingsRow
                    title="Antigravity"
                    description="Allow MaTE X to use Antigravity as an external agent integration when explicitly selected."
                    control={
                      <Switch
                        checked={appSettings.antigravityIntegrationEnabled}
                        onCheckedChange={(checked) =>
                          setAppSettings((current) => ({
                            ...current,
                            antigravityIntegrationEnabled: checked,
                            preferredAgentIntegration:
                              !checked && current.preferredAgentIntegration === 'antigravity'
                                ? 'none'
                                : current.preferredAgentIntegration,
                          }))
                        }
                        disabled={isBusy}
                      />
                    }
                  />
                  <SettingsRow
                    title="Cursor"
                    description="Allow MaTE X to use Cursor as an external agent integration when explicitly selected."
                    control={
                      <Switch
                        checked={appSettings.cursorIntegrationEnabled}
                        onCheckedChange={(checked) =>
                          setAppSettings((current) => ({
                            ...current,
                            cursorIntegrationEnabled: checked,
                            preferredAgentIntegration:
                              !checked && current.preferredAgentIntegration === 'cursor'
                                ? 'none'
                                : current.preferredAgentIntegration,
                          }))
                        }
                        disabled={isBusy}
                      />
                    }
                  />
                  <SettingsRow
                    title="Preferred agent"
                    description="Choose which enabled integration MaTE X should prefer. Disabled keeps local analysis first."
                    control={
                      <Select
                        value={appSettings.preferredAgentIntegration}
                        onValueChange={(value) => {
                          setAppSettings((current) => ({
                            ...current,
                            preferredAgentIntegration: value as AgentIntegrationId | 'none',
                          }));
                        }}
                        disabled={isBusy}
                      >
                        <SelectTrigger className="w-full sm:w-[220px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Disabled</SelectItem>
                          <SelectItem value="codex" disabled={!appSettings.codexIntegrationEnabled}>
                            Codex
                          </SelectItem>
                          <SelectItem value="antigravity" disabled={!appSettings.antigravityIntegrationEnabled}>
                            Antigravity
                          </SelectItem>
                          <SelectItem value="cursor" disabled={!appSettings.cursorIntegrationEnabled}>
                            Cursor
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    }
                  />
                  <SettingsRow
                    title="Supermemory"
                    description="AI context and long-term memory for your agents."
                    control={
                      <div className="flex items-center gap-2">
                        <Input
                          nativeInput
                          type="password"
                          value={appSettings.supermemoryApiKey || ''}
                          onChange={(event) => {
                            setAppSettings((current) => ({
                              ...current,
                              supermemoryApiKey: event.target.value,
                            }));
                            if (saveState === 'saved') {
                              setSaveState('idle');
                            }
                          }}
                          onKeyDown={handleKeyDown}
                          placeholder="sm-••••••••"
                          className="w-full sm:w-[220px]"
                          disabled={isBusy}
                        />
                        {appSettings.supermemoryApiKey && (
                          <span className="rounded-full bg-emerald-500/12 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-500">
                            {saveState === 'saved' ? 'Saved' : 'Configured'}
                          </span>
                        )}
                      </div>
                    }
                  />
                  <SettingsRow
                    title="GitHub"
                    description="Connect repositories and pull requests for evidence checks and PR verification."
                    status={githubStatus?.message}
                    control={
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={appSettings.githubIntegrationEnabled}
                          onCheckedChange={(checked) => {
                            setAppSettings((current) => ({
                              ...current,
                              githubIntegrationEnabled: checked,
                            }));
                            if (saveState === 'saved') {
                              setSaveState('idle');
                            }
                            void refreshGithubStatus();
                          }}
                          disabled={isBusy}
                        />
                        <span className={cn(
                          'rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]',
                          githubStatusClass(githubStatus?.state ?? (appSettings.githubIntegrationEnabled ? 'enabled_not_configured' : 'disabled')),
                        )}>
                          {githubStatusLabel(githubStatus?.state ?? (appSettings.githubIntegrationEnabled ? 'enabled_not_configured' : 'disabled'))}
                        </span>
                        <Button
                          size="xs"
                          variant="outline"
                          className="h-8 rounded-xl px-3 text-[12px] shadow-none"
                          onClick={() => void refreshGithubStatus()}
                          disabled={isBusy || isGithubStatusBusy}
                        >
                          {isGithubStatusBusy ? (
                            <HugeiconsIcon icon={Loading01Icon} className="size-4 animate-spin motion-reduce:animate-none" />
                          ) : (
                            <HugeiconsIcon icon={ComputerIcon} className="size-4" />
                          )}
                          Detect
                        </Button>
                      </div>
                    }
                  />
                </>
              </SettingsSection>
            ) : null}
 
            {section === 'archive' ? (
              <SettingsSection title="Archive" icon={<HugeiconsIcon icon={FolderOpenIcon} className="size-4" />}>
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
          </motion.div>
        </AnimatePresence>
 
        <div className="mt-4 flex items-center justify-between gap-4">
              <div className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
                {saveState === 'error' ? (
                  <span className="text-destructive-foreground">{errorMsg}</span>
                ) : section === 'connections' ? (
                  <span>
                    {hasKeyDraft
                      ? 'Pending: Rainy API key'
                      : changedSettingLabels.length > 0
                        ? `Pending: ${changedSettingLabels.join(', ')}`
                        : currentKeyPrefix
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
                ) : section === 'privacy' ? (
                  <span>
                    {changedSettingLabels.length > 0
                      ? `Pending: ${changedSettingLabels.join(', ')}`
                      : saveState === 'saved'
                        ? 'Privacy settings saved'
                        : 'Privacy settings active'}
                  </span>
                ) : section === 'agent-profiler' ? (
                  <span>
                    {changedSettingLabels.length > 0
                      ? `Pending: ${changedSettingLabels.join(', ')}`
                      : 'Profiler recommendations are ready when model runs produce metrics'}
                  </span>
                ) : (
                  <span>
                    {changedSettingLabels.length > 0
                      ? `Pending: ${changedSettingLabels.join(', ')}`
                      : 'No pending settings changes'}
                  </span>
                )}
              </div>
 
              {section === 'workspace-memory' ? null : (
                <Button
                  size="sm"
                  className="h-9 rounded-xl px-4"
                  onClick={() => void handleSave()}
                  disabled={
                    section === 'connections'
                      ? (!hasKeyDraft && !hasAppSettingsDraft) || isBusy
                      : section === 'trust'
                        ? !hasTrustDraft || isBusy
                        : !hasAppSettingsDraft || isBusy
                  }
                >
                  {isBusy ? (
                    <HugeiconsIcon icon={Loading01Icon} className="size-4 animate-spin motion-reduce:animate-none" />
                  ) : saveState === 'saved' ? (
                    <HugeiconsIcon icon={Tick01Icon} className="size-4" />
                  ) : section === 'trust' ? (
                    <HugeiconsIcon icon={ShieldKeyIcon} className="size-4" />
                  ) : section === 'general' || section === 'archive' || section === 'integrations' || section === 'agent-profiler' || section === 'privacy' ? (
                    <HugeiconsIcon icon={Settings02Icon} className="size-4" />
                  ) : (
                    <HugeiconsIcon icon={LockKeyIcon} className="size-4" />
                  )}
                  {saveLabel}
                </Button>
              )}
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
            <AlertDialogClose render={<Button size="sm" />}>Understood</AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
}

function githubStatusLabel(state: GitHubIntegrationState) {
  if (state === 'local_only') return 'Local-only';
  if (state === 'configured') return 'Configured';
  if (state === 'error') return 'Error';
  if (state === 'enabled_not_configured') return 'Not configured';
  return 'Disabled';
}

function githubStatusClass(state: GitHubIntegrationState) {
  if (state === 'configured') return 'bg-emerald-500/12 text-emerald-500';
  if (state === 'local_only') return 'bg-sky-500/12 text-sky-500';
  if (state === 'error') return 'bg-red-500/12 text-red-500';
  if (state === 'enabled_not_configured') return 'bg-amber-500/12 text-amber-500';
  return 'bg-muted/60 text-muted-foreground';
}
