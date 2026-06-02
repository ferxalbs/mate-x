import {
  FilesSdkClient,
  FilesSdkFactory,
  FilesSdkHooks,
  MaTeXStorageAdapterOptions,
  StorageBackendConfig,
  StorageBackendType,
  StorageDownloadOptions,
  StorageEvent,
  StorageListItem,
  StorageListOptions,
  StorageOperationResult,
  StorageOperationType,
  StorageUploadOptions,
} from "../../contracts/storage-adapter.types";

export class MaTeXStorageError extends Error {
  readonly code: string;
  readonly operation: StorageOperationType;
  readonly path: string;
  readonly cause: unknown;

  constructor(input: {
    code: string;
    message: string;
    operation: StorageOperationType;
    path: string;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = "MaTeXStorageError";
    this.code = input.code;
    this.operation = input.operation;
    this.path = input.path;
    this.cause = input.cause;
  }
}

export class StorageSecretLeakError extends MaTeXStorageError {
  readonly categories: string[];

  constructor(input: { path: string; categories: string[] }) {
    super({
      code: "STORAGE_SECRET_LEAK",
      message: `Privacy Sentinel blocked upload for ${input.path}. Categories: ${input.categories.join(", ")}`,
      operation: "upload",
      path: input.path,
    });
    this.name = "StorageSecretLeakError";
    this.categories = input.categories;
  }
}

export class StorageRateLimitError extends MaTeXStorageError {
  constructor(input: { operation: StorageOperationType; path: string }) {
    super({
      code: "STORAGE_RATE_LIMITED",
      message: `Storage operation ${input.operation} for ${input.path} was rate-limited.`,
      operation: input.operation,
      path: input.path,
    });
    this.name = "StorageRateLimitError";
  }
}

export class DefaultFilesSdkFactory implements FilesSdkFactory {
  async create(config: StorageBackendConfig, hooks: FilesSdkHooks): Promise<FilesSdkClient> {
    const filesModule = await import("files-sdk");
    const FilesCtor = getExportedFunction(filesModule, "Files");
    const adapter = await createProviderAdapter(config);
    const client = new FilesCtor({ adapter, hooks }) as unknown;
    return assertFilesSdkClient(client);
  }
}

export class MaTeXStorageAdapter {
  private readonly options: MaTeXStorageAdapterOptions;

  constructor(options: MaTeXStorageAdapterOptions) {
    this.options = options;
  }

  static async create(input: Omit<MaTeXStorageAdapterOptions, "files"> & { factory?: FilesSdkFactory }) {
    const factory = input.factory ?? new DefaultFilesSdkFactory();
    const files = await factory.create(input.backend, {
      onAction: async (event) => {
        await input.agentProfiler?.recordStorageOperation({
          backendType: input.backend.backend,
          operation: normalizeOperation(event.type),
          durationMs: event.durationMs,
          success: event.status === "success",
        });
      },
      onError: async (event) => {
        await input.failureMemory.recordFailure({
          workspaceId: input.workspaceId,
          command: `storage:${normalizeOperation(event.type)}`,
          output: stringifyError(event.error),
          errorSignature: `storage:${input.backend.backend}:${normalizeOperation(event.type)}:${errorCode(event.error)}`,
        });
      },
    });
    return new MaTeXStorageAdapter({ ...input, files });
  }

  get backendType(): StorageBackendType {
    return this.options.backend.backend;
  }

  async uploadFile(
    path: string,
    body: string | Uint8Array | ArrayBuffer | Blob,
    options: StorageUploadOptions = {},
  ): Promise<StorageOperationResult> {
    if (options.overwrite) {
      await this.options.approvalGate.requireApproval({
        operation: "overwriteFile",
        path,
        reason: "Overwriting a remote object is destructive.",
        allowHighImpact: options.allowHighImpact,
      });
    }

    return this.execute("upload", path, byteLength(body), async () => {
      const scan = await this.options.privacySentinel.scan(await bodyToScanInput(body));
      if (scan.hasSecrets) {
        const error = new StorageSecretLeakError({ path, categories: scan.categories });
        await this.recordEvent({
          type: "BLOCKED_UPLOAD",
          operation: "upload",
          path,
          sizeBytes: byteLength(body),
          durationMs: 0,
          status: "blocked",
          timestamp: this.nowIso(),
          backendType: this.backendType,
          errorCode: error.code,
          errorMessage: error.message,
          secretCategories: scan.categories,
        });
        throw error;
      }

      const result = await this.options.files.upload(path, body, {
        contentType: options.contentType,
        metadata: options.metadata,
      });
      return {
        key: path,
        url: extractUrl(result),
        sizeBytes: byteLength(body),
      };
    });
  }

  async downloadFile(path: string, options: StorageDownloadOptions = {}): Promise<string | Uint8Array> {
    return this.execute("download", path, 0, async () => {
      const result = await this.options.files.download(path, { ...options });
      if (options.as === "text") {
        return await resultToText(result);
      }
      return await resultToBytes(result);
    });
  }

  async deleteFile(path: string, allowHighImpact?: boolean): Promise<void> {
    await this.options.approvalGate.requireApproval({
      operation: "deleteFile",
      path,
      reason: "Deleting a remote object is destructive.",
      allowHighImpact,
    });
    await this.execute("delete", path, 0, async () => {
      await this.options.files.delete(path);
    });
  }

  async listFiles(options: StorageListOptions = {}): Promise<StorageListItem[]> {
    return this.execute("list", options.prefix ?? "", 0, async () => {
      const result = await this.options.files.list({ ...options });
      return normalizeListResult(result);
    });
  }

  private async execute<T>(
    operation: StorageOperationType,
    path: string,
    sizeBytes: number,
    action: () => Promise<T>,
  ): Promise<T> {
    const allowed = await this.options.rateLimiter.check({
      operation,
      workspaceId: this.options.workspaceId,
      path,
    });
    if (!allowed) {
      const error = new StorageRateLimitError({ operation, path });
      await this.recordFailure(operation, path, sizeBytes, 0, error);
      throw error;
    }

    const started = performance.now();
    try {
      const result = await action();
      const durationMs = elapsedMs(started);
      await this.recordEvent({
        type: "STORAGE_OPERATION",
        operation,
        path,
        sizeBytes,
        durationMs,
        status: "success",
        timestamp: this.nowIso(),
        backendType: this.backendType,
      });
      await this.options.agentProfiler?.recordStorageOperation({
        backendType: this.backendType,
        operation,
        durationMs,
        success: true,
      });
      return result;
    } catch (cause) {
      const error = cause instanceof MaTeXStorageError
        ? cause
        : new MaTeXStorageError({
            code: errorCode(cause),
            message: `Storage operation ${operation} failed for ${path}.`,
            operation,
            path,
            cause,
          });
      await this.recordFailure(operation, path, sizeBytes, elapsedMs(started), error);
      throw error;
    }
  }

  private async recordFailure(
    operation: StorageOperationType,
    path: string,
    sizeBytes: number,
    durationMs: number,
    error: MaTeXStorageError,
  ) {
    await this.recordEvent({
      type: error instanceof StorageSecretLeakError ? "BLOCKED_UPLOAD" : "STORAGE_OPERATION",
      operation,
      path,
      sizeBytes,
      durationMs,
      status: error instanceof StorageSecretLeakError ? "blocked" : "failure",
      timestamp: this.nowIso(),
      backendType: this.backendType,
      errorCode: error.code,
      errorMessage: error.message,
      secretCategories: error instanceof StorageSecretLeakError ? error.categories : undefined,
    });
    await this.options.failureMemory.recordFailure({
      workspaceId: this.options.workspaceId,
      command: `storage:${operation}`,
      output: error.message,
      errorSignature: `storage:${this.backendType}:${operation}:${error.code}`.toLowerCase(),
      stackTraceExcerpt: typeof error.stack === "string" ? error.stack.slice(0, 600) : undefined,
    });
    await this.options.agentProfiler?.recordStorageOperation({
      backendType: this.backendType,
      operation,
      durationMs,
      success: false,
    });
  }

  private async recordEvent(event: StorageEvent) {
    await this.options.evidenceRecorder.appendStorageEvent(event);
  }

  private nowIso() {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }
}

async function createProviderAdapter(config: StorageBackendConfig) {
  const moduleName = providerModuleName(config.backend);
  const providerModule = await import(moduleName);
  const providerFactory = getProviderFactory(providerModule, config.backend);
  return providerFactory({
    bucket: config.bucket,
    region: config.region,
    ...(config.credentials ?? {}),
  });
}

function providerModuleName(backend: StorageBackendType) {
  if (backend === "vercel") return "files-sdk/vercel-blob";
  return `files-sdk/${backend}`;
}

function getProviderFactory(moduleValue: unknown, backend: StorageBackendType) {
  const exports = asRecord(moduleValue);
  const preferredName = backend === "vercel" ? "vercelBlob" : backend;
  const preferred = exports[preferredName];
  if (typeof preferred === "function") {
    return preferred as (config: Record<string, unknown>) => unknown;
  }
  const firstFunction = Object.values(exports).find((value) => typeof value === "function");
  if (typeof firstFunction === "function") {
    return firstFunction as (config: Record<string, unknown>) => unknown;
  }
  throw new MaTeXStorageError({
    code: "STORAGE_ADAPTER_UNAVAILABLE",
    message: `files-sdk adapter for ${backend} is unavailable.`,
    operation: "upload",
    path: "",
  });
}

function getExportedFunction(moduleValue: unknown, name: string) {
  const value = asRecord(moduleValue)[name];
  if (typeof value !== "function") {
    throw new MaTeXStorageError({
      code: "STORAGE_SDK_UNAVAILABLE",
      message: `files-sdk export ${name} is unavailable.`,
      operation: "upload",
      path: "",
    });
  }
  return value as new (input: Record<string, unknown>) => unknown;
}

function assertFilesSdkClient(value: unknown): FilesSdkClient {
  const record = asRecord(value);
  for (const method of ["upload", "download", "delete", "list"] as const) {
    if (typeof record[method] !== "function") {
      throw new MaTeXStorageError({
        code: "STORAGE_SDK_INVALID_CLIENT",
        message: `files-sdk client is missing ${method}.`,
        operation: "upload",
        path: "",
      });
    }
  }
  return value as FilesSdkClient;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizeOperation(type: string): StorageOperationType {
  if (type.includes("download")) return "download";
  if (type.includes("delete")) return "delete";
  if (type.includes("list")) return "list";
  if (type.includes("sync")) return "sync";
  if (type.includes("overwrite")) return "overwrite";
  return "upload";
}

function byteLength(body: string | Uint8Array | ArrayBuffer | Blob) {
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return body.size;
}

async function bodyToScanInput(body: string | Uint8Array | ArrayBuffer | Blob): Promise<string | Uint8Array> {
  if (typeof body === "string" || body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(await body.arrayBuffer());
}

async function resultToText(result: unknown): Promise<string> {
  if (typeof result === "string") return result;
  if (result instanceof Uint8Array) return Buffer.from(result).toString("utf8");
  if (result instanceof ArrayBuffer) return Buffer.from(result).toString("utf8");
  if (result instanceof Blob) return result.text();
  const record = asRecord(result);
  if (typeof record.text === "function") {
    const text = await record.text();
    return typeof text === "string" ? text : String(text);
  }
  return JSON.stringify(result);
}

async function resultToBytes(result: unknown): Promise<Uint8Array> {
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (typeof result === "string") return new TextEncoder().encode(result);
  if (result instanceof Blob) return new Uint8Array(await result.arrayBuffer());
  const record = asRecord(result);
  if (typeof record.arrayBuffer === "function") {
    const buffer = await record.arrayBuffer();
    return buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new TextEncoder().encode(String(buffer));
  }
  return new TextEncoder().encode(JSON.stringify(result));
}

function normalizeListResult(result: unknown): StorageListItem[] {
  const record = asRecord(result);
  const source: unknown[] = Array.isArray(result)
    ? result
    : Array.isArray(record.items)
      ? record.items
      : [];
  return source.map((item) => {
    const itemRecord = asRecord(item);
    return {
      key: String(itemRecord.key ?? itemRecord.path ?? itemRecord.name ?? ""),
      size: typeof itemRecord.size === "number" ? itemRecord.size : undefined,
      updatedAt: typeof itemRecord.updatedAt === "string" ? itemRecord.updatedAt : undefined,
      url: typeof itemRecord.url === "string" ? itemRecord.url : undefined,
    };
  }).filter((item) => item.key.length > 0);
}

function extractUrl(result: unknown) {
  const record = asRecord(result);
  return typeof record.url === "string" ? record.url : undefined;
}

function errorCode(error: unknown) {
  if (error instanceof MaTeXStorageError) return error.code;
  const record = asRecord(error);
  if (typeof record.code === "string") return record.code;
  if (typeof record.name === "string") return record.name;
  return "STORAGE_SDK_ERROR";
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message;
  return JSON.stringify(error);
}

function elapsedMs(started: number) {
  return Math.max(0, Math.round(performance.now() - started));
}
