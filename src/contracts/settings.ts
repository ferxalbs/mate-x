export type TimeFormat = 'system' | '24h' | '12h';
export type AppearancePreference = 'light' | 'dark' | 'system';
export type ThemePreference = 'default' | 'oled' | 'blue' | 'deepblue' | 'deeppurple' | 'casimiri' | 'greenspace' | 'midnight';
export type AgentTraceVersion = 'v1' | 'v2';
export type PrivacyMode = 'off' | 'warn' | 'review' | 'strict';
export type PrivacyPlaceholderStyle = 'simple' | 'typed' | 'stable';
export type AgentIntegrationId = 'codex' | 'antigravity' | 'cursor';
export type PowerMode = 'efficient' | 'balanced' | 'max';
export type AgentFirewallMode = 'strict' | 'balanced' | 'audit-only';
export type VibrancyMode = 'solid' | 'sidebar' | 'special';

export interface AppSettings {
  appearance: AppearancePreference;
  theme: ThemePreference;
  blurEnabled: boolean;
  vibrancyMode: VibrancyMode;
  timeFormat: TimeFormat;
  agentTraceVersion: AgentTraceVersion;
  agentTraceV2InlineEvents: boolean;
  diffLineWrapping: boolean;
  assistantOutput: boolean;
  compactMode: boolean;
  archiveConfirmation: boolean;
  deleteConfirmation: boolean;
  agentProfilerAutoSwitch: boolean;
  privacyFirewallEnabled: boolean;
  privacyMode: PrivacyMode;
  privacyUseOnnxModel: boolean;
  privacyUseRegex: boolean;
  privacyBlockP0CloudSend: boolean;
  privacyPlaceholderStyle: PrivacyPlaceholderStyle;
  privacyMinModelConfidence: number;
  privacyShowPreviewBeforeCloudSend: boolean;
  codexIntegrationEnabled: boolean;
  antigravityIntegrationEnabled: boolean;
  cursorIntegrationEnabled: boolean;
  githubIntegrationEnabled: boolean;
  preferredAgentIntegration: AgentIntegrationId | 'none';
  mobileCompanionEnabled: boolean;
  mobileCompanionRequireApproval: boolean;
  mobileCompanionAllowGitWrite: boolean;
  mobileCompanionAllowPush: boolean;
  mobileCompanionSessionTtlHours: number;
  mobileCompanionPrivateLanOnly: boolean;
  powerMode: PowerMode;
  agentFirewallMode: AgentFirewallMode;
  supermemoryApiKey?: string;
  onboardingCompleted: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appearance: 'dark',
  theme: 'midnight',
  blurEnabled: false,
  vibrancyMode: 'solid',
  timeFormat: 'system',
  agentTraceVersion: 'v2',
  agentTraceV2InlineEvents: true,
  diffLineWrapping: true,
  assistantOutput: true,
  compactMode: true,
  archiveConfirmation: true,
  deleteConfirmation: true,
  agentProfilerAutoSwitch: false,
  privacyFirewallEnabled: true,
  privacyMode: 'review',
  privacyUseOnnxModel: true,
  privacyUseRegex: true,
  privacyBlockP0CloudSend: true,
  privacyPlaceholderStyle: 'typed',
  privacyMinModelConfidence: 0.5,
  privacyShowPreviewBeforeCloudSend: true,
  codexIntegrationEnabled: false,
  antigravityIntegrationEnabled: false,
  cursorIntegrationEnabled: false,
  githubIntegrationEnabled: false,
  preferredAgentIntegration: 'none',
  mobileCompanionEnabled: false,
  mobileCompanionRequireApproval: true,
  mobileCompanionAllowGitWrite: false,
  mobileCompanionAllowPush: false,
  mobileCompanionSessionTtlHours: 24,
  mobileCompanionPrivateLanOnly: true,
  powerMode: 'efficient',
  agentFirewallMode: 'strict',
  supermemoryApiKey: '',
  onboardingCompleted: false,
};
