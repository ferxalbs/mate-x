import OpenAI from "openai";

import { MATE_AGENT_SYSTEM_PROMPT } from "../config/mate-agent";
import {
  RAINY_API_BASE_URL,
  RAINY_REQUEST_TIMEOUT_MS,
  normalizeRainyApiMode,
} from "../config/rainy";
import type { RainyApiMode, RainyModelCatalogEntry } from "../contracts/rainy";

const RAINY_BASE_URL = RAINY_API_BASE_URL.replace(/\/+$/, "");
const RAINY_API_ROOT_URL = RAINY_BASE_URL.endsWith("/api/v1")
  ? RAINY_BASE_URL
  : `${RAINY_BASE_URL}/api/v1`;
const RAINY_CATALOG_ENDPOINTS = [
  `${RAINY_API_ROOT_URL}/models/catalog`,
  `${RAINY_BASE_URL}/models/catalog`,
];
const RAINY_MODELS_ENDPOINTS = [
  `${RAINY_API_ROOT_URL}/models`,
  `${RAINY_BASE_URL}/models`,
];
const MODEL_CACHE_TTL_MS = 60_000;

let cachedCatalog: {
  cacheKey: string;
  expiresAt: number;
  models: RainyModelCatalogEntry[];
} | null = null;

function createRainyClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: RAINY_API_ROOT_URL,
  });
}

function buildChatCompletionsInput(userContext: string) {
  return [
    { role: "system" as const, content: MATE_AGENT_SYSTEM_PROMPT },
    { role: "user" as const, content: userContext },
  ];
}

function buildResponsesInput(userContext: string) {
  return [
    {
      role: "system" as const,
      content: [
        { type: "input_text" as const, text: MATE_AGENT_SYSTEM_PROMPT },
      ],
    },
    {
      role: "user" as const,
      content: [{ type: "input_text" as const, text: userContext }],
    },
  ];
}

export async function listRainyModels(params: {
  apiKey?: string | null;
  forceRefresh?: boolean;
}): Promise<RainyModelCatalogEntry[]> {
  const trimmedApiKey = params.apiKey?.trim() || null;
  const cacheKey = trimmedApiKey ?? "__public__";
  const now = Date.now();

  if (
    !params.forceRefresh &&
    cachedCatalog &&
    cachedCatalog.cacheKey === cacheKey &&
    cachedCatalog.expiresAt > now
  ) {
    return cachedCatalog.models;
  }

  const [catalogModels, publicModels] = await Promise.all([
    requestRainyModelList(RAINY_CATALOG_ENDPOINTS, trimmedApiKey),
    requestRainyModelList(RAINY_MODELS_ENDPOINTS, trimmedApiKey),
  ]);

  // `/models` has historically been the most complete source. Catalog may enrich it,
  // but it must not suppress providers if the backend returns only a partial allowlist.
  const models = mergeRainyModels(publicModels.models, catalogModels.models);

  if (models.length === 0) {
    if (catalogModels.error) {
      throw catalogModels.error;
    }

    if (publicModels.error) {
      throw publicModels.error;
    }
  }

  cachedCatalog = {
    cacheKey,
    expiresAt: now + MODEL_CACHE_TTL_MS,
    models,
  };

  return models;
}

export async function validateRainyModelSelection(params: {
  apiKey: string | null;
  model: string;
}) {
  const trimmedModel = params.model.trim();

  if (!trimmedModel) {
    throw new Error("Rainy model is required.");
  }

  if (!params.apiKey) {
    return;
  }

  const catalog = await listRainyModels({
    apiKey: params.apiKey,
    forceRefresh: true,
  });
  if (catalog.length === 0) {
    return;
  }

  if (!catalog.some((entry) => entry.id === trimmedModel)) {
    throw new Error(
      `Rainy model "${trimmedModel}" is not available for the current API key.`,
    );
  }
}

function buildModelsRequestHeaders(apiKey: string | null) {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

async function requestRainyModelList(
  endpoints: string[],
  apiKey: string | null,
): Promise<{ models: RainyModelCatalogEntry[]; error: Error | null }> {
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: buildModelsRequestHeaders(apiKey),
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
      return {
        models: normalizeRainyModelsPayload(payload),
        error: null,
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("Rainy models request failed.");

      if (error instanceof Error && /status 404/.test(error.message)) {
        continue;
      }

      return {
        models: [],
        error: lastError,
      };
    }
  }

  return {
    models: [],
    error:
      lastError ??
      new Error("Rainy models request failed for all known catalog endpoints."),
  };
}

function mergeRainyModels(
  primaryModels: RainyModelCatalogEntry[],
  secondaryModels: RainyModelCatalogEntry[],
) {
  const mergedModels = new Map<string, RainyModelCatalogEntry>();

  for (const model of primaryModels) {
    mergedModels.set(model.id, model);
  }

  for (const model of secondaryModels) {
    const existing = mergedModels.get(model.id);

    if (!existing) {
      mergedModels.set(model.id, model);
      continue;
    }

    mergedModels.set(model.id, {
      ...existing,
      label: existing.label === existing.id ? model.label : existing.label,
      description: existing.description ?? model.description,
      ownedBy: existing.ownedBy ?? model.ownedBy,
      supportedApiModes: Array.from(
        new Set([...existing.supportedApiModes, ...model.supportedApiModes]),
      ),
      preferredApiMode: existing.preferredApiMode ?? model.preferredApiMode,
    });
  }

  return Array.from(mergedModels.values()).sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

export async function requestRainyTextResponse(params: {
  apiKey: string;
  userContext: string;
  model: string;
  apiMode: RainyApiMode;
}): Promise<string> {
  const client = createRainyClient(params.apiKey);

  if (params.apiMode === "responses") {
    const response = await client.responses.create(
      {
        model: params.model,
        input: buildResponsesInput(params.userContext),
      },
      { timeout: RAINY_REQUEST_TIMEOUT_MS },
    );

    return extractTextFromResponsesPayload(response);
  }

  const response = await client.chat.completions.create(
    {
      model: params.model,
      messages: buildChatCompletionsInput(params.userContext),
    },
    { timeout: RAINY_REQUEST_TIMEOUT_MS },
  );

  return extractTextFromChatPayload(response);
}

function normalizeRainyModelsPayload(
  payload: unknown,
): RainyModelCatalogEntry[] {
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
    if (Array.isArray(payload.data.data)) {
      return payload.data.data;
    }

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

function extractSupportedApiModes(
  item: Record<string, unknown>,
): RainyApiMode[] {
  const detectedModes = new Set<RainyApiMode>();

  visitModelMetadata(item, (key, value) => {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes("response") ||
      normalizedKey.includes("chat") ||
      normalizedKey.includes("endpoint") ||
      normalizedKey.includes("schema") ||
      normalizedKey.includes("mode")
    ) {
      const resolvedModes = collectModesFromUnknown(value);
      for (const mode of resolvedModes) {
        detectedModes.add(mode);
      }
    }
  });

  if (detectedModes.size === 0) {
    detectedModes.add("chat_completions");
    detectedModes.add("responses");
  }

  return Array.from(detectedModes);
}

function extractPreferredApiMode(
  item: Record<string, unknown>,
  supportedApiModes: RainyApiMode[],
): RainyApiMode | null {
  const explicitMode = normalizeRainyApiMode(
    firstString(
      item.preferred_api_mode,
      item.default_api_mode,
      item.recommended_api_mode,
    ),
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
  if (typeof value === "string") {
    const normalizedMode = normalizeRainyApiMode(value);
    if (normalizedMode) {
      return [normalizedMode];
    }

    const normalizedValue = value.toLowerCase();
    const modes: RainyApiMode[] = [];
    if (
      normalizedValue.includes("chat/completions") ||
      normalizedValue.includes("chat_completions")
    ) {
      modes.push("chat_completions");
    }
    if (normalizedValue.includes("responses")) {
      modes.push("responses");
    }
    return modes;
  }

  if (typeof value === "boolean") {
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
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractTextFromChatPayload(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    return "";
  }

  for (const choice of response.choices) {
    if (!isRecord(choice) || !isRecord(choice.message)) {
      continue;
    }

    const content = choice.message.content;
    const text = extractTextFromMessageContent(content);
    if (text) {
      return text;
    }
  }

  return "";
}

function extractTextFromResponsesPayload(response: unknown): string {
  if (!isRecord(response)) {
    return "";
  }

  const directOutputText = firstString(response.output_text);
  if (directOutputText) {
    return directOutputText;
  }

  if (!Array.isArray(response.output)) {
    return "";
  }

  const chunks: string[] = [];
  for (const outputItem of response.output) {
    if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) {
      continue;
    }

    for (const contentItem of outputItem.content) {
      if (!isRecord(contentItem)) {
        continue;
      }

      if (contentItem.type === "output_text" || contentItem.type === "text") {
        const text = firstString(contentItem.text);
        if (text) {
          chunks.push(text);
        }
      }
    }
  }

  return chunks.join("\n").trim();
}

function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const chunks: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }

    if (item.type === "text") {
      const text = firstString(item.text);
      if (text) {
        chunks.push(text);
      }
      continue;
    }

    if (isRecord(item.text)) {
      const nestedText = firstString(item.text.value);
      if (nestedText) {
        chunks.push(nestedText);
      }
    }
  }

  return chunks.join("\n").trim();
}
