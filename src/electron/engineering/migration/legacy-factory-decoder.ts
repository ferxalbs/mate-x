/**
 * Migration-only decoder for historical Factory records → EngineeringTask input.
 * Not imported by normal runtime orchestration.
 * Does not calculate readiness. Does not write new Factory records.
 */

import type {
  CanonicalEngineeringTaskMigrationInput,
  LegacyFactoryRun,
  LegacyAssistantModeAlias,
} from './legacy-factory-types';

export function isLegacyFactoryRun(value: unknown): value is LegacyFactoryRun {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.prompt === 'string' &&
    Array.isArray(v.stages) &&
    typeof v.createdAt === 'string'
  );
}

/**
 * Decode a legacy Factory-shaped record into canonical migration input.
 * Malformed records return null (fail safe — never invent readiness).
 */
export function decodeLegacyFactoryToMigrationInput(input: {
  workspaceId: string;
  conversationId?: string | null;
  factoryRun: unknown;
  nowIso?: string;
}): CanonicalEngineeringTaskMigrationInput | null {
  if (!isLegacyFactoryRun(input.factoryRun)) {
    return null;
  }
  const run = input.factoryRun;
  const prompt = run.prompt?.trim();
  if (!prompt) return null;

  return {
    workspaceId: input.workspaceId,
    objectiveSeed: prompt,
    conversationId: input.conversationId ?? null,
    pathKind: inferPathKindFromLegacyMode(run.mode),
    legacyFactoryRunId: run.id,
    migratedAt: input.nowIso ?? new Date().toISOString(),
    source: 'legacy_factory_v0_1_1',
  };
}

function inferPathKindFromLegacyMode(
  mode: LegacyAssistantModeAlias | string | undefined,
): CanonicalEngineeringTaskMigrationInput['pathKind'] {
  if (mode === 'ship' || mode === 'review') return 'verify_only';
  if (mode === 'chat' || mode === 'plan') return 'chat_help';
  return 'full';
}

/**
 * Extract Factory-shaped embeds from a persisted message blob without writing.
 * Returns [] on malformed containers.
 */
export function extractLegacyFactoryRunsFromMessages(
  messages: unknown,
): LegacyFactoryRun[] {
  if (!Array.isArray(messages)) return [];
  const out: LegacyFactoryRun[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const factoryRun = (msg as { factoryRun?: unknown }).factoryRun;
    if (isLegacyFactoryRun(factoryRun)) {
      out.push(factoryRun);
    }
  }
  return out;
}
