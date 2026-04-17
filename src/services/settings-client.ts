import type { SettingsApi } from '../contracts/ipc';
import type { RainyModelCatalogEntry } from '../contracts/rainy';

function getSettingsApi(): SettingsApi {
  if (!window.mate?.settings) {
    throw new Error('Mate settings API is not available in the renderer.');
  }
  return window.mate.settings;
}

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
