import type { SettingsApi } from '../contracts/ipc';

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

export function clearApiKey() {
  return getSettingsApi().clearApiKey();
}

export function getModel() {
  return getSettingsApi().getModel();
}

export function setModel(model: string) {
  return getSettingsApi().setModel(model);
}

export function clearModel() {
  return getSettingsApi().clearModel();
}
