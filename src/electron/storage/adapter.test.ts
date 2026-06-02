import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  MaTeXStorageAdapter,
  MaTeXStorageError,
  StorageRateLimitError,
  StorageSecretLeakError,
} from "./adapter";
import type {
  FilesSdkClient,
  StorageEvent,
  StorageOperationType,
} from "../../contracts/storage-adapter.types";

describe("MaTeXStorageAdapter", () => {
  it("uploads after privacy scan and records successful evidence", async () => {
    const context = testContext();
    const adapter = context.adapter();

    const result = await adapter.uploadFile("reports/a.txt", "hello");

    assert.equal(result.key, "reports/a.txt");
    assert.equal(context.scans.length, 1);
    assert.equal(context.events[0]?.operation, "upload");
    assert.equal(context.events[0]?.status, "success");
    assert.equal(context.events[0]?.sizeBytes, 5);
  });

  it("blocks uploads when Privacy Sentinel detects secret categories", async () => {
    const context = testContext({ secretCategories: ["rainy_api_key"] });
    const adapter = context.adapter();

    await assert.rejects(
      adapter.uploadFile("secrets.txt", "RAINY_API_KEY=secret"),
      StorageSecretLeakError,
    );
    assert.equal(context.files.uploads.length, 0);
    assert.equal(context.events.some((event) => event.type === "BLOCKED_UPLOAD"), true);
    assert.deepEqual(context.events.at(-1)?.secretCategories, ["rainy_api_key"]);
  });

  it("wraps raw files-sdk upload errors and records Failure Memory", async () => {
    const context = testContext({ uploadError: new Error("provider down") });
    const adapter = context.adapter();

    await assert.rejects(
      adapter.uploadFile("a.txt", "body"),
      (error) => error instanceof MaTeXStorageError && error.code === "Error",
    );
    assert.equal(context.failures.length, 1);
    assert.match(context.failures[0]?.errorSignature ?? "", /storage:local:upload:error/);
  });

  it("requires high-impact approval before destructive deletes", async () => {
    const context = testContext();
    const adapter = context.adapter();

    await adapter.deleteFile("old.txt", true);

    assert.deepEqual(context.approvals, [{
      operation: "deleteFile",
      path: "old.txt",
      reason: "Deleting a remote object is destructive.",
      allowHighImpact: true,
    }]);
    assert.deepEqual(context.files.deleted, ["old.txt"]);
  });

  it("requires high-impact approval before overwrites", async () => {
    const context = testContext();
    const adapter = context.adapter();

    await adapter.uploadFile("existing.txt", "new", { overwrite: true, allowHighImpact: true });

    assert.equal(context.approvals[0]?.operation, "overwriteFile");
    assert.equal(context.files.uploads[0]?.key, "existing.txt");
  });

  it("enforces storage rate limits before SDK calls", async () => {
    const context = testContext({ rateLimited: true });
    const adapter = context.adapter();

    await assert.rejects(
      adapter.uploadFile("limited.txt", "body"),
      StorageRateLimitError,
    );
    assert.equal(context.files.uploads.length, 0);
    assert.equal(context.events[0]?.status, "failure");
    assert.equal(context.failures[0]?.errorSignature, "storage:local:upload:storage_rate_limited");
  });

  it("lists normalized files", async () => {
    const context = testContext();
    const adapter = context.adapter();

    const files = await adapter.listFiles({ prefix: "reports/" });

    assert.deepEqual(files, [{ key: "reports/a.txt", size: 5, updatedAt: undefined, url: undefined }]);
    assert.equal(context.events.at(-1)?.operation, "list");
  });
});

function testContext(options: {
  secretCategories?: string[];
  uploadError?: Error;
  rateLimited?: boolean;
} = {}) {
  const events: StorageEvent[] = [];
  const failures: Array<{ errorSignature: string }> = [];
  const scans: Array<string | Uint8Array> = [];
  const approvals: Array<{
    operation: "deleteFile" | "overwriteFile";
    path: string;
    reason: string;
    allowHighImpact?: boolean;
  }> = [];
  const files = new MemoryFilesSdkClient(options.uploadError);

  return {
    events,
    failures,
    scans,
    approvals,
    files,
    adapter: () => new MaTeXStorageAdapter({
      workspaceId: "workspace-1",
      backend: { backend: "local", bucket: "local" },
      files,
      privacySentinel: {
        scan: async (content) => {
          scans.push(content);
          return {
            hasSecrets: Boolean(options.secretCategories?.length),
            categories: options.secretCategories ?? [],
          };
        },
      },
      evidenceRecorder: {
        appendStorageEvent: async (event) => {
          events.push(event);
        },
      },
      failureMemory: {
        recordFailure: async (failure) => {
          failures.push({ errorSignature: failure.errorSignature });
        },
      },
      approvalGate: {
        requireApproval: async (approval) => {
          approvals.push(approval);
        },
      },
      rateLimiter: {
        check: async (_input: { operation: StorageOperationType }) => !options.rateLimited,
      },
      now: () => new Date("2026-05-31T10:00:00.000Z"),
    }),
  };
}

class MemoryFilesSdkClient implements FilesSdkClient {
  readonly uploads: Array<{ key: string; body: string | Uint8Array | ArrayBuffer | Blob }> = [];
  readonly deleted: string[] = [];

  constructor(private readonly uploadError?: Error) {}

  async upload(key: string, body: string | Uint8Array | ArrayBuffer | Blob): Promise<{ url: string }> {
    if (this.uploadError) {
      throw this.uploadError;
    }
    this.uploads.push({ key, body });
    return { url: `local://${key}` };
  }

  async download(key: string): Promise<string> {
    return `content:${key}`;
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
  }

  async list(): Promise<Array<{ key: string; size: number }>> {
    return [{ key: "reports/a.txt", size: 5 }];
  }
}
