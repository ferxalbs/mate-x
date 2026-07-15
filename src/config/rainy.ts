import type { RainyApiMode } from '../contracts/rainy';

export const RAINY_API_BASE_URL =
  'https://rainy-api-v3-us-160298401329.us-east4.run.app';
/** Default for catalog/list/embeddings and short text calls. */
export const RAINY_REQUEST_TIMEOUT_MS = 20_000;
/** Agent tool-loop model generations (reasoning + multi-tool planning). */
export const RAINY_AGENT_REQUEST_TIMEOUT_MS = 90_000;
/** High-reasoning agent passes. */
export const RAINY_AGENT_XHIGH_REQUEST_TIMEOUT_MS = 120_000;
export const RAINY_ENV_MODEL = process.env.RAINY_MODEL?.trim() || null;
export const RAINY_ENV_API_MODE = normalizeRainyApiMode(process.env.RAINY_API_MODE);

export type { RainyApiMode } from '../contracts/rainy';

export function resolveConfiguredRainyModel(storedModel: string | null | undefined) {
  const normalizedStoredModel = storedModel?.trim();
  if (normalizedStoredModel) {
    return normalizedStoredModel;
  }

  return RAINY_ENV_MODEL;
}

export function normalizeRainyApiMode(
  value: string | null | undefined,
): RainyApiMode | null {
  const normalizedValue = value?.trim().toLowerCase();

  if (normalizedValue === 'chat_completions' || normalizedValue === 'responses') {
    return normalizedValue;
  }

  return null;
}

export function resolveConfiguredRainyApiMode(
  storedMode: string | null | undefined,
): RainyApiMode {
  return normalizeRainyApiMode(storedMode) ?? RAINY_ENV_API_MODE ?? 'chat_completions';
}
