import { createHash } from "node:crypto";

import type {
  AgentAction,
  AgentActionRequest,
  AgentCapabilityStats,
  AgentId,
  AgentSdkClient,
  AgentSdkResult,
  SDKOrchestratorConfig,
  SDKOrchestratorDependencies,
  SDKOrchestratorResult,
  ToolExecutionEvent,
  RoutingRecommendations,
} from "../../contracts/sdk-orchestrator.types";

const AGENTS: AgentId[] = ["codex", "cursor", "antigravity"];
const DEFAULT_MIN_VTS = 0.85;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_ROUTING_WINDOW_SIZE = 10;

interface ActionMetric {
  actionType: string;
  agentId: AgentId;
  success: boolean;
  durationMs: number;
  vts: number;
}

export interface SDKOrchestratorExecutionContext {
  evidenceRecorder?: SDKOrchestratorDependencies["evidenceRecorder"];
  failureMemory?: SDKOrchestratorDependencies["failureMemory"];
  confirmHighImpact?: SDKOrchestratorDependencies["confirmHighImpact"];
}

export class PrivacySentinelBlockError extends Error {
  readonly code = "PRIVACY_SENTINEL_BLOCK";
  readonly categories: string[];

  constructor(categories: string[]) {
    super(`Privacy Sentinel blocked SDK call. Categories: ${categories.join(", ")}`);
    this.name = "PrivacySentinelBlockError";
    this.categories = categories;
  }
}

export class HighImpactApprovalError extends Error {
  readonly code = "HIGH_IMPACT_APPROVAL_DENIED";

  constructor() {
    super("High-impact agent action was not approved.");
    this.name = "HighImpactApprovalError";
  }
}

export class CriticLoopExhaustedError extends Error {
  readonly code = "CRITIC_LOOP_EXHAUSTED";
  readonly lastVTS: number;

  constructor(lastVTS: number) {
    super(`Critic Loop exhausted retries with VTS ${lastVTS}.`);
    this.name = "CriticLoopExhaustedError";
    this.lastVTS = lastVTS;
  }
}

export class SDKOrchestratorError extends Error {
  readonly code: string;
  readonly cause: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "SDKOrchestratorError";
    this.code = code;
    this.cause = cause;
  }
}

export class SDKOrchestrator {
  private readonly clients: Record<AgentId, AgentSdkClient>;
  private readonly routingTable: RoutingRecommendations = {};
  private readonly metrics: ActionMetric[] = [];

  constructor(private readonly deps: SDKOrchestratorDependencies) {
    this.clients = {
      codex: deps.codexClient,
      cursor: deps.cursorClient,
      antigravity: deps.antigravityClient,
    };
  }

  async execute(request: AgentActionRequest, context: SDKOrchestratorExecutionContext = {}): Promise<SDKOrchestratorResult> {
    const action = this.resolveAction(request);
    const payloadHash = sha256(canonicalJson(action.payload));
    const privacyScan = await this.deps.privacySentinel.scan(canonicalJson(action.payload));
    if (privacyScan.hasSecrets) {
      const error = new PrivacySentinelBlockError(privacyScan.categories);
      await this.evidenceRecorder(context).appendAgentActionEvent({
        type: "AGENT_ACTION_BLOCKED",
        agentId: action.agentId,
        actionType: action.actionType,
        timestamp: this.nowIso(),
        payloadHash,
        detectedCategories: privacyScan.categories,
        errorCode: error.code,
        errorMessage: error.message,
      });
      await this.recordFailure(
        action,
        `${action.agentId}:PRIVACY_BLOCK:${privacyScan.categories.join(",")}`,
        error.message,
        context,
      );
      throw error;
    }

    if (action.allowHighImpact === true) {
      const approved = await (context.confirmHighImpact ?? this.deps.confirmHighImpact)(action);
      if (!approved) {
        throw new HighImpactApprovalError();
      }
    }

    return this.executeWithCriticLoop(action, payloadHash, context);
  }

  getRoutingRecommendations(): RoutingRecommendations {
    return { ...this.routingTable };
  }

  getCapabilityStats(): Record<AgentId, AgentCapabilityStats> {
    return Object.fromEntries(AGENTS.map((agentId) => [agentId, this.statsFor(agentId)])) as Record<AgentId, AgentCapabilityStats>;
  }

  private async executeWithCriticLoop(
    action: AgentAction,
    payloadHash: string,
    context: SDKOrchestratorExecutionContext,
  ): Promise<SDKOrchestratorResult> {
    const maxRetries = configNumber(this.deps.config?.criticLoop?.maxRetries, DEFAULT_MAX_RETRIES);
    const minVTS = configNumber(this.deps.config?.criticLoop?.minVTS, DEFAULT_MIN_VTS);
    let lastVTS = 0;

    for (let retryCount = 0; retryCount <= maxRetries; retryCount += 1) {
      const started = performance.now();
      await this.evidenceRecorder(context).appendAgentActionEvent({
        type: "AGENT_ACTION_PENDING",
        agentId: action.agentId,
        actionType: action.actionType,
        timestamp: this.nowIso(),
        payloadHash,
        retryCount,
      });

      try {
        const sdkResult = await this.withTimeout(this.clients[action.agentId].execute(action), action);
        const durationMs = elapsedMs(started);
        const vts = computeVTS(sdkResult.tool_execution_events ?? []);
        lastVTS = vts;
        const outputHash = sha256(canonicalJson(sdkResult.output));
        await this.evidenceRecorder(context).appendAgentActionEvent({
          type: "AGENT_ACTION_COMPLETED",
          agentId: action.agentId,
          actionType: action.actionType,
          timestamp: this.nowIso(),
          payloadHash,
          outputHash,
          durationMs,
          vts,
          retryCount,
        });
        this.recordMetric(action, true, durationMs, vts);

        if (vts >= minVTS) {
          return {
            agentId: action.agentId,
            actionType: action.actionType,
            output: sdkResult.output,
            outputHash,
            vts,
            durationMs,
            retryCount,
          };
        }
      } catch (error) {
        const durationMs = elapsedMs(started);
        const code = errorCode(error);
        await this.evidenceRecorder(context).appendAgentActionEvent({
          type: "AGENT_ACTION_FAILED",
          agentId: action.agentId,
          actionType: action.actionType,
          timestamp: this.nowIso(),
          payloadHash,
          durationMs,
          retryCount,
          errorCode: code,
          errorMessage: errorMessage(error),
        });
        this.recordMetric(action, false, durationMs, 0);
        await this.recordFailure(
          action,
          `${action.agentId}:${action.actionType}:${code}`,
          errorMessage(error),
          context,
        );
        throw error instanceof SDKOrchestratorError ? error : new SDKOrchestratorError(code, errorMessage(error), error);
      }
    }

    const error = new CriticLoopExhaustedError(lastVTS);
    await this.evidenceRecorder(context).appendAgentActionEvent({
      type: "CRITIC_LOOP_EXHAUSTED",
      agentId: action.agentId,
      actionType: action.actionType,
      timestamp: this.nowIso(),
      payloadHash,
      vts: lastVTS,
      errorCode: error.code,
      errorMessage: error.message,
    });
    await this.recordFailure(action, `${action.agentId}:${action.actionType}:${error.code}`, error.message, context);
    throw error;
  }

  private resolveAction(request: AgentActionRequest): AgentAction {
    const defaultAgent = this.deps.config?.defaultAgent ?? "codex";
    const autoRoute = this.deps.config?.routing?.autoRoute ?? true;
    const routedAgent = autoRoute ? this.routingTable[request.actionType] : undefined;
    return {
      agentId: request.agentId ?? routedAgent ?? defaultAgent,
      actionType: request.actionType,
      payload: request.payload,
      allowHighImpact: request.allowHighImpact,
    };
  }

  private async withTimeout(call: Promise<AgentSdkResult>, action: AgentAction): Promise<AgentSdkResult> {
    const timeoutMs = this.deps.config?.timeoutMs;
    if (!timeoutMs || timeoutMs <= 0) return call;
    return Promise.race([
      call,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new SDKOrchestratorError("TIMEOUT", `Agent action ${action.actionType} timed out.`));
        }, timeoutMs);
      }),
    ]);
  }

  private evidenceRecorder(context: SDKOrchestratorExecutionContext) {
    return context.evidenceRecorder ?? this.deps.evidenceRecorder;
  }

  private failureMemory(context: SDKOrchestratorExecutionContext) {
    return context.failureMemory ?? this.deps.failureMemory;
  }

  private async recordFailure(
    action: AgentAction,
    errorSignature: string,
    output: string,
    context: SDKOrchestratorExecutionContext,
  ) {
    await this.failureMemory(context).recordFailure({
      workspaceId: this.deps.workspaceId,
      command: `sdk:${action.agentId}:${action.actionType}`,
      output,
      errorSignature,
    });
  }

  private recordMetric(action: AgentAction, success: boolean, durationMs: number, vts: number) {
    this.metrics.push({
      actionType: action.actionType,
      agentId: action.agentId,
      success,
      durationMs,
      vts,
    });
    this.trimMetrics();
    this.updateRouting(action.actionType);
  }

  private trimMetrics() {
    const windowSize = configNumber(this.deps.config?.routing?.routingWindowSize, DEFAULT_ROUTING_WINDOW_SIZE);
    const maxMetrics = AGENTS.length * Math.max(windowSize, DEFAULT_ROUTING_WINDOW_SIZE) * 20;
    if (this.metrics.length > maxMetrics) {
      this.metrics.splice(0, this.metrics.length - maxMetrics);
    }
  }

  private updateRouting(actionType: string) {
    const actionMetrics = this.metrics.filter((metric) => metric.actionType === actionType);
    if (actionMetrics.length < DEFAULT_ROUTING_WINDOW_SIZE) return;
    const candidate = AGENTS
      .map((agentId) => ({ agentId, stats: this.statsFor(agentId, actionType) }))
      .filter((candidate) => candidate.stats.sampleSize > 0)
      .sort((a, b) => b.stats.successRate - a.stats.successRate || b.stats.avgVTS - a.stats.avgVTS)[0];
    if (candidate) {
      this.routingTable[actionType] = candidate.agentId;
    }
  }

  private statsFor(agentId: AgentId, actionType?: string): AgentCapabilityStats {
    const windowSize = configNumber(this.deps.config?.routing?.routingWindowSize, DEFAULT_ROUTING_WINDOW_SIZE);
    const relevant = this.metrics
      .filter((metric) => metric.agentId === agentId && (!actionType || metric.actionType === actionType))
      .slice(-windowSize);
    if (relevant.length === 0) {
      return { successRate: 0, avgDurationMs: 0, avgVTS: 0, sampleSize: 0 };
    }
    return {
      successRate: relevant.filter((metric) => metric.success).length / relevant.length,
      avgDurationMs: average(relevant.map((metric) => metric.durationMs)),
      avgVTS: average(relevant.map((metric) => metric.vts)),
      sampleSize: relevant.length,
    };
  }

  private nowIso() {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }
}

export function computeVTS(events: ToolExecutionEvent[]): number {
  if (events.length === 0) return 0;
  const successes = events.filter((event) => event.status === "success").length;
  const completed = events.filter((event) => event.status !== "failed" && event.status !== "error").length;
  return Math.max(0, Math.min(1, (successes + completed) / (events.length * 2)));
}

function configNumber(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value)) ?? "null";
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function elapsedMs(started: number) {
  return Math.max(0, Math.round(performance.now() - started));
}

function errorCode(error: unknown) {
  if (error instanceof SDKOrchestratorError) return error.code;
  if (error instanceof Error) {
    const codedError = error as Error & { code?: unknown };
    if (typeof codedError.code === "string") {
      return codedError.code;
    }
    return error.name;
  }
  return "SDK_ERROR";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : JSON.stringify(error);
}
