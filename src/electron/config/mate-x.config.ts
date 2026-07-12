import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { MaTeXStorageAdapter } from "../storage/adapter";
import { EvidencePackStorage } from "../storage/evidence-pack-storage";
import { FailureMemorySync } from "../storage/failure-memory-sync";
import { SDKOrchestrator } from "../orchestration/sdk-orchestrator";
import type { CreateMaTeXStackDependencies, MaTeXConfig as MaTeXConfigContract } from "../../contracts/mate-x-config.types";
import type { AgentSdkClient } from "../../contracts/sdk-orchestrator.types";

export const MaTeXConfigSchema = z.object({
  storage: z.object({
    backend: z.enum(["r2", "s3", "gcs", "azure", "supabase", "vercel", "local"]),
    bucket: z.string().min(1),
    region: z.string().optional(),
    credentials: z.record(z.string(), z.unknown()).default({}),
    credentialsEnv: z.record(z.string(), z.string()).optional(),
    credentialsSecureKey: z.string().min(1).optional(),
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
      autoRoute: z.boolean().default(false),
      routingWindowSize: z.number().int().min(1).default(10),
    }).default({ autoRoute: false, routingWindowSize: 10 }),
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

const DEFAULT_LOCAL_CONFIG: MaTeXConfig = {
  storage: {
    backend: "local",
    bucket: ".mate-x/evidence",
    credentials: {},
    evidencePacks: {
      prefix: "evidence-packs/",
      retentionDays: 365,
    },
  },
  orchestration: {
    defaultAgent: "codex",
    criticLoop: {
      minVTS: 0.85,
      maxRetries: 3,
    },
    routing: {
      autoRoute: false,
      routingWindowSize: 10,
    },
  },
  privacy: {
    blockOnDetection: true,
    scanBeforeUpload: true,
    scanBeforeAgentCall: true,
  },
  failureMemory: {
    syncIntervalMinutes: 5,
    maxRecordsPerSync: 500,
    maxTotalRecords: 50000,
  },
};

export class ConfigValidationError extends Error {
  readonly code = "CONFIG_VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export async function loadConfig(filePath = resolve(process.cwd(), "mate-x.config.json")): Promise<MaTeXConfig> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return DEFAULT_LOCAL_CONFIG;
    }
    throw error;
  }
  await scanRawConfigForSecrets(raw);
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
  rejectInlineStorageCredentials(result.data.storage.credentials);
  return {
    ...result.data,
    storage: {
      ...result.data.storage,
      credentials: resolveStorageCredentials(result.data.storage.credentials, result.data.storage.credentialsEnv),
    },
  };
}

export async function createMaTeXStack(config: MaTeXConfig, dependencies: CreateMaTeXStackDependencies = {}) {
  const workspaceId = dependencies.workspaceId ?? "default";
  if (!dependencies.storage) {
    throw new Error("MaTE X storage dependencies are required in the Electron runtime.");
  }
  if (!dependencies.failureMemory) {
    throw new Error("MaTE X Failure Memory sync dependencies are required in the Electron runtime.");
  }
  const storage = {
    ...dependencies.storage,
  };
  const failureMemory = dependencies.failureMemory;
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
    failureMemory: sdk.failureMemory ?? failMissingFailureMemoryRecorder(),
    confirmHighImpact: sdk.confirmHighImpact ?? failMissingPolicyApproval,
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

function failMissingFailureMemoryRecorder() {
  return {
    async recordFailure() {
      throw new Error("Failure Memory Engine is not wired into SDKOrchestrator.");
    },
  };
}

async function failMissingPolicyApproval() {
  throw new Error("Policy Service is not wired into SDKOrchestrator.");
  return false;
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

function resolveStorageCredentials(
  credentials: Record<string, unknown> | undefined,
  credentialsEnv: Record<string, string> | undefined,
) {
  if (credentialsEnv) {
    return Object.fromEntries(
      Object.entries(credentialsEnv).map(([key, envName]) => [key, readCredentialEnvValue(envName)]),
    );
  }

  if (!credentials) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(credentials).map(([key, value]) => {
      if (typeof value === "string" && value.startsWith("$")) {
        return [key, readCredentialEnvValue(value.slice(1))];
      }
      return [key, value];
    }),
  );
}

function rejectInlineStorageCredentials(credentials: Record<string, unknown> | undefined) {
  if (!credentials) {
    return;
  }

  const inlineKeys = Object.entries(credentials)
    .filter(([, value]) => typeof value !== "string" || !value.startsWith("$"))
    .map(([key]) => key);

  if (inlineKeys.length > 0) {
    throw new ConfigValidationError(
      "MaTE X config validation failed:\n" +
        ` - storage.credentials.${inlineKeys.join(", storage.credentials.")}: ` +
        "Inline storage credentials are not allowed. Use credentialsSecureKey, credentialsEnv, or $ENV_VAR references.",
    );
  }
}

function readCredentialEnvValue(envName: string) {
  const value = process.env[envName];
  if (value === undefined) {
    console.debug(`credentialsEnv: env var ${envName} is not set`);
  }
  return value ?? "";
}

async function scanRawConfigForSecrets(rawConfigContent: string) {
  try {
    const { privacyFirewall } = await import("../privacy/privacy-firewall-service");
    const scanResult = await privacyFirewall.scanTextSafe(rawConfigContent);
    const hasSecrets =
      scanResult.stats.p0Count > 0 ||
      scanResult.spans.some(
        (span) =>
          span.risk === "p0" ||
          span.label === "secret" ||
          span.label === "repo_secret",
      );
    if (hasSecrets) {
      throw new Error(
        "CONFIG_SECRET_DETECTED: mate-x.config.json contains what appears " +
          "to be a hardcoded secret. Use credentialsEnv or $ENV_VAR " +
          "references instead. See docs at mate-x.xyz/docs/configuration",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CONFIG_SECRET_DETECTED:")) {
      throw error;
    }
    console.debug("Privacy Sentinel config scan unavailable; proceeding without load-time config scan.", error);
  }
}
