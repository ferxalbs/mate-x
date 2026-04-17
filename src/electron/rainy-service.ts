import OpenAI from 'openai';

import { MATE_AGENT_SYSTEM_PROMPT } from '../config/mate-agent';
import {
  RAINY_API_BASE_URL,
  RAINY_REQUEST_TIMEOUT_MS,
  normalizeRainyApiMode,
} from '../config/rainy';
import type { RainyApiMode, RainyModelCatalogEntry } from '../contracts/rainy';

const RAINY_BASE_URL = RAINY_API_BASE_URL.replace(/\/+$/, '');
const RAINY_MODELS_ENDPOINTS = [
  `${RAINY_BASE_URL}/api/v1/models/catalog`,
  `${RAINY_BASE_URL}/api/v1/models`,
  `${RAINY_BASE_URL}/models/catalog`,
  `${RAINY_BASE_URL}/models`,
];
const MODEL_CACHE_TTL_MS = 60_000;

let cachedCatalog:
  | {
      apiKey: string;
      expiresAt: number;
      models: RainyModelCatalogEntry[];
    }
  | null = null;

function createRainyClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: RAINY_API_BASE_URL,
  });
}

function buildChatCompletionsInput(userContext: string) {
  return [
    { role: 'system' as const, content: MATE_AGENT_SYSTEM_PROMPT },
    { role: 'user' as const, content: userContext },
  ];
}

function buildResponsesInput(userContext: string) {
  return [
    {
      role: 'system' as const,
      content: [{ type: 'input_text' as const, text: MATE_AGENT_SYSTEM_PROMPT }],
    },
    {
      role: 'user' as const,
      content: [{ type: 'input_text' as const, text: userContext }],
    },
  ];
}

export async function listRainyModels(params: {
  apiKey: string;
  forceRefresh?: boolean;
}): Promise<RainyModelCatalogEntry[]> {
  const trimmedApiKey = params.apiKey.trim();
  const now = Date.now();

  if (
    !params.forceRefresh &&
    cachedCatalog &&
    cachedCatalog.apiKey === trimmedApiKey &&
    cachedCatalog.expiresAt > now
  ) {
    return cachedCatalog.models;
  }

  let lastError: Error | null = null;

  for (const endpoint of RAINY_MODELS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${trimmedApiKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(RAINY_REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        lastError = new Error(
          `Rainy models request failed with status ${response.status} at ${new URL(endpoint).pathname}.`,
        );

        if (response.status === 404) {
          continue;
        }

        throw lastError;
      }

      const payload = (await response.json()) as unknown;
      const models = normalizeRainyModelsPayload(payload);

      cachedCatalog = {
        apiKey: trimmedApiKey,
        expiresAt: now + MODEL_CACHE_TTL_MS,
        models,
      };

      return models;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error('Rainy models request failed.');

      if (
        error instanceof Error &&
        /status 404/.test(error.message)
      ) {
        continue;
      }

      throw lastError;
    }
  }

  throw (
    lastError ??
    new Error('Rainy models request failed for all known catalog endpoints.')
  );
}

export async function validateRainyModelSelection(params: {
  apiKey: string | null;
  model: string;
}) {
  const trimmedModel = params.model.trim();

  if (!trimmedModel) {
    throw new Error('Rainy model is required.');
  }

  if (!params.apiKey) {
    return;
  }

  const catalog = await listRainyModels({ apiKey: params.apiKey });
  if (catalog.length === 0) {
    return;
  }

  if (!catalog.some((entry) => entry.id === trimmedModel)) {
    throw new Error(`Rainy model "${trimmedModel}" is not available for the current API key.`);
  }
}

export async function requestRainyTextResponse(params: {
  apiKey: string;
  userContext: string;
  model: string;
  apiMode: RainyApiMode;
}): Promise<string> {
  const client = createRainyClient(params.apiKey);

  if (params.apiMode === 'responses') {
    const response = await client.responses.create(
      {
        model: params.model,
        input: buildResponsesInput(params.userContext),
      },
      { timeout: RAINY_REQUEST_TIMEOUT_MS },
    );

    return response.output_text.trim();
  }

  const response = await client.chat.completions.create(
    {
      model: params.model,
      messages: buildChatCompletionsInput(params.userContext),
    },
    { timeout: RAINY_REQUEST_TIMEOUT_MS },
  );

  return response.choices[0]?.message?.content?.trim() ?? '';
}

function normalizeRainyModelsPayload(payload: unknown): RainyModelCatalogEntry[] {
  const items = extractModelItems(payload);
  const models = items
    .map((item) => normalizeRainyModelItem(item))
    .filter((item): item is RainyModelCatalogEntry => item !== null);

  const uniqueModels = new Map<string, RainyModelCatalogEntry>();
  for (const model of models) {
    if (!uniqueModels.has(model.id)) {
      uniqueModels.set(model.id, model);
    }
  }

  return Array.from(uniqueModels.values()).sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function extractModelItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  if (Array.isArray(payload.models)) {
    return payload.models;
  }

  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  if (isRecord(payload.data)) {
    if (Array.isArray(payload.data.models)) {
      return payload.data.models;
    }

    if (Array.isArray(payload.data.items)) {
      return payload.data.items;
    }
  }

  return [];
}

function normalizeRainyModelItem(item: unknown): RainyModelCatalogEntry | null {
  if (!isRecord(item)) {
    return null;
  }

  const id = firstString(item.id, item.model, item.slug, item.name);
  if (!id) {
    return null;
  }

  const supportedApiModes = extractSupportedApiModes(item);

  return {
    id,
    label: firstString(item.display_name, item.name, item.label, id) ?? id,
    description: firstString(item.description, item.summary),
    ownedBy: firstString(item.owned_by, item.owner, item.provider, item.vendor),
    supportedApiModes,
    preferredApiMode: extractPreferredApiMode(item, supportedApiModes),
  };
}

function extractSupportedApiModes(item: Record<string, unknown>): RainyApiMode[] {
  const detectedModes = new Set<RainyApiMode>();

  visitModelMetadata(item, (key, value) => {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes('response') ||
      normalizedKey.includes('chat') ||
      normalizedKey.includes('endpoint') ||
      normalizedKey.includes('schema') ||
      normalizedKey.includes('mode')
    ) {
      const resolvedModes = collectModesFromUnknown(value);
      for (const mode of resolvedModes) {
        detectedModes.add(mode);
      }
    }
  });

  if (detectedModes.size === 0) {
    detectedModes.add('chat_completions');
    detectedModes.add('responses');
  }

  return Array.from(detectedModes);
}

function extractPreferredApiMode(
  item: Record<string, unknown>,
  supportedApiModes: RainyApiMode[],
): RainyApiMode | null {
  const explicitMode = normalizeRainyApiMode(
    firstString(item.preferred_api_mode, item.default_api_mode, item.recommended_api_mode),
  );

  if (explicitMode && supportedApiModes.includes(explicitMode)) {
    return explicitMode;
  }

  if (supportedApiModes.length === 1) {
    return supportedApiModes[0];
  }

  return null;
}

function visitModelMetadata(
  value: unknown,
  visitor: (key: string, nextValue: unknown) => void,
  depth = 0,
) {
  if (!isRecord(value) || depth > 3) {
    return;
  }

  for (const [key, nextValue] of Object.entries(value)) {
    visitor(key, nextValue);

    if (Array.isArray(nextValue)) {
      for (const nestedValue of nextValue) {
        visitModelMetadata(nestedValue, visitor, depth + 1);
      }
      continue;
    }

    visitModelMetadata(nextValue, visitor, depth + 1);
  }
}

function collectModesFromUnknown(value: unknown): RainyApiMode[] {
  if (typeof value === 'string') {
    const normalizedMode = normalizeRainyApiMode(value);
    if (normalizedMode) {
      return [normalizedMode];
    }

    const normalizedValue = value.toLowerCase();
    const modes: RainyApiMode[] = [];
    if (normalizedValue.includes('chat/completions') || normalizedValue.includes('chat_completions')) {
      modes.push('chat_completions');
    }
    if (normalizedValue.includes('responses')) {
      modes.push('responses');
    }
    return modes;
  }

  if (typeof value === 'boolean') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectModesFromUnknown(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  const modes: RainyApiMode[] = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = normalizeRainyApiMode(key);
    if (normalizedKey && nestedValue) {
      modes.push(normalizedKey);
    }

    modes.push(...collectModesFromUnknown(nestedValue));
  }

  return modes;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
