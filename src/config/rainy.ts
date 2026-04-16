export const RAINY_API_BASE_URL = 'https://api.rainy.dev/v3';
export const RAINY_DEFAULT_MODEL = process.env.RAINY_MODEL ?? 'rainy-coder-security';
export const RAINY_REQUEST_TIMEOUT_MS = 20_000;

export type RainyApiMode = 'chat_completions' | 'responses';

const GPT5_MODEL_PREFIXES = ['gpt-5', 'gpt5'];

export function resolveRainyApiMode(model: string): RainyApiMode {
  const normalizedModel = model.trim().toLowerCase();

  return GPT5_MODEL_PREFIXES.some((prefix) => normalizedModel.startsWith(prefix))
    ? 'responses'
    : 'chat_completions';
}

