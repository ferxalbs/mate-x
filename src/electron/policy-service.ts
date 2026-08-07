import { createHmac, randomBytes } from "node:crypto";

import type { BehaviorMode } from "../contracts/behavior-mode";
import type {
  PolicyRunState,
  PolicyStop,
  PolicyStopAction,
  PolicyStopAttemptKind,
  ResolvePolicyStopRequest,
} from "../contracts/policy";
import type { WorkspaceTrustContract } from "../contracts/workspace";
import type { WorkStrategy } from "../contracts/work-objective";
import type {
  AgentCapability,
  ExecutionAuthorityContext,
} from "./capability-resolver";
import { redactSecretPayload, redactSensitiveText } from "./secret-redaction";

type CreatePolicyStopInput = {
  runId: string;
  workspaceId: string;
  workspacePath: string;
  toolName: string;
  requiredCapability: AgentCapability;
  operationArgs: Record<string, unknown>;
  severity: PolicyStop["severity"];
  policyId: string;
  title: string;
  explanation: string;
  kind: PolicyStopAttemptKind;
  target?: string;
  command?: string;
  metadata?: Record<string, unknown>;
  recommendation: PolicyStopAction;
  availableActions: PolicyStopAction[];
};

type RunExecutionContext = {
  workspaceId: string;
  workspacePath: string;
  behaviorMode: BehaviorMode;
  workStrategy?: WorkStrategy;
  resolvePolicy: () => Promise<{
    workspacePolicy: WorkspaceTrustContract;
    engineeringTaskStatus?: ExecutionAuthorityContext["engineeringTaskStatus"];
  }>;
  cancelled: boolean;
};

export type ApprovalConsumptionResult =
  | { consumed: true; stop: PolicyStop }
  | {
      consumed: false;
      reason:
        | "not_found"
        | "not_approved"
        | "run_mismatch"
        | "workspace_mismatch"
        | "operation_mismatch"
        | "run_inactive";
    };

/**
 * Stores pending-operation approval and live run context only. Capability
 * decisions remain exclusively in capability-resolver.ts.
 */
class PolicyService {
  private stops = new Map<string, PolicyStop>();
  private stopResolvers = new Map<
    string,
    {
      resolve: (stop: PolicyStop) => void;
      reject: (error: Error) => void;
      signal?: AbortSignal;
      onAbort?: () => void;
    }
  >();
  private runContexts = new Map<string, RunExecutionContext>();

  registerRunContext(input: {
    runId: string;
    workspaceId: string;
    workspacePath: string;
    behaviorMode: BehaviorMode;
    workStrategy?: WorkStrategy;
    resolvePolicy: RunExecutionContext["resolvePolicy"];
  }) {
    const existing = this.runContexts.get(input.runId);
    if (
      existing &&
      (existing.workspaceId !== input.workspaceId ||
        existing.workspacePath !== input.workspacePath)
    ) {
      throw new Error("Run execution context cannot change workspaces.");
    }
    this.runContexts.set(input.runId, {
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      behaviorMode:
        existing ? existing.behaviorMode : input.behaviorMode,
      workStrategy: existing ? existing.workStrategy : input.workStrategy,
      resolvePolicy: input.resolvePolicy,
      cancelled: existing?.cancelled ?? false,
    });
  }

  updateRunBehavior(runId: string, behaviorMode: BehaviorMode): boolean {
    const context = this.runContexts.get(runId);
    if (!context || context.cancelled) return false;
    context.behaviorMode = behaviorMode;
    return true;
  }

  async resolveCurrentAuthority(input: {
    runId: string;
    workspaceId: string;
    workspacePath: string;
  }): Promise<ExecutionAuthorityContext | null> {
    const context = this.runContexts.get(input.runId);
    if (
      !context ||
      context.cancelled ||
      context.workspaceId !== input.workspaceId ||
      context.workspacePath !== input.workspacePath
    ) {
      return null;
    }
    const current = await context.resolvePolicy();
    if (current.workspacePolicy.workspaceId !== context.workspaceId) {
      return null;
    }
    return {
      behaviorMode: context.behaviorMode,
      workStrategy: context.workStrategy,
      workspacePolicy: current.workspacePolicy,
      engineeringTaskStatus: current.engineeringTaskStatus,
    };
  }

  cancelRun(runId: string) {
    const context = this.runContexts.get(runId);
    if (context) context.cancelled = true;
    for (const stop of this.listStops(runId)) {
      if (stop.status === "open" || stop.status === "approved") {
        this.failStopAndRejectWaiter(stop.id, createPolicyAbortError());
      }
    }
  }

  closeRun(runId: string) {
    this.cancelRun(runId);
    this.runContexts.delete(runId);
  }

  createStop(input: CreatePolicyStopInput): PolicyStop {
    const stop: PolicyStop = {
      id: `policy-stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      runId: input.runId,
      workspacePath: input.workspacePath,
      createdAt: new Date().toISOString(),
      severity: input.severity,
      policyId: input.policyId,
      title: input.title,
      explanation: input.explanation,
      attemptedAction: {
        kind: input.kind,
        toolName: input.toolName,
        target: input.target === undefined ? undefined : redactSensitiveText(input.target),
        command: input.command === undefined ? undefined : redactSensitiveText(input.command),
        metadata: input.metadata === undefined ? undefined : redactSecretPayload(input.metadata),
      },
      operation: {
        workspaceId: input.workspaceId,
        operationName: input.toolName,
        requiredCapability: input.requiredCapability,
        fingerprint: fingerprintOperation({
          operationName: input.toolName,
          requiredCapability: input.requiredCapability,
          args: input.operationArgs,
        }),
      },
      recommendation: input.recommendation,
      availableActions: input.availableActions,
      status: "open",
    };
    this.stops.set(stop.id, stop);
    return stop;
  }

  listStops(runId?: string, workspaceId?: string) {
    const stops = Array.from(this.stops.values()).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
    return stops.filter(
      (stop) =>
        (!runId || stop.runId === runId) &&
        (!workspaceId || stop.operation.workspaceId === workspaceId),
    );
  }

  getRunState(runId: string): PolicyRunState {
    const openStops = this.listStops(runId).filter((stop) => stop.status === "open");
    return {
      runId,
      status: openStops.length > 0 ? "paused" : "clear",
      openStops,
    };
  }

  consumeApprovedOperation(input: {
    stopId: string;
    runId: string;
    workspaceId: string;
    workspacePath: string;
    operationName: string;
    requiredCapability: AgentCapability;
    args: Record<string, unknown>;
  }): ApprovalConsumptionResult {
    const stop = this.stops.get(input.stopId);
    if (!stop) return { consumed: false, reason: "not_found" };
    if (stop.status !== "approved") {
      return { consumed: false, reason: "not_approved" };
    }
    if (stop.runId !== input.runId) {
      return { consumed: false, reason: "run_mismatch" };
    }
    if (
      stop.workspacePath !== input.workspacePath ||
      stop.operation.workspaceId !== input.workspaceId
    ) {
      return { consumed: false, reason: "workspace_mismatch" };
    }
    const fingerprint = fingerprintOperation({
      operationName: input.operationName,
      requiredCapability: input.requiredCapability,
      args: input.args,
    });
    if (
      stop.operation.operationName !== input.operationName ||
      stop.operation.requiredCapability !== input.requiredCapability ||
      stop.operation.fingerprint !== fingerprint
    ) {
      return { consumed: false, reason: "operation_mismatch" };
    }
    const runContext = this.runContexts.get(input.runId);
    if (!runContext || runContext.cancelled) {
      return { consumed: false, reason: "run_inactive" };
    }
    const resumed = this.updateStopStatus(stop.id, "resumed");
    return resumed
      ? { consumed: true, stop: resumed }
      : { consumed: false, reason: "not_found" };
  }

  resolveStop(request: ResolvePolicyStopRequest): PolicyStop {
    if (!request || typeof request !== "object") {
      throw new Error("Policy stop resolution request is required.");
    }
    if (!isPolicyStopAction(request.action)) {
      throw new Error("Invalid policy stop resolution action.");
    }
    if (typeof request.stopId !== "string" || !request.stopId.trim()) {
      throw new Error("Policy stop id is required.");
    }

    const stop = this.stops.get(request.stopId);
    if (!stop) throw new Error("Policy stop not found.");
    if (
      request.runId !== stop.runId ||
      request.workspaceId !== stop.operation.workspaceId ||
      request.operationFingerprint !== stop.operation.fingerprint
    ) {
      throw new Error("Policy stop resolution context does not match the pending operation.");
    }
    if (stop.status !== "open") return stop;

    const resolvedStop: PolicyStop = {
      ...stop,
      status: request.action === "approve_once" ? "approved" : "declined",
      resolution: {
        action: request.action,
        resolvedAt: new Date().toISOString(),
        scopeExpansion: request.scopeExpansion,
      },
    };
    this.stops.set(stop.id, resolvedStop);

    const resolver = this.stopResolvers.get(stop.id);
    if (resolver) {
      this.stopResolvers.delete(stop.id);
      if (resolver.signal && resolver.onAbort) {
        resolver.signal.removeEventListener("abort", resolver.onAbort);
      }
      resolver.resolve(resolvedStop);
    }
    return resolvedStop;
  }

  waitForResolution(stopId: string, signal?: AbortSignal): Promise<PolicyStop> {
    const stop = this.stops.get(stopId);
    if (!stop) return Promise.reject(new Error("Policy stop not found."));
    if (stop.status !== "open") return Promise.resolve(stop);
    if (signal?.aborted) return Promise.reject(createPolicyAbortError());

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const current = this.stopResolvers.get(stopId);
        if (current?.onAbort !== onAbort) return;
        this.stopResolvers.delete(stopId);
        reject(createPolicyAbortError());
      };
      this.stopResolvers.set(stopId, { resolve, reject, signal, onAbort });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  markStopCompleted(stopId: string) {
    return this.updateStopStatus(stopId, "completed");
  }

  markStopFailed(stopId: string) {
    return this.updateStopStatus(stopId, "failed");
  }

  private failStopAndRejectWaiter(stopId: string, error: Error) {
    this.updateStopStatus(stopId, "failed");
    const resolver = this.stopResolvers.get(stopId);
    if (!resolver) return;
    this.stopResolvers.delete(stopId);
    if (resolver.signal && resolver.onAbort) {
      resolver.signal.removeEventListener("abort", resolver.onAbort);
    }
    resolver.reject(error);
  }

  private updateStopStatus(stopId: string, status: PolicyStop["status"]) {
    const stop = this.stops.get(stopId);
    if (!stop) return null;
    const nextStop = { ...stop, status };
    this.stops.set(stopId, nextStop);
    return nextStop;
  }
}

function isPolicyStopAction(action: string): action is PolicyStopAction {
  return (
    action === "approve_once" ||
    action === "expand_scope" ||
    action === "abort" ||
    action === "safer_alternative"
  );
}

function createPolicyAbortError() {
  const error = new Error("Policy approval wait was cancelled.");
  error.name = "AbortError";
  return error;
}

export const policyService = new PolicyService();

// Approval fingerprints bind the exact in-memory operation without retaining
// raw credentials in policy stops or renderer-visible metadata.
const OPERATION_FINGERPRINT_KEY = randomBytes(32);

export function fingerprintOperation(input: {
  operationName: string;
  requiredCapability: string;
  args: Record<string, unknown>;
}): string {
  const serialized = stableJson(input);
  return createHmac("sha256", OPERATION_FINGERPRINT_KEY)
    .update(serialized)
    .digest("hex");
}

function stableJson(value: unknown): string {
  return stableJsonValue(value, new WeakSet<object>());
}

function stableJsonValue(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Approval operation arguments must contain finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new Error("Approval operation arguments must be JSON-compatible.");
  }
  if (ancestors.has(value)) {
    throw new Error("Approval operation arguments must not contain cycles.");
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) {
      throw new Error("Approval operation argument arrays must not be sparse.");
    }
    const serialized = `[${value
      .map((entry) => stableJsonValue(entry, ancestors))
      .join(",")}]`;
    ancestors.delete(value);
    return serialized;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Approval operation arguments must use plain objects.");
  }
  const record = value as Record<string, unknown>;
  const serialized = `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonValue(record[key], ancestors)}`)
    .join(",")}}`;
  ancestors.delete(value);
  return serialized;
}
