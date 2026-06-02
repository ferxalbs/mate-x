import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { MaTeXStorageAdapter } from "../storage/adapter";
import { EvidencePackStorage } from "../storage/evidence-pack-storage";
import { FailureMemorySync } from "../storage/failure-memory-sync";
import { SDKOrchestrator } from "../orchestration/sdk-orchestrator";
import type { CreateMaTeXStackDependencies, MaTeXConfig as MaTeXConfigContract } from "../../contracts/mate-x-config.types";
import type { FailureMemory } from "../../contracts/workspace";
import type { AgentSdkClient } from "../../contracts/sdk-orchestrator.types";

export const MaTeXConfigSchema = z.object({
  storage: z.object({
    backend: z.enum(["r2", "s3", "gcs", "azure", "supabase", "vercel", "local"]),
    bucket: z.string().min(1),
    region: z.string().optional(),
    credentials: z.record(z.string(), z.unknown()),
    evidencePacks: z.object({
      prefix: z.string().default("evidence-packs/"),
      retentionDays: z.number().int().min(1).default(365),
    }).default({ prefix: "evidence-packs/", retentionDays: 365 }),
  }),
  orchestration: z.object({
    defaultAgent: z.enum(["codex", "cursor", "antigravity"]),
    criticLoop: z.object({
      minVTS: z.number().min(0).max(1).default(0.85),
      maxRetries: z.number().int().min(0).default(3),
    }).default({ minVTS: 0.85, maxRetries: 3 }),
    routing: z.object({
      autoRoute: z.boolean().default(true),
      routingWindowSize: z.number().int().min(1).default(10),
    }).default({ autoRoute: true, routingWindowSize: 10 }),
  }),
  privacy: z.object({
    blockOnDetection: z.boolean().default(true),
    scanBeforeUpload: z.boolean().default(true),
    scanBeforeAgentCall: z.boolean().default(true),
  }).default({ blockOnDetection: true, scanBeforeUpload: true, scanBeforeAgentCall: true }),
  failureMemory: z.object({
    syncIntervalMinutes: z.number().min(0.5).default(5),
    maxRecordsPerSync: z.number().int().min(1).default(500),
    maxTotalRecords: z.number().int().min(1).default(50000),
  }).default({ syncIntervalMinutes: 5, maxRecordsPerSync: 500, maxTotalRecords: 50000 }),
});

export type MaTeXConfig = z.infer<typeof MaTeXConfigSchema> & MaTeXConfigContract;

export class ConfigValidationError extends Error {
  readonly code = "CONFIG_VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export async function loadConfig(filePath = resolve(process.cwd(), "mate-x.config.json")): Promise<MaTeXConfig> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ConfigValidationError(
      `MaTE X config validation failed:\n - <root>: ${error instanceof Error ? error.message : "Invalid JSON"}`,
    );
  }

  const result = MaTeXConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigValidationError(formatConfigIssues(result.error.issues));
  }
  return result.data;
}

export async function createMaTeXStack(config: MaTeXConfig, dependencies: CreateMaTeXStackDependencies = {}) {
  const workspaceId = dependencies.workspaceId ?? "default";
  const storage = {
    privacySentinel: { scan: async () => ({ hasSecrets: false, categories: [] }) },
    evidenceRecorder: { appendStorageEvent: async () => undefined },
    failureMemory: { recordFailure: async () => undefined },
    approvalGate: { requireApproval: async () => undefined },
    rateLimiter: { check: async () => true },
    profiler: { recordStorageOperation: async () => undefined },
    ...dependencies.storage,
  };
  const failureMemory = dependencies.failureMemory ?? createInMemoryFailureMemory();
  const sdk = dependencies.sdk ?? {};
  const unavailableClient = createUnavailableSdkClient();
  const adapter = storage.files
    ? new MaTeXStorageAdapter({
        ...storage,
        files: storage.files,
        workspaceId,
        backend: config.storage,
      })
    : await MaTeXStorageAdapter.create({
        ...storage,
        workspaceId,
        backend: config.storage,
        factory: storage.factory,
      });
  const evidencePackStorage = new EvidencePackStorage(adapter);
  const failureMemorySync = new FailureMemorySync(adapter, {
    workspaceId,
    repository: failureMemory.repository,
    stateStore: failureMemory.stateStore,
    config: {
      syncIntervalMinutes: config.failureMemory.syncIntervalMinutes,
      maxRecordsPerSync: config.failureMemory.maxRecordsPerSync,
      maxTotalRecords: config.failureMemory.maxTotalRecords,
    },
  });
  failureMemorySync.start();
  const orchestrator = new SDKOrchestrator({
    workspaceId,
    codexClient: sdk.codexClient ?? unavailableClient,
    cursorClient: sdk.cursorClient ?? unavailableClient,
    antigravityClient: sdk.antigravityClient ?? unavailableClient,
    privacySentinel: sdk.privacySentinel ?? { scan: async () => ({ hasSecrets: false, categories: [] }) },
    evidenceRecorder: sdk.evidenceRecorder ?? { appendAgentActionEvent: async () => undefined },
    failureMemory: sdk.failureMemory ?? { recordFailure: async () => undefined },
    confirmHighImpact: sdk.confirmHighImpact ?? (async () => false),
    config: config.orchestration,
  });

  return {
    adapter,
    evidencePackStorage,
    failureMemorySync,
    orchestrator,
  };
}

function createUnavailableSdkClient(): AgentSdkClient {
  return {
    async execute() {
      throw new Error("SDK client is not configured for this Electron session.");
    },
  };
}

function createInMemoryFailureMemory() {
  const records = new Map<string, FailureMemory>();
  const lastSyncAt = new Map<string, string>();

  return {
    repository: {
      async list(workspaceId: string, limit: number) {
        return Array.from(records.values())
          .filter((record) => record.workspaceId === workspaceId)
          .slice(0, limit);
      },
      async upsert(nextRecords: FailureMemory[]) {
        for (const record of nextRecords) {
          records.set(record.id, record);
        }
      },
    },
    stateStore: {
      async getLastSyncAt(workspaceId: string) {
        return lastSyncAt.get(workspaceId) ?? null;
      },
      async setLastSyncAt(workspaceId: string, timestamp: string) {
        lastSyncAt.set(workspaceId, timestamp);
      },
    },
  };
}

function formatConfigIssues(issues: z.core.$ZodIssue[]) {
  const lines = issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return ` - ${field}: ${normalizeIssueMessage(issue)}`;
  });
  return ["MaTE X config validation failed:", ...lines].join("\n");
}

function normalizeIssueMessage(issue: z.core.$ZodIssue) {
  if (issue.message.includes("undefined") || issue.message.includes("received undefined")) {
    return "Required";
  }
  if (issue.path.join(".") === "orchestration.criticLoop.minVTS") {
    return "Number must be between 0 and 1";
  }
  return issue.message;
}
