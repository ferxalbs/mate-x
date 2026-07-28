import { createHash } from "node:crypto";

import {
  RainyClient,
  SDK_VERSION,
  type ObserveOptions,
  type RainyClientOptions,
  type Severity,
} from "rainy-sdk-ts";
import { z } from "zod";

import {
  TELEMETRY_OPERATION_NAMES,
  type RendererTelemetryMessage,
  type SafeTelemetryAttributes,
  type TelemetryOperationName,
} from "../contracts/telemetry";

const MAX_ATTRIBUTE_LENGTH = 120;
const operationNameSchema = z.enum(TELEMETRY_OPERATION_NAMES);
const attributesSchema = z
  .object({
    feature: z.string().trim().min(1).max(MAX_ATTRIBUTE_LENGTH).optional(),
    category: z.string().trim().min(1).max(MAX_ATTRIBUTE_LENGTH).optional(),
    providerFamily: z.string().trim().min(1).max(MAX_ATTRIBUTE_LENGTH).optional(),
    model: z.string().trim().min(1).max(MAX_ATTRIBUTE_LENGTH).optional(),
    status: z.enum(["success", "cancelled", "failure"]).optional(),
    fileCountBucket: z.enum(["none", "1-10", "11-100", "101+"]).optional(),
  })
  .strict();
const rendererTelemetryMessageSchema = z
  .object({
    name: operationNameSchema,
    attributes: attributesSchema.optional(),
  })
  .strict();

export interface TelemetryClient {
  telemetry: {
    track: (name: string, attributes?: Record<string, unknown>) => void;
    captureError: (
      error: unknown,
      context?: {
        context?: string;
        severity?: Severity;
        tags?: string[];
        extra?: Record<string, unknown>;
      },
    ) => void;
    observe: <T>(
      name: string,
      operation: () => T | PromiseLike<T>,
      options?: ObserveOptions<T>,
    ) => Promise<T>;
  };
  destroy: () => Promise<unknown>;
}

export interface TelemetryServiceDependencies {
  createClient: (options: RainyClientOptions) => TelemetryClient;
}

export interface TelemetryInitialization {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  clientId: string;
  appVersion: string;
  osFamily: "macos" | "windows" | "other";
}

export function parseRendererTelemetryMessage(
  value: unknown,
): RendererTelemetryMessage {
  return rendererTelemetryMessageSchema.parse(value);
}

export function bucketFileCount(count: number): SafeTelemetryAttributes["fileCountBucket"] {
  if (!Number.isFinite(count) || count <= 0) return "none";
  if (count <= 10) return "1-10";
  if (count <= 100) return "11-100";
  return "101+";
}

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return "unknown";
  }
  const code = String((error as { code?: unknown }).code);
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? code : "unknown";
}

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name)
    ? error.name
    : "Error";
}

export function sanitizeApplicationError(error: unknown): Error & {
  code: string;
  fingerprint: string;
} {
  const name = safeErrorName(error);
  const code = safeErrorCode(error);
  const fingerprint = createHash("sha256")
    .update(`${name}:${code}`)
    .digest("hex")
    .slice(0, 24);
  const sanitized = new Error(`${name}:${code}`) as Error & {
    code: string;
    fingerprint: string;
  };
  sanitized.name = name;
  sanitized.code = code;
  sanitized.fingerprint = fingerprint;
  sanitized.stack = undefined;
  return sanitized;
}

export class MateTelemetryService {
  private client: TelemetryClient | null = null;
  private initializing: Promise<void> | null = null;
  private enabled = false;
  private runtimeAttributes: Record<string, string> = {};

  constructor(
    private readonly dependencies: TelemetryServiceDependencies = {
      createClient: (options) => new RainyClient(options),
    },
  ) {}

  initialize(config: TelemetryInitialization): Promise<void> {
    if (!config.enabled || this.client) {
      this.enabled = config.enabled && this.client !== null;
      return Promise.resolve();
    }
    if (this.initializing) return this.initializing;

    this.initializing = Promise.resolve()
      .then(() => {
        this.runtimeAttributes = {
          appVersion: config.appVersion,
          sdkVersion: SDK_VERSION,
          osFamily: config.osFamily,
        };
        this.client = this.dependencies.createClient({
          clientId: config.clientId,
          apiKey: config.apiKey,
          endpoint: config.endpoint,
          delivery: "remote",
          telemetry: {
            sessionTracking: true,
            maxStringBytes: 512,
            maxEventNameLength: 128,
            builtInScrubbers: true,
          },
        });
        this.enabled = true;
      })
      .catch(() => {
        this.client = null;
        this.enabled = false;
      })
      .finally(() => {
        this.initializing = null;
      });
    return this.initializing;
  }

  track(name: TelemetryOperationName, attributes: SafeTelemetryAttributes = {}): void {
    if (!this.enabled || !this.client) return;
    this.client.telemetry.track(name, {
      ...this.runtimeAttributes,
      ...attributesSchema.parse(attributes),
    });
  }

  async observe<T>(
    name: TelemetryOperationName,
    operation: () => T | PromiseLike<T>,
    options: {
      kind?: "llm" | "embedding" | "tool" | "workflow" | "custom";
      attributes?: SafeTelemetryAttributes;
    } = {},
  ): Promise<T> {
    if (!this.enabled || !this.client) {
      return await operation();
    }
    const outcome: {
      status: "pending" | "success" | "failure";
      value?: T;
      error?: unknown;
    } = { status: "pending" };
    try {
      return await this.client.telemetry.observe(
        name,
        async () => {
          try {
            const value = await operation();
            outcome.status = "success";
            outcome.value = value;
            return value;
          } catch (error) {
            outcome.status = "failure";
            outcome.error = error;
            throw error;
          }
        },
        {
          kind: options.kind,
          attributes: {
            ...this.runtimeAttributes,
            ...attributesSchema.parse(options.attributes ?? {}),
          },
          trackStart: true,
          captureError: false,
        },
      );
    } catch (_telemetryError) {
      if (outcome.status === "success") return outcome.value as T;
      if (outcome.status === "failure") throw outcome.error;
      return await operation();
    }
  }

  captureError(
    error: unknown,
    input: {
      operation: TelemetryOperationName;
      severity?: Severity;
    },
  ): void {
    if (!this.enabled || !this.client) return;
    const sanitized = sanitizeApplicationError(error);
    this.client.telemetry.captureError(sanitized, {
      context: input.operation,
      severity: input.severity ?? "error",
      tags: ["mate-x", input.operation],
      extra: {
        code: sanitized.code,
        fingerprint: sanitized.fingerprint,
        ...this.runtimeAttributes,
      },
    });
  }

  async disable(): Promise<void> {
    this.enabled = false;
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.destroy();
    } catch {
      // Telemetry opt-out must always succeed for product behavior.
    }
  }

  async shutdown(): Promise<void> {
    await this.disable();
  }
}

export const telemetryService = new MateTelemetryService();
