export type TimeFormat = 'system' | '24h' | '12h';
export type ThemePreference = 'light' | 'dark' | 'system';
export type AgentTraceVersion = 'v1' | 'v2';

export interface AppSettings {
  theme: ThemePreference;
  timeFormat: TimeFormat;
  agentTraceVersion: AgentTraceVersion;
  agentTraceV2InlineEvents: boolean;
  diffLineWrapping: boolean;
  assistantOutput: boolean;
  archiveConfirmation: boolean;
  deleteConfirmation: boolean;
  supermemoryApiKey?: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  timeFormat: 'system',
  agentTraceVersion: 'v2',
  agentTraceV2InlineEvents: false,
  diffLineWrapping: false,
  assistantOutput: false,
  archiveConfirmation: false,
  deleteConfirmation: true,
  supermemoryApiKey: '',
};
