export type TimeFormat = 'system' | '24h' | '12h';
export type AppearancePreference = 'light' | 'dark' | 'system';
export type ThemePreference = 'default' | 'oled' | 'blue' | 'deepblue' | 'deeppurple' | 'casimiri' | 'greenspace' | 'midnight';
export type AgentTraceVersion = 'v1' | 'v2';
export type PrivacyMode = 'off' | 'warn' | 'review' | 'strict';
export type PrivacyPlaceholderStyle = 'simple' | 'typed' | 'stable';

export interface AppSettings {
  appearance: AppearancePreference;
  theme: ThemePreference;
  blurEnabled: boolean;
  timeFormat: TimeFormat;
  agentTraceVersion: AgentTraceVersion;
  agentTraceV2InlineEvents: boolean;
  diffLineWrapping: boolean;
  assistantOutput: boolean;
  compactMode: boolean;
  floatingInput: boolean;
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
  supermemoryApiKey?: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appearance: 'system',
  theme: 'default',
  blurEnabled: true,
  timeFormat: 'system',
  agentTraceVersion: 'v2',
  agentTraceV2InlineEvents: false,
  diffLineWrapping: false,
  assistantOutput: false,
  compactMode: true,
  floatingInput: true,
  archiveConfirmation: false,
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
  supermemoryApiKey: '',
};
