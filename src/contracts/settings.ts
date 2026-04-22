export type TimeFormat = 'system' | '24h' | '12h';
export type ThemePreference = 'light' | 'dark' | 'system';

export interface AppSettings {
  theme: ThemePreference;
  timeFormat: TimeFormat;
  diffLineWrapping: boolean;
  assistantOutput: boolean;
  archiveConfirmation: boolean;
  deleteConfirmation: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  timeFormat: 'system',
  diffLineWrapping: false,
  assistantOutput: false,
  archiveConfirmation: false,
  deleteConfirmation: true,
};
