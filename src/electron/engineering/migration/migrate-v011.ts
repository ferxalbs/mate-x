/**
 * v0.1.1 → v0.1.2 EngineeringTask migration on production initialization.
 * Idempotent: second startup does not duplicate tasks.
 * Legacy Factory records remain immutable (read-only archive marker).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { EngineeringRepository } from '../repository-types';
import { EngineeringCommandBus } from '../command-bus';
import {
  decodeLegacyFactoryToMigrationInput,
  extractLegacyFactoryRunsFromMessages,
} from './legacy-factory-decoder';
import type { CanonicalEngineeringTaskMigrationInput } from './legacy-factory-types';

export interface V011MigrationFixture {
  version: '0.1.1';
  workspace: {
    id: string;
    path: string;
    name: string;
    branch?: string;
  };
  settings?: Record<string, unknown>;
  /** Historical Factory-bearing messages — no EngineeringTask records */
  messages?: unknown[];
  legacyFactoryRuns?: unknown[];
}

export interface MigrationResult {
  migrated: boolean;
  tasksCreated: number;
  engineeringTaskIds: string[];
  skippedDuplicate: boolean;
  malformedSkipped: number;
  settingsPreserved: boolean;
  archivePath: string | null;
  errors: string[];
}

const MIGRATION_MARKER = 'engineering-migration-v0.1.2.json';

function migrationKey(input: CanonicalEngineeringTaskMigrationInput): string {
  return createHash('sha256')
    .update(
      `${input.workspaceId}|${input.legacyFactoryRunId ?? ''}|${input.objectiveSeed}`,
      'utf8',
    )
    .digest('hex');
}

export function loadV011Fixture(fixturePath: string): V011MigrationFixture {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as V011MigrationFixture;
  if (raw.version !== '0.1.1') {
    throw new Error(`Expected fixture version 0.1.1, got ${String(raw.version)}`);
  }
  return raw;
}

/**
 * Run migration against an EngineeringRepository.
 * Does not write Factory records. Does not compute readiness from legacy events.
 */
export function runV011Migration(input: {
  repo: EngineeringRepository;
  fixture: V011MigrationFixture;
  userDataDir: string;
  bus?: EngineeringCommandBus;
}): MigrationResult {
  const markerPath = join(input.userDataDir, MIGRATION_MARKER);
  const archiveDir = join(input.userDataDir, 'legacy-archive', 'v0.1.1');
  const errors: string[] = [];
  const engineeringTaskIds: string[] = [];
  let malformedSkipped = 0;

  mkdirSync(dirname(markerPath), { recursive: true });

  let priorKeys = new Set<string>();
  if (existsSync(markerPath)) {
    try {
      const prior = JSON.parse(readFileSync(markerPath, 'utf8')) as {
        keys?: string[];
        engineeringTaskIds?: string[];
      };
      priorKeys = new Set(prior.keys ?? []);
      if ((prior.engineeringTaskIds?.length ?? 0) > 0 && priorKeys.size > 0) {
        return {
          migrated: false,
          tasksCreated: 0,
          engineeringTaskIds: prior.engineeringTaskIds ?? [],
          skippedDuplicate: true,
          malformedSkipped: 0,
          settingsPreserved: true,
          archivePath: existsSync(archiveDir) ? archiveDir : null,
          errors: [],
        };
      }
    } catch {
      // corrupt marker — proceed carefully
    }
  }

  const bus = input.bus ?? new EngineeringCommandBus(input.repo);
  const candidates: CanonicalEngineeringTaskMigrationInput[] = [];

  for (const run of input.fixture.legacyFactoryRuns ?? []) {
    const decoded = decodeLegacyFactoryToMigrationInput({
      workspaceId: input.fixture.workspace.id,
      factoryRun: run,
    });
    if (!decoded) {
      malformedSkipped += 1;
      continue;
    }
    candidates.push(decoded);
  }

  for (const run of extractLegacyFactoryRunsFromMessages(input.fixture.messages)) {
    const decoded = decodeLegacyFactoryToMigrationInput({
      workspaceId: input.fixture.workspace.id,
      factoryRun: run,
    });
    if (!decoded) {
      malformedSkipped += 1;
      continue;
    }
    candidates.push(decoded);
  }

  // Deduplicate by migration key
  const unique = new Map<string, CanonicalEngineeringTaskMigrationInput>();
  for (const c of candidates) {
    unique.set(migrationKey(c), c);
  }

  const keys: string[] = [];
  for (const [key, candidate] of unique) {
    if (priorKeys.has(key)) {
      keys.push(key);
      continue;
    }
    // Already have tasks for this workspace with same objective? skip
    const existing = input.repo.listTasks(candidate.workspaceId);
    const dup = existing.find(
      (t) => t.objectiveSeed === candidate.objectiveSeed,
    );
    if (dup) {
      engineeringTaskIds.push(dup.engineeringTaskId);
      keys.push(key);
      continue;
    }

    const result = bus.dispatch({
      type: 'CaptureTask',
      workspaceId: candidate.workspaceId,
      objectiveSeed: candidate.objectiveSeed,
      conversationId: candidate.conversationId,
      pathKind: candidate.pathKind,
    } as Parameters<EngineeringCommandBus['dispatch']>[0]);
    if (!result.ok) {
      errors.push(result.error?.message ?? 'CaptureTask failed during migration');
      malformedSkipped += 1;
      continue;
    }
    const id = (result.data as { engineeringTaskId: string }).engineeringTaskId;
    engineeringTaskIds.push(id);
    keys.push(key);
  }

  // Archive immutable legacy payload (do not mutate source fixture)
  mkdirSync(archiveDir, { recursive: true });
  const archivePath = join(archiveDir, 'factory-snapshot.json');
  writeFileSync(
    archivePath,
    JSON.stringify(
      {
        archivedAt: new Date().toISOString(),
        immutable: true,
        workspace: input.fixture.workspace,
        settings: input.fixture.settings ?? {},
        legacyFactoryRuns: input.fixture.legacyFactoryRuns ?? [],
        messageCount: Array.isArray(input.fixture.messages)
          ? input.fixture.messages.length
          : 0,
      },
      null,
      2,
    ),
    'utf8',
  );

  writeFileSync(
    markerPath,
    JSON.stringify(
      {
        version: '0.1.2',
        completedAt: new Date().toISOString(),
        keys,
        engineeringTaskIds,
        settingsPreserved: Boolean(input.fixture.settings),
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    migrated: engineeringTaskIds.length > 0,
    tasksCreated: engineeringTaskIds.length,
    engineeringTaskIds,
    skippedDuplicate: false,
    malformedSkipped,
    settingsPreserved: true,
    archivePath,
    errors,
  };
}
