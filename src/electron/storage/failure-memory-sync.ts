import { readFile, writeFile } from "node:fs/promises";
import { basename, posix } from "node:path";
import { inflateRawSync } from "node:zlib";

import { sha256Hex } from "../../features/compliance/attestation";
import type { FailureMemory } from "../../contracts/workspace";
import type { MaTeXStorageAdapter } from "./adapter";
import type {
  FailureMemoryDeltaDocument,
  FailureMemorySyncOptions,
  FailureMemorySyncResult,
  FailureMemoryWorkspaceExport,
} from "../../contracts/failure-memory-sync.types";

const DEFAULT_PREFIX = "failure-memory/";
const DEFAULT_SYNC_INTERVAL_MINUTES = 5;
const DEFAULT_MAX_RECORDS_PER_SYNC = 500;
const DEFAULT_MAX_TOTAL_RECORDS = 50_000;

export class FailureMemorySyncError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FailureMemorySyncError";
    this.code = code;
  }
}

export class FailureMemorySync {
  private readonly options: FailureMemorySyncOptions;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly adapter: MaTeXStorageAdapter,
    options: FailureMemorySyncOptions,
  ) {
    this.options = options;
  }

  start() {
    this.stop();
    const intervalMs = configValue(this.options.config?.syncIntervalMinutes, DEFAULT_SYNC_INTERVAL_MINUTES) * 60_000;
    this.timer = setInterval(() => {
      void this.sync().catch(() => undefined);
    }, intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sync(): Promise<FailureMemorySyncResult> {
    const now = this.nowIso();
    const lastSyncAt = await this.options.stateStore.getLastSyncAt(this.options.workspaceId);
    const maxRecordsPerSync = configValue(this.options.config?.maxRecordsPerSync, DEFAULT_MAX_RECORDS_PER_SYNC);
    const maxTotalRecords = configValue(this.options.config?.maxTotalRecords, DEFAULT_MAX_TOTAL_RECORDS);
    const localRecords = await this.options.repository.list(this.options.workspaceId, maxTotalRecords);
    const localDeltas = localRecords
      .filter((record) => !lastSyncAt || compareRecordTimestamp(record, lastSyncAt) > 0)
      .sort((a, b) => recordTimestamp(a).localeCompare(recordTimestamp(b)))
      .slice(0, maxRecordsPerSync);

    if (localDeltas.length > 0) {
      const delta: FailureMemoryDeltaDocument = {
        schemaVersion: 1,
        workspaceId: this.options.workspaceId,
        createdAt: now,
        records: localDeltas,
      };
      await this.adapter.uploadFile(deltaPath(this.prefix, this.options.workspaceId, now, localDeltas), jsonBytes(delta));
    }

    const remoteDeltas = await this.loadRemoteDeltas(maxRecordsPerSync);
    const merged = mergeFailureMemories([...localRecords, ...remoteDeltas], maxTotalRecords);
    await this.options.repository.upsert(merged);
    await this.options.stateStore.setLastSyncAt(this.options.workspaceId, now);

    if (localDeltas.length === 0 && remoteDeltas.length === 0) {
      await this.adapter.uploadFile(syncMarkerPath(this.prefix, this.options.workspaceId, now), jsonBytes({
        schemaVersion: 1,
        workspaceId: this.options.workspaceId,
        createdAt: now,
        records: [],
      } satisfies FailureMemoryDeltaDocument));
    }

    return {
      uploadedRecords: localDeltas.length,
      downloadedRecords: remoteDeltas.length,
      mergedRecords: merged.length,
      lastSyncAt: now,
    };
  }

  async exportWorkspace(workspaceId = this.options.workspaceId): Promise<Buffer> {
    const maxTotalRecords = configValue(this.options.config?.maxTotalRecords, DEFAULT_MAX_TOTAL_RECORDS);
    const records = await this.options.repository.list(workspaceId, maxTotalRecords);
    const payload: FailureMemoryWorkspaceExport = {
      schemaVersion: 1,
      workspaceId,
      exportedAt: this.nowIso(),
      records: records.slice(0, maxTotalRecords),
    };
    return buildStoredZip({
      "failure-memory.json": jsonBytes(payload),
    });
  }

  async importWorkspace(zipPath: string): Promise<{ importedRecords: number; mergedRecords: number }> {
    const buffer = await readFile(zipPath);
    const entries = readZipEntries(buffer);
    const payload = parseWorkspaceExport(entries.get("failure-memory.json"));
    const maxTotalRecords = configValue(this.options.config?.maxTotalRecords, DEFAULT_MAX_TOTAL_RECORDS);
    const localRecords = await this.options.repository.list(this.options.workspaceId, maxTotalRecords);
    const merged = mergeFailureMemories([...localRecords, ...payload.records], maxTotalRecords);
    await this.options.repository.upsert(merged);
    return {
      importedRecords: payload.records.length,
      mergedRecords: merged.length,
    };
  }

  async exportWorkspaceToFile(path: string, workspaceId = this.options.workspaceId): Promise<void> {
    await writeFile(path, await this.exportWorkspace(workspaceId));
  }

  private async loadRemoteDeltas(limit: number): Promise<FailureMemory[]> {
    const files = await this.adapter.listFiles({ prefix: posix.join(this.prefix, this.options.workspaceId, "deltas") });
    const deltaFiles = files
      .map((file) => file.key)
      .filter((key) => basename(key).endsWith(".json"))
      .sort()
      .slice(-limit);
    const records: FailureMemory[] = [];
    for (const key of deltaFiles) {
      const value = await this.adapter.downloadFile(key);
      const delta = parseDelta(toBuffer(value), key);
      if (delta.workspaceId === this.options.workspaceId) {
        records.push(...delta.records.slice(0, limit - records.length));
      }
      if (records.length >= limit) break;
    }
    return records;
  }

  private get prefix() {
    return normalizePrefix(this.options.config?.prefix ?? DEFAULT_PREFIX);
  }

  private nowIso() {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }
}

export function mergeFailureMemories(records: FailureMemory[], maxTotalRecords = DEFAULT_MAX_TOTAL_RECORDS) {
  const byId = new Map<string, FailureMemory>();
  for (const record of records) {
    const current = byId.get(record.id);
    if (!current || recordTimestamp(record) >= recordTimestamp(current)) {
      byId.set(record.id, record);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => recordTimestamp(b).localeCompare(recordTimestamp(a)))
    .slice(0, maxTotalRecords);
}

function parseDelta(buffer: Buffer, source: string): FailureMemoryDeltaDocument {
  const value = parseJson(buffer, source);
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.workspaceId !== "string" || !Array.isArray(value.records)) {
    throw new FailureMemorySyncError("INVALID_DELTA", `Failure Memory delta ${source} is invalid.`);
  }
  return {
    schemaVersion: 1,
    workspaceId: value.workspaceId,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
    records: value.records.map(parseFailureMemory),
  };
}

function parseWorkspaceExport(value: Buffer | undefined): FailureMemoryWorkspaceExport {
  if (!value) {
    throw new FailureMemorySyncError("INVALID_WORKSPACE_EXPORT", "Workspace export is missing failure-memory.json.");
  }
  const parsed = parseJson(value, "failure-memory.json");
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.workspaceId !== "string" || !Array.isArray(parsed.records)) {
    throw new FailureMemorySyncError("INVALID_WORKSPACE_EXPORT", "failure-memory.json is invalid.");
  }
  return {
    schemaVersion: 1,
    workspaceId: parsed.workspaceId,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date(0).toISOString(),
    records: parsed.records.map(parseFailureMemory),
  };
}

function parseFailureMemory(value: unknown): FailureMemory {
  if (!isRecord(value)) {
    throw new FailureMemorySyncError("INVALID_FAILURE_MEMORY", "Failure Memory record must be an object.");
  }
  const requiredStrings = ["id", "workspaceId", "command", "errorSignature", "firstSeenAt", "lastSeenAt"] as const;
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string") {
      throw new FailureMemorySyncError("INVALID_FAILURE_MEMORY", `Failure Memory record is missing ${key}.`);
    }
  }
  return {
    id: requiredString(value, "id"),
    workspaceId: requiredString(value, "workspaceId"),
    command: requiredString(value, "command"),
    exitCode: typeof value.exitCode === "number" ? value.exitCode : undefined,
    framework: typeof value.framework === "string" ? value.framework : undefined,
    failingTests: stringArray(value.failingTests),
    errorSignature: requiredString(value, "errorSignature"),
    stackTraceExcerpt: typeof value.stackTraceExcerpt === "string" ? value.stackTraceExcerpt : undefined,
    affectedFiles: stringArray(value.affectedFiles),
    attemptedFix: typeof value.attemptedFix === "string" ? value.attemptedFix : undefined,
    retryFixed: typeof value.retryFixed === "boolean" ? value.retryFixed : undefined,
    occurrenceCount: typeof value.occurrenceCount === "number" ? value.occurrenceCount : 1,
    firstSeenAt: requiredString(value, "firstSeenAt"),
    lastSeenAt: requiredString(value, "lastSeenAt"),
    resolvedAt: typeof value.resolvedAt === "string" ? value.resolvedAt : undefined,
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function requiredString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string") {
    throw new FailureMemorySyncError("INVALID_FAILURE_MEMORY", `Failure Memory record is missing ${key}.`);
  }
  return value;
}

function deltaPath(prefix: string, workspaceId: string, timestamp: string, records: FailureMemory[]) {
  const digest = sha256Hex(jsonBytes(records)).slice(0, 12);
  return posix.join(prefix, workspaceId, "deltas", `${safeTimestamp(timestamp)}-${digest}.json`);
}

function syncMarkerPath(prefix: string, workspaceId: string, timestamp: string) {
  return posix.join(prefix, workspaceId, "sync-events", `${safeTimestamp(timestamp)}.json`);
}

function recordTimestamp(record: FailureMemory) {
  return record.resolvedAt ?? record.lastSeenAt ?? record.firstSeenAt;
}

function compareRecordTimestamp(record: FailureMemory, timestamp: string) {
  return recordTimestamp(record).localeCompare(timestamp);
}

function jsonBytes(value: unknown) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function parseJson(buffer: Buffer, source: string): unknown {
  try {
    return JSON.parse(buffer.toString("utf8")) as unknown;
  } catch {
    throw new FailureMemorySyncError("INVALID_JSON", `${source} is not valid JSON.`);
  }
}

function configValue(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizePrefix(prefix: string) {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function safeTimestamp(timestamp: string) {
  return timestamp.replace(/[-:.]/g, "");
}

function toBuffer(value: string | Uint8Array) {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buffer.byteLength) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const dataStart = fileNameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = buffer.subarray(fileNameStart, fileNameEnd).toString("utf8");
    const compressed = buffer.subarray(dataStart, dataEnd);
    entries.set(name, method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed));
    offset = dataEnd;
  }
  return entries;
}

function buildStoredZip(entries: Record<string, Buffer>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.byteLength, 18);
    local.writeUInt32LE(content.byteLength, 22);
    local.writeUInt16LE(nameBuffer.byteLength, 26);
    localParts.push(local, nameBuffer, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.byteLength, 20);
    central.writeUInt32LE(content.byteLength, 24);
    central.writeUInt16LE(nameBuffer.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.byteLength + nameBuffer.byteLength + content.byteLength;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
