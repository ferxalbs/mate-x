import type { RainyApiMode } from '../contracts/rainy';

export interface RainyPrivateRuntimeConfig {
  endpoint: string;
  apiKey: string;
}

export function resolveRainyApiBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.RAINY_API_BASE_URL?.trim();
  if (!configured) {
    throw new Error('RAINY_API_BASE_URL is required for Rainy connectivity.');
  }

  let endpoint: URL;
  try {
    endpoint = new URL(configured);
  } catch {
    throw new Error('RAINY_API_BASE_URL must be a valid HTTPS URL.');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('RAINY_API_BASE_URL must be a credential-free HTTPS URL.');
  }
  return endpoint.toString().replace(/\/+$/, '');
}

export function resolveRainyPrivateRuntimeConfig(input: {
  env?: NodeJS.ProcessEnv;
  storedApiKey?: string | null;
}): RainyPrivateRuntimeConfig {
  const env = input.env ?? process.env;
  const apiKey =
    input.storedApiKey?.trim() ||
    env.RAINY_API_KEY?.trim() ||
    env.MATE_X_RAINY_API_KEY?.trim() ||
    '';
  if (!apiKey) {
    throw new Error('Rainy API credential is required for Rainy connectivity.');
  }
  return {
    endpoint: resolveRainyApiBaseUrl(env),
    apiKey,
  };
}
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
