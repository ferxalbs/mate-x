export const RAINY_API_BASE_URL =
  'https://rainy-api-v3-us-179843975974.us-east4.run.app';
export const RAINY_REQUEST_TIMEOUT_MS = 20_000;
export const RAINY_ENV_MODEL = process.env.RAINY_MODEL?.trim() || null;

export type RainyApiMode = 'chat_completions' | 'responses';

const GPT5_MODEL_PREFIXES = ['gpt-5', 'gpt5'];

export function resolveRainyApiMode(model: string): RainyApiMode {
  const normalizedModel = model.trim().toLowerCase();

  return GPT5_MODEL_PREFIXES.some((prefix) => normalizedModel.startsWith(prefix))
    ? 'responses'
    : 'chat_completions';
}

export function resolveConfiguredRainyModel(storedModel: string | null | undefined) {
  const normalizedStoredModel = storedModel?.trim();
  if (normalizedStoredModel) {
    return normalizedStoredModel;
  }

  return RAINY_ENV_MODEL;
}
