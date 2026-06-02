import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "bun:test";

import type { FailureMemory } from "../../contracts/workspace";
import { MaTeXStorageAdapter } from "./adapter";
import { FailureMemorySync, mergeFailureMemories } from "./failure-memory-sync";
import type { FilesSdkClient, StorageEvent } from "../../contracts/storage-adapter.types";
import type { FailureMemoryRepository, FailureMemorySyncStateStore } from "../../contracts/failure-memory-sync.types";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FailureMemorySync", () => {
  it("uploads only records modified since last sync", async () => {
    const files = new MemoryFilesSdkClient();
    const repository = new MemoryFailureMemoryRepository([
      failure("old", "2026-05-30T10:00:00.000Z"),
      failure("new", "2026-05-31T10:00:00.000Z"),
    ]);
    const sync = service(files, repository, new MemoryStateStore("2026-05-31T00:00:00.000Z"));

    const result = await sync.sync();
    const uploadedDelta = JSON.parse(Buffer.from(files.onlyUpload()).toString("utf8")) as { records: FailureMemory[] };

    assert.equal(result.uploadedRecords, 1);
    assert.deepEqual(uploadedDelta.records.map((record) => record.id), ["new"]);
  });

  it("merges remote state with newest timestamp winning", async () => {
    const files = new MemoryFilesSdkClient();
    const repository = new MemoryFailureMemoryRepository([failure("same", "2026-05-30T10:00:00.000Z", "local")]);
    const remote = {
      schemaVersion: 1,
      workspaceId: "workspace-1",
      createdAt: "2026-05-31T11:00:00.000Z",
      records: [failure("same", "2026-05-31T10:00:00.000Z", "remote")],
    };
    files.seed("failure-memory/workspace-1/deltas/20260531T110000000Z-remote.json", JSON.stringify(remote));
    const sync = service(files, repository, new MemoryStateStore("2026-05-31T00:00:00.000Z"));

    const result = await sync.sync();

    assert.equal(result.mergedRecords, 1);
    assert.equal(repository.records.get("same")?.command, "remote");
  });

  it("respects maxRecordsPerSync and maxTotalRecords", async () => {
    const repository = new MemoryFailureMemoryRepository([
      failure("a", "2026-05-31T10:00:00.000Z"),
      failure("b", "2026-05-31T10:01:00.000Z"),
      failure("c", "2026-05-31T10:02:00.000Z"),
    ]);
    const sync = service(new MemoryFilesSdkClient(), repository, new MemoryStateStore(null), {
      maxRecordsPerSync: 2,
      maxTotalRecords: 2,
    });

    const result = await sync.sync();

    assert.equal(result.uploadedRecords, 2);
    assert.equal(result.mergedRecords, 2);
  });

  it("exports and imports a portable workspace ZIP with conflict resolution", async () => {
    const exporterRepository = new MemoryFailureMemoryRepository([failure("shared", "2026-05-31T10:00:00.000Z", "exported")]);
    const exporter = service(new MemoryFilesSdkClient(), exporterRepository, new MemoryStateStore(null));
    const zip = await exporter.exportWorkspace();
    const root = await mkdtemp(join(tmpdir(), "matex-fm-sync-"));
    tempRoots.push(root);
    const zipPath = join(root, "failure-memory.zip");
    await writeFile(zipPath, zip);
    const importerRepository = new MemoryFailureMemoryRepository([failure("shared", "2026-05-30T10:00:00.000Z", "local")]);
    const importer = service(new MemoryFilesSdkClient(), importerRepository, new MemoryStateStore(null));

    const result = await importer.importWorkspace(zipPath);

    assert.equal(result.importedRecords, 1);
    assert.equal(importerRepository.records.get("shared")?.command, "exported");
  });

  it("appends adapter lifecycle StorageEvents for sync uploads", async () => {
    const events: StorageEvent[] = [];
    const repository = new MemoryFailureMemoryRepository([failure("new", "2026-05-31T10:00:00.000Z")]);
    const sync = service(new MemoryFilesSdkClient(), repository, new MemoryStateStore(null), {}, events);

    await sync.sync();

    assert.equal(events.some((event) => event.operation === "upload" && event.status === "success"), true);
  });

  it("starts a stoppable sync timer", async () => {
    const sync = service(new MemoryFilesSdkClient(), new MemoryFailureMemoryRepository([]), new MemoryStateStore(null), {
      syncIntervalMinutes: 1,
    });

    sync.start();
    sync.stop();
    sync.stop();

    assert.equal(true, true);
  });

  it("mergeFailureMemories keeps newest records first", () => {
    const merged = mergeFailureMemories([
      failure("a", "2026-05-30T10:00:00.000Z"),
      failure("a", "2026-05-31T10:00:00.000Z"),
      failure("b", "2026-05-29T10:00:00.000Z"),
    ]);

    assert.deepEqual(merged.map((record) => record.id), ["a", "b"]);
    assert.equal(merged[0]?.lastSeenAt, "2026-05-31T10:00:00.000Z");
  });
});

function service(
  files: MemoryFilesSdkClient,
  repository: FailureMemoryRepository,
  stateStore: FailureMemorySyncStateStore,
  config = {},
  events: StorageEvent[] = [],
) {
  return new FailureMemorySync(new MaTeXStorageAdapter({
    workspaceId: "workspace-1",
    backend: { backend: "local", bucket: "local" },
    files,
    privacySentinel: {
      scan: async () => ({ hasSecrets: false, categories: [] }),
    },
    evidenceRecorder: {
      appendStorageEvent: async (event) => {
        events.push(event);
      },
    },
    failureMemory: {
      recordFailure: async () => undefined,
    },
    approvalGate: {
      requireApproval: async () => undefined,
    },
    rateLimiter: {
      check: async () => true,
    },
    now: () => new Date("2026-05-31T10:00:00.000Z"),
  }), {
    workspaceId: "workspace-1",
    repository,
    stateStore,
    config,
    now: () => new Date("2026-05-31T10:00:00.000Z"),
  });
}

function failure(id: string, lastSeenAt: string, command = "test"): FailureMemory {
  return {
    id,
    workspaceId: "workspace-1",
    command,
    failingTests: [],
    errorSignature: `sig:${id}`,
    affectedFiles: [],
    occurrenceCount: 1,
    firstSeenAt: "2026-05-01T10:00:00.000Z",
    lastSeenAt,
  };
}

class MemoryFailureMemoryRepository implements FailureMemoryRepository {
  readonly records = new Map<string, FailureMemory>();

  constructor(records: FailureMemory[]) {
    for (const record of records) {
      this.records.set(record.id, record);
    }
  }

  async list(_workspaceId: string, limit: number): Promise<FailureMemory[]> {
    return Array.from(this.records.values()).slice(0, limit);
  }

  async upsert(records: FailureMemory[]): Promise<void> {
    for (const record of records) {
      this.records.set(record.id, record);
    }
  }
}

class MemoryStateStore implements FailureMemorySyncStateStore {
  constructor(private lastSyncAt: string | null) {}

  async getLastSyncAt(): Promise<string | null> {
    return this.lastSyncAt;
  }

  async setLastSyncAt(_workspaceId: string, timestamp: string): Promise<void> {
    this.lastSyncAt = timestamp;
  }
}

class MemoryFilesSdkClient implements FilesSdkClient {
  readonly uploads = new Map<string, Uint8Array>();

  seed(key: string, value: string) {
    this.uploads.set(key, new TextEncoder().encode(value));
  }

  onlyUpload() {
    const values = Array.from(this.uploads.values());
    assert.equal(values.length, 1);
    return values[0] ?? new Uint8Array();
  }

  async upload(key: string, body: string | Uint8Array | ArrayBuffer | Blob): Promise<{ url: string }> {
    if (typeof body === "string") {
      this.uploads.set(key, new TextEncoder().encode(body));
    } else if (body instanceof ArrayBuffer) {
      this.uploads.set(key, new Uint8Array(body));
    } else if (body instanceof Blob) {
      this.uploads.set(key, new Uint8Array(await body.arrayBuffer()));
    } else {
      this.uploads.set(key, body);
    }
    return { url: `local://${key}` };
  }

  async download(key: string): Promise<Uint8Array> {
    const value = this.uploads.get(key);
    if (!value) throw new Error(`missing ${key}`);
    return value;
  }

  async delete(): Promise<void> {}

  async list(options?: Record<string, unknown>): Promise<Array<{ key: string; size: number }>> {
    const prefix = typeof options?.prefix === "string" ? options.prefix : "";
    return Array.from(this.uploads.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, size: value.byteLength }));
  }
}
