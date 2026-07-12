/**
 * Canonical runtime validation for IPC-facing AssistantRunOptions.
 *
 * Single source of truth for the allowlist and field rules used by
 * `repo:run-assistant` (and any other IPC surface that accepts assistant options).
 * Keep pathKind / engineeringTaskId as MaTE-internal routing metadata — never
 * copy them into Rainy/provider HTTP request bodies unless an adapter opts in.
 */

import type {
  AssistantAccess,
  AssistantAttachment,
  AssistantAttachmentKind,
  AssistantReasoningLevel,
  AssistantRunbookId,
  AssistantRunOptions,
  EngineeringPathKind,
} from "./chat";
import { isEngineeringTaskId, PATH_KINDS } from "./engineering-task";
import type { RainyServiceTier } from "./rainy";
import type { AgentActionRequest, AgentId } from "./sdk-orchestrator.types";

export const ASSISTANT_RUN_OPTION_KEYS = [
  "reasoningEnabled",
  "reasoning",
  "pathKind",
  "access",
  "serviceTier",
  "runbookId",
  "attachments",
  "sdkAction",
  "engineeringTaskId",
] as const;

const ASSISTANT_RUN_OPTION_KEY_SET = new Set<string>(ASSISTANT_RUN_OPTION_KEYS);

/** MaTE-internal routing fields — not Rainy/provider request body keys. */
export const ASSISTANT_INTERNAL_ROUTING_FIELDS = [
  "pathKind",
  "engineeringTaskId",
  "sdkAction",
] as const;

const PATH_KIND_SET = new Set<string>(PATH_KINDS);
const ACCESS_SET = new Set<AssistantAccess>(["approval", "full"]);
const SERVICE_TIER_SET = new Set<RainyServiceTier>([
  "standard",
  "flex",
  "priority",
  "scale",
]);
const RUNBOOK_ID_SET = new Set<AssistantRunbookId>([
  "patch_test_verify",
  "audit_reproduce_remediate",
  "review_classify_summarize",
  "scan_contain_report",
]);
const ATTACHMENT_KIND_SET = new Set<AssistantAttachmentKind>([
  "image",
  "video",
  "file",
]);
const AGENT_ID_SET = new Set<AgentId>(["codex", "cursor", "antigravity"]);
const SDK_ACTION_KEYS = new Set([
  "actionType",
  "payload",
  "agentId",
  "allowHighImpact",
]);
const ATTACHMENT_KEYS = new Set([
  "id",
  "name",
  "mimeType",
  "size",
  "kind",
  "dataUrl",
  "text",
]);

const MAX_REASONING_LENGTH = 80;
const MAX_ENGINEERING_TASK_ID_LENGTH = 128;
const MAX_SDK_ACTION_TYPE_LENGTH = 120;
const MAX_ATTACHMENTS = 12;
const MAX_ATTACHMENT_ID_LENGTH = 200;
const MAX_ATTACHMENT_NAME_LENGTH = 500;
const MAX_ATTACHMENT_MIME_LENGTH = 200;
const MAX_ATTACHMENT_DATA_URL_LENGTH = 10_000_000;
const MAX_ATTACHMENT_TEXT_LENGTH = 200_000;

function assertPlainRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
) {
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `${label} contains unsupported field(s): ${unknownKeys.join(", ")}.`,
    );
  }
}

function requireBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  if (value.length > maxLength) {
    throw new Error(`${label} exceeds ${maxLength} characters.`);
  }
  return value;
}

function optionalBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireBoundedString(value, label, maxLength);
}

function validatePathKind(value: unknown): EngineeringPathKind {
  if (typeof value !== "string" || !PATH_KIND_SET.has(value)) {
    throw new Error(
      `Assistant options pathKind must be one of: ${PATH_KINDS.join(", ")}.`,
    );
  }
  return value as EngineeringPathKind;
}

function validateEngineeringTaskId(
  value: unknown,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const id = requireBoundedString(
    value,
    "engineeringTaskId",
    MAX_ENGINEERING_TASK_ID_LENGTH,
  );
  if (!isEngineeringTaskId(id)) {
    throw new Error(
      'engineeringTaskId must be a canonical task id (prefix "etask_").',
    );
  }
  return id;
}

/**
 * Dedicated runtime contract for AgentActionRequest.
 * Never blindly cast arbitrary IPC input to sdkAction.
 */
export function validateAgentActionRequest(
  value: unknown,
  label = "sdkAction",
): AgentActionRequest {
  const record = assertPlainRecord(value, label);
  assertKnownKeys(record, SDK_ACTION_KEYS, label);

  const actionType = requireBoundedString(
    record.actionType,
    `${label}.actionType`,
    MAX_SDK_ACTION_TYPE_LENGTH,
  ).trim();
  if (!actionType) {
    throw new Error(`${label}.actionType must be a non-empty string.`);
  }

  if (!("payload" in record)) {
    throw new Error(`${label}.payload is required.`);
  }

  let agentId: AgentId | undefined;
  if (record.agentId !== undefined) {
    if (typeof record.agentId !== "string" || !AGENT_ID_SET.has(record.agentId as AgentId)) {
      throw new Error(
        `${label}.agentId must be one of: codex, cursor, antigravity.`,
      );
    }
    agentId = record.agentId as AgentId;
  }

  let allowHighImpact: boolean | undefined;
  if (record.allowHighImpact !== undefined) {
    if (typeof record.allowHighImpact !== "boolean") {
      throw new Error(`${label}.allowHighImpact must be a boolean.`);
    }
    allowHighImpact = record.allowHighImpact;
  }

  return {
    actionType,
    payload: record.payload,
    ...(agentId !== undefined ? { agentId } : {}),
    ...(allowHighImpact !== undefined ? { allowHighImpact } : {}),
  };
}

function validateAttachment(
  value: unknown,
  index: number,
): AssistantAttachment {
  const label = `attachments[${index}]`;
  const item = assertPlainRecord(value, label);
  assertKnownKeys(item, ATTACHMENT_KEYS, label);

  const kind = requireBoundedString(item.kind, `${label}.kind`, 40);
  if (!ATTACHMENT_KIND_SET.has(kind as AssistantAttachmentKind)) {
    throw new Error(
      `${label}.kind must be one of: image, video, file.`,
    );
  }

  if (typeof item.size !== "number" || !Number.isFinite(item.size) || item.size < 0) {
    throw new Error(`${label}.size must be a non-negative number.`);
  }

  return {
    id: requireBoundedString(item.id, `${label}.id`, MAX_ATTACHMENT_ID_LENGTH),
    name: requireBoundedString(
      item.name,
      `${label}.name`,
      MAX_ATTACHMENT_NAME_LENGTH,
    ),
    mimeType: requireBoundedString(
      item.mimeType,
      `${label}.mimeType`,
      MAX_ATTACHMENT_MIME_LENGTH,
    ),
    size: item.size,
    kind: kind as AssistantAttachmentKind,
    dataUrl: optionalBoundedString(
      item.dataUrl,
      `${label}.dataUrl`,
      MAX_ATTACHMENT_DATA_URL_LENGTH,
    ),
    text: optionalBoundedString(
      item.text,
      `${label}.text`,
      MAX_ATTACHMENT_TEXT_LENGTH,
    ),
  };
}

/**
 * Strict runtime parse of IPC-facing assistant options.
 * Returns undefined when options are omitted; otherwise fails closed on
 * unknown keys, legacy `mode`, and invalid field values.
 */
export function validateAssistantRunOptions(
  options: unknown,
): AssistantRunOptions | undefined {
  if (options === undefined || options === null) return undefined;

  const record = assertPlainRecord(options, "Assistant options");
  assertKnownKeys(record, ASSISTANT_RUN_OPTION_KEY_SET, "Assistant options");

  const result: Partial<AssistantRunOptions> = {};

  if (record.reasoningEnabled !== undefined) {
    if (typeof record.reasoningEnabled !== "boolean") {
      throw new Error("Assistant options reasoningEnabled must be a boolean.");
    }
    result.reasoningEnabled = record.reasoningEnabled;
  }

  if (record.reasoning !== undefined) {
    const reasoning = requireBoundedString(
      record.reasoning,
      "reasoning",
      MAX_REASONING_LENGTH,
    ).trim();
    if (!reasoning) {
      throw new Error("Assistant options reasoning must be a non-empty string.");
    }
    result.reasoning = reasoning as AssistantReasoningLevel;
  }

  if (record.pathKind !== undefined) {
    result.pathKind = validatePathKind(record.pathKind);
  }

  if (record.access !== undefined) {
    if (typeof record.access !== "string" || !ACCESS_SET.has(record.access as AssistantAccess)) {
      throw new Error('Assistant options access must be "approval" or "full".');
    }
    result.access = record.access as AssistantAccess;
  }

  if (record.serviceTier !== undefined) {
    if (
      typeof record.serviceTier !== "string" ||
      !SERVICE_TIER_SET.has(record.serviceTier as RainyServiceTier)
    ) {
      throw new Error(
        'Assistant options serviceTier must be "standard", "flex", "priority", or "scale".',
      );
    }
    result.serviceTier = record.serviceTier as RainyServiceTier;
  }

  if (record.runbookId !== undefined) {
    if (
      typeof record.runbookId !== "string" ||
      !RUNBOOK_ID_SET.has(record.runbookId as AssistantRunbookId)
    ) {
      throw new Error("Assistant options runbookId is not a supported runbook.");
    }
    result.runbookId = record.runbookId as AssistantRunbookId;
  }

  if (record.attachments !== undefined) {
    if (!Array.isArray(record.attachments) || record.attachments.length > MAX_ATTACHMENTS) {
      throw new Error(
        `Assistant attachments must contain at most ${MAX_ATTACHMENTS} items.`,
      );
    }
    result.attachments = record.attachments.map((item, index) =>
      validateAttachment(item, index),
    );
  }

  if (record.sdkAction !== undefined) {
    result.sdkAction = validateAgentActionRequest(record.sdkAction, "sdkAction");
  }

  if (record.engineeringTaskId !== undefined) {
    result.engineeringTaskId = validateEngineeringTaskId(record.engineeringTaskId);
  }

  // IPC may send partial options; resolveAssistantRunOptions fills defaults.
  return result as AssistantRunOptions;
}

/**
 * Provider-facing request fields derived from assistant options.
 * Explicitly excludes MaTE-internal routing metadata (pathKind, engineeringTaskId, sdkAction).
 */
export function toProviderFacingAssistantFields(
  options: AssistantRunOptions,
): {
  reasoningEnabled: boolean;
  reasoning: AssistantReasoningLevel;
  serviceTier?: RainyServiceTier;
} {
  return {
    reasoningEnabled: options.reasoningEnabled,
    reasoning: options.reasoning,
    ...(options.serviceTier !== undefined
      ? { serviceTier: options.serviceTier }
      : {}),
  };
}

/** Assert a provider HTTP body does not carry internal MaTE routing fields. */
export function assertProviderPayloadHasNoInternalRoutingFields(
  payload: Record<string, unknown>,
  label = "Provider payload",
): void {
  const leaked = ASSISTANT_INTERNAL_ROUTING_FIELDS.filter((key) => key in payload);
  if (leaked.length > 0) {
    throw new Error(
      `${label} must not include internal routing field(s): ${leaked.join(", ")}.`,
    );
  }
  if ("mode" in payload) {
    throw new Error(`${label} must not include legacy mode field.`);
  }
}

// Re-export path kinds for callers that need the canonical list without
// importing the full engineering-task module surface.
export { PATH_KINDS as ENGINEERING_PATH_KINDS };
