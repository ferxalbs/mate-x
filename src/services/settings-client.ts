import type { SettingsApi } from '../contracts/ipc';
import type { RainyModelCatalogEntry } from '../contracts/rainy';
import type { AppSettings, TimeFormat } from '../contracts/settings';

function getSettingsApi(): SettingsApi {
  if (!window.mate?.settings) {
    throw new Error('Mate settings API is not available in the renderer.');
  }
  return window.mate.settings;
}

export const TIME_FORMAT_STORAGE_KEY = 'mate-x:time-format';
export const THEME_STORAGE_KEY = 'mate-x:theme';

export function getApiKey() {
  return getSettingsApi().getApiKey();
}

export function setApiKey(apiKey: string) {
  return getSettingsApi().setApiKey(apiKey);
}

export function listModels(forceRefresh?: boolean): Promise<RainyModelCatalogEntry[]> {
  return getSettingsApi().listModels(forceRefresh);
}

export function getModel() {
  return getSettingsApi().getModel();
}

export function setModel(model: string) {
  return getSettingsApi().setModel(model);
}

export function getAppSettings() {
  return getSettingsApi().getAppSettings();
}

export function updateAppSettings(settings: AppSettings) {
  return getSettingsApi().updateAppSettings(settings);
}

export function applyRendererSettings(settings: AppSettings) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(THEME_STORAGE_KEY, settings.theme);
  window.localStorage.setItem(TIME_FORMAT_STORAGE_KEY, settings.timeFormat);
}

export function getStoredTimeFormat(): TimeFormat {
  if (typeof window === 'undefined') {
    return 'system';
  }
  const value = window.localStorage.getItem(TIME_FORMAT_STORAGE_KEY);
  if (value === '12h' || value === '24h' || value === 'system') {
    return value;
  }
  return 'system';
}
