import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "bun:test";

import { MaTeXStorageAdapter } from "../storage/adapter";
import { EvidencePackStorage } from "../storage/evidence-pack-storage";
import { FailureMemorySync } from "../storage/failure-memory-sync";
import { SDKOrchestrator } from "../orchestration/sdk-orchestrator";
import type { FailureMemory } from "../../contracts/workspace";
import type { AgentAction, AgentSdkClient } from "../../contracts/sdk-orchestrator.types";
import type { FilesSdkClient } from "../../contracts/storage-adapter.types";
import { ConfigValidationError, createMaTeXStack, loadConfig, MaTeXConfigSchema } from "./mate-x.config";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("MaTE X config", () => {
  it("loads a valid config with defaults applied", async () => {
    const path = await writeConfig({
      storage: { backend: "local", bucket: "matex", credentials: {} },
      orchestration: { defaultAgent: "codex" },
    });

    const config = await loadConfig(path);

    assert.equal(config.storage.evidencePacks.prefix, "evidence-packs/");
    assert.equal(config.storage.evidencePacks.retentionDays, 365);
    assert.equal(config.orchestration.criticLoop.minVTS, 0.85);
    assert.equal(config.orchestration.routing.autoRoute, true);
    assert.equal(config.privacy.scanBeforeUpload, true);
    assert.equal(config.failureMemory.maxRecordsPerSync, 500);
  });

  it("throws ConfigValidationError for missing required fields with field names", async () => {
    const path = await writeConfig({
      storage: { backend: "local", credentials: {} },
      orchestration: { defaultAgent: "codex" },
    });

    await assert.rejects(
      loadConfig(path),
      (error) => error instanceof ConfigValidationError && /storage\.bucket/.test(error.message),
    );
  });

  it("lists multiple invalid fields in one error", async () => {
    const path = await writeConfig({
      storage: { backend: "local", bucket: "", credentials: {} },
      orchestration: {
        defaultAgent: "codex",
        criticLoop: { minVTS: 2, maxRetries: -1 },
      },
      failureMemory: { maxRecordsPerSync: 0 },
    });

    await assert.rejects(
      loadConfig(path),
      (error) =>
        error instanceof ConfigValidationError &&
        /storage\.bucket/.test(error.message) &&
        /orchestration\.criticLoop\.minVTS/.test(error.message) &&
        /orchestration\.criticLoop\.maxRetries/.test(error.message) &&
        /failureMemory\.maxRecordsPerSync/.test(error.message),
    );
  });

  it("rejects minVTS values above 1.0", async () => {
    const result = MaTeXConfigSchema.safeParse({
      storage: { backend: "local", bucket: "matex", credentials: {} },
      orchestration: { defaultAgent: "codex", criticLoop: { minVTS: 1.1 } },
    });

    assert.equal(result.success, false);
  });

  it("rejects unknown storage backend values", async () => {
    const path = await writeConfig({
      storage: { backend: "ftp", bucket: "matex", credentials: {} },
      orchestration: { defaultAgent: "codex" },
    });

    await assert.rejects(
      loadConfig(path),
      (error) => error instanceof ConfigValidationError && /storage\.backend/.test(error.message),
    );
  });

  it("reads config from a custom path", async () => {
    const path = await writeConfig({
      storage: { backend: "s3", bucket: "custom", region: "us-east-1", credentials: { profile: "dev" } },
      orchestration: { defaultAgent: "cursor" },
    });

    const config = await loadConfig(path);

    assert.equal(config.storage.bucket, "custom");
    assert.equal(config.orchestration.defaultAgent, "cursor");
  });

  it("createMaTeXStack returns all four wired components", async () => {
    const config = MaTeXConfigSchema.parse({
      storage: { backend: "local", bucket: "matex", credentials: {} },
      orchestration: { defaultAgent: "codex" },
    });

    const stack = await createMaTeXStack(config, {
      workspaceId: "workspace-1",
      storage: {
        files: new MemoryFilesSdkClient(),
        privacySentinel: { scan: async () => ({ hasSecrets: false, categories: [] }) },
        evidenceRecorder: { appendStorageEvent: async () => undefined },
        failureMemory: { recordFailure: async () => undefined },
        approvalGate: { requireApproval: async () => undefined },
        rateLimiter: { check: async () => true },
      },
      failureMemory: {
        repository: new MemoryFailureMemoryRepository(),
        stateStore: new MemoryStateStore(),
      },
      sdk: {
        codexClient: new MockSdkClient(),
        cursorClient: new MockSdkClient(),
        antigravityClient: new MockSdkClient(),
        privacySentinel: { scan: async () => ({ hasSecrets: false, categories: [] }) },
        evidenceRecorder: { appendAgentActionEvent: async () => undefined },
        failureMemory: { recordFailure: async () => undefined },
        confirmHighImpact: async (_action: AgentAction) => true,
      },
    });

    assert.equal(stack.adapter instanceof MaTeXStorageAdapter, true);
    assert.equal(stack.evidencePackStorage instanceof EvidencePackStorage, true);
    assert.equal(stack.failureMemorySync instanceof FailureMemorySync, true);
    assert.equal(stack.orchestrator instanceof SDKOrchestrator, true);
    stack.failureMemorySync.stop();
  });
});

async function writeConfig(value: unknown) {
  const root = await mkdtemp(join(tmpdir(), "matex-config-"));
  tempRoots.push(root);
  const path = join(root, "mate-x.config.json");
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
  return path;
}

class MemoryFilesSdkClient implements FilesSdkClient {
  async upload(): Promise<{ url: string }> {
    return { url: "local://ok" };
  }

  async download(): Promise<string> {
    return "";
  }

  async delete(): Promise<void> {}

  async list(): Promise<[]> {
    return [];
  }
}

class MemoryFailureMemoryRepository {
  async list(): Promise<FailureMemory[]> {
    return [];
  }

  async upsert(): Promise<void> {}
}

class MemoryStateStore {
  async getLastSyncAt(): Promise<string | null> {
    return null;
  }

  async setLastSyncAt(): Promise<void> {}
}

class MockSdkClient implements AgentSdkClient {
  async execute() {
    return {
      output: { ok: true },
      tool_execution_events: [{ toolName: "run_tests", status: "success" as const }],
    };
  }
}
