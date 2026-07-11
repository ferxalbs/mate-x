/**
 * Production Rainy-backed execution runner for EngineeringTask leases.
 * Never returns success without structured provider outcome.
 * Free-form model prose is never authoritative evidence.
 * NES-4 / CLOSURE 1
 */

import {
  RAINY_API_BASE_URL,
  RAINY_REQUEST_TIMEOUT_MS,
} from '../../config/rainy';
import type { CanonicalAgentScope, StructuredExecutionEvent } from './rainy-adapter';
import type { TaskNode } from '../../contracts/engineering-task';
import { nowIso } from './ids';

export type RainyExecutionStatus =
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'timeout'
  | 'partial';

export type RainyErrorClass =
  | 'missing_credentials'
  | 'provider_failure'
  | 'timeout'
  | 'cancelled'
  | 'network'
  | 'stale_head'
  | 'stale_lease'
  | 'policy'
  | 'internal'
  | 'unknown';

export interface RainyScopedRequest {
  engineeringTaskId: string;
  graphTaskId: string;
  leaseId: string;
  workspaceId: string;
  baseSha: string;
  headSha: string;
  diffHash: string;
  specificationVersion: number;
  planVersion: number;
  taskGraphVersion: number;
  writePaths: string[];
  readPaths: string[];
  objective: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RainyScopedResponse {
  status: RainyExecutionStatus;
  touchedPaths: string[];
  toolsInvoked: Array<{ toolName: string; summary: string; at: string }>;
  commandsRequested: string[];
  commandResults: Array<{
    command: string;
    exitCode: number | null;
    at: string;
  }>;
  events: StructuredExecutionEvent[];
  errorClass?: RainyErrorClass;
  errorMessage?: string;
  provider?: string;
  model?: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  costUsd?: number | null;
  cancelled: boolean;
  /** Explicitly non-authoritative — strip before evidence */
  modelProse?: string;
  repositoryMutationRecord?: {
    baseSha: string;
    headShaBefore: string;
    headShaAfter: string | null;
    diffHashBefore: string;
    mutated: boolean;
  };
}

export type RainyTransport = (
  request: RainyScopedRequest,
  apiKey: string,
) => Promise<RainyScopedResponse>;

export interface ProductionRainyRunnerDeps {
  getApiKey: () => string | null | undefined;
  transport?: RainyTransport;
  /** Optional HEAD re-check during/after execution */
  resolveCurrentHeadSha?: (workspaceId: string) => Promise<string | null>;
  defaultTimeoutMs?: number;
}

export interface ProductionRainyRunner {
  execute(input: {
    scope: CanonicalAgentScope;
    graphTask: TaskNode;
    objective: string;
    baseSha: string;
    diffHash: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<RainyScopedResponse>;
}

function blocked(
  request: RainyScopedRequest,
  errorClass: RainyErrorClass,
  errorMessage: string,
): RainyScopedResponse {
  const at = nowIso();
  return {
    status: 'blocked',
    touchedPaths: [],
    toolsInvoked: [],
    commandsRequested: [],
    commandResults: [],
    events: [
      {
        eventType: 'failed',
        at,
        summary: errorMessage,
        structuredPayload: {
          engineeringTaskId: request.engineeringTaskId,
          graphTaskId: request.graphTaskId,
          leaseId: request.leaseId,
          errorClass,
        },
      },
    ],
    errorClass,
    errorMessage,
    cancelled: false,
  };
}

function failed(
  request: RainyScopedRequest,
  errorClass: RainyErrorClass,
  errorMessage: string,
  status: RainyExecutionStatus = 'failed',
): RainyScopedResponse {
  const at = nowIso();
  return {
    status,
    touchedPaths: [],
    toolsInvoked: [],
    commandsRequested: [],
    commandResults: [],
    events: [
      {
        eventType: status === 'cancelled' || status === 'timeout' ? 'cancelled' : 'failed',
        at,
        summary: errorMessage,
        structuredPayload: {
          engineeringTaskId: request.engineeringTaskId,
          graphTaskId: request.graphTaskId,
          leaseId: request.leaseId,
          errorClass,
        },
      },
    ],
    errorClass,
    errorMessage,
    cancelled: status === 'cancelled' || status === 'timeout',
  };
}

/**
 * Default HTTP transport for Rainy scoped engineering execution.
 * Uses a deterministic request shape; response must be structured JSON.
 * Does not treat free-form prose as success evidence.
 */
export async function defaultRainyTransport(
  request: RainyScopedRequest,
  apiKey: string,
): Promise<RainyScopedResponse> {
  const base = RAINY_API_BASE_URL.replace(/\/+$/, '');
  const root = base.endsWith('/api/v1') ? base : `${base}/api/v1`;
  const url = `${root}/engineering/execute`;
  const timeoutMs = request.timeoutMs ?? RAINY_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        engineeringTaskId: request.engineeringTaskId,
        graphTaskId: request.graphTaskId,
        leaseId: request.leaseId,
        workspaceId: request.workspaceId,
        baseSha: request.baseSha,
        headSha: request.headSha,
        diffHash: request.diffHash,
        specificationVersion: request.specificationVersion,
        planVersion: request.planVersion,
        taskGraphVersion: request.taskGraphVersion,
        writePaths: request.writePaths,
        readPaths: request.readPaths,
        objective: request.objective,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return failed(
        request,
        'provider_failure',
        `Rainy provider HTTP ${response.status}`,
      );
    }

    const payload = (await response.json()) as Partial<RainyScopedResponse> & {
      status?: RainyExecutionStatus;
      touched_paths?: string[];
      tools_invoked?: RainyScopedResponse['toolsInvoked'];
      commands_requested?: string[];
      command_results?: RainyScopedResponse['commandResults'];
      error_class?: RainyErrorClass;
      error_message?: string;
      model_prose?: string;
    };

    const status = payload.status ?? 'failed';
    const touchedPaths = payload.touchedPaths ?? payload.touched_paths ?? [];
    const toolsInvoked = payload.toolsInvoked ?? payload.tools_invoked ?? [];
    const commandsRequested =
      payload.commandsRequested ?? payload.commands_requested ?? [];
    const commandResults =
      payload.commandResults ?? payload.command_results ?? [];
    const errorClass = payload.errorClass ?? payload.error_class;
    const errorMessage = payload.errorMessage ?? payload.error_message;
    const modelProse = payload.modelProse ?? payload.model_prose;
    const at = nowIso();

    // Never promote incomplete structured outcomes to completed.
    if (status === 'completed' && !Array.isArray(touchedPaths)) {
      return failed(request, 'provider_failure', 'invalid structured response');
    }

    return {
      status,
      touchedPaths,
      toolsInvoked,
      commandsRequested,
      commandResults,
      events: payload.events ?? [
        {
          eventType:
            status === 'completed'
              ? 'completed'
              : status === 'cancelled' || status === 'timeout'
                ? 'cancelled'
                : 'failed',
          at,
          summary: errorMessage ?? status,
          structuredPayload: {
            engineeringTaskId: request.engineeringTaskId,
            leaseId: request.leaseId,
            graphTaskId: request.graphTaskId,
          },
        },
      ],
      errorClass,
      errorMessage,
      provider: payload.provider ?? 'rainy',
      model: payload.model,
      tokenUsage: payload.tokenUsage,
      costUsd: payload.costUsd ?? null,
      cancelled: status === 'cancelled' || status === 'timeout' || Boolean(payload.cancelled),
      modelProse,
      repositoryMutationRecord: payload.repositoryMutationRecord ?? {
        baseSha: request.baseSha,
        headShaBefore: request.headSha,
        headShaAfter: null,
        diffHashBefore: request.diffHash,
        mutated: touchedPaths.length > 0,
      },
    };
  } catch (error) {
    if (controller.signal.aborted || request.signal?.aborted) {
      const abortedByCaller = Boolean(request.signal?.aborted);
      return failed(
        request,
        abortedByCaller ? 'cancelled' : 'timeout',
        abortedByCaller ? 'Rainy request cancelled' : 'Rainy request timed out',
        abortedByCaller ? 'cancelled' : 'timeout',
      );
    }
    return failed(
      request,
      'network',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Create the production Rainy runner. Missing credentials → structured blocked.
 * Provider/network failure never reports completed.
 */
export function createProductionRainyRunner(
  deps: ProductionRainyRunnerDeps,
): ProductionRainyRunner {
  const transport = deps.transport ?? defaultRainyTransport;
  const defaultTimeoutMs = deps.defaultTimeoutMs ?? RAINY_REQUEST_TIMEOUT_MS;

  return {
    async execute(input) {
      const request: RainyScopedRequest = {
        engineeringTaskId: input.scope.engineeringTaskId,
        graphTaskId: input.scope.taskId,
        leaseId: input.scope.leaseId,
        workspaceId: input.scope.workspaceId,
        baseSha: input.baseSha,
        headSha: input.scope.headSha,
        diffHash: input.diffHash,
        specificationVersion: input.scope.approvedSpecificationVersion,
        planVersion: input.scope.approvedPlanVersion,
        taskGraphVersion: input.scope.taskGraphVersion,
        writePaths: input.scope.writePaths,
        readPaths: input.scope.readPaths,
        objective: input.objective,
        signal: input.signal,
        timeoutMs: input.timeoutMs ?? defaultTimeoutMs,
      };

      const apiKey = deps.getApiKey()?.trim();
      if (!apiKey) {
        return blocked(
          request,
          'missing_credentials',
          'Rainy credentials missing — execution blocked',
        );
      }

      if (input.signal?.aborted || request.signal?.aborted) {
        return failed(request, 'cancelled', 'cancelled before Rainy invoke', 'cancelled');
      }

      // Pre-execution HEAD binding check when resolver provided
      if (deps.resolveCurrentHeadSha) {
        const liveHead = await deps.resolveCurrentHeadSha(input.scope.workspaceId);
        if (liveHead && liveHead !== input.scope.headSha) {
          return failed(
            request,
            'stale_head',
            'HEAD changed before Rainy invocation',
            'failed',
          );
        }
      }

      const result = await transport(request, apiKey);

      // Post-execution HEAD drift → cannot mark completed as fresh
      if (
        result.status === 'completed' &&
        deps.resolveCurrentHeadSha
      ) {
        const afterHead = await deps.resolveCurrentHeadSha(input.scope.workspaceId);
        if (afterHead && afterHead !== input.scope.headSha) {
          return {
            ...result,
            status: 'partial',
            errorClass: 'stale_head',
            errorMessage: 'HEAD changed during Rainy execution',
            repositoryMutationRecord: {
              baseSha: request.baseSha,
              headShaBefore: request.headSha,
              headShaAfter: afterHead,
              diffHashBefore: request.diffHash,
              mutated: true,
            },
          };
        }
      }

      // Harden: provider must not report completed on error class
      if (result.status === 'completed' && result.errorClass) {
        return {
          ...result,
          status: 'failed',
          errorMessage:
            result.errorMessage ?? 'provider reported error with completed status',
        };
      }

      return result;
    },
  };
}

/**
 * Map RainyScopedResponse into adapter-facing fields.
 * status completed with zero touched paths stays completed but is explicit.
 */
export function rainyResponseToAdapterFields(response: RainyScopedResponse): {
  ok: boolean;
  touchedPaths: string[];
  toolActivity: Array<{ toolName: string; summary: string; at: string }>;
  commandActivity: Array<{ command: string; exitCode: number | null; at: string }>;
  events: StructuredExecutionEvent[];
  failureClass?:
    | 'timeout'
    | 'cancelled'
    | 'tool_error'
    | 'policy'
    | 'capability'
    | 'stale_lease'
    | 'internal'
    | 'unknown';
  failureMessage?: string;
  modelProse?: string;
  status: RainyExecutionStatus;
  provider?: string;
  model?: string;
  tokenUsage?: RainyScopedResponse['tokenUsage'];
  costUsd?: number | null;
  cancelled: boolean;
  toolsInvoked: RainyScopedResponse['toolsInvoked'];
  commandsRequested: string[];
  commandResults: RainyScopedResponse['commandResults'];
  errorClass?: RainyErrorClass;
  repositoryMutationRecord?: RainyScopedResponse['repositoryMutationRecord'];
} {
  const ok = response.status === 'completed' || response.status === 'partial';
  const failureClass = mapErrorClass(response.errorClass);
  return {
    ok: ok && !response.cancelled && response.status !== 'failed' && response.status !== 'blocked' && response.status !== 'timeout' && response.status !== 'cancelled',
    touchedPaths: response.touchedPaths,
    toolActivity: response.toolsInvoked,
    commandActivity: response.commandResults,
    events: response.events,
    failureClass: ok ? undefined : failureClass,
    failureMessage: response.errorMessage,
    modelProse: response.modelProse,
    status: response.status,
    provider: response.provider,
    model: response.model,
    tokenUsage: response.tokenUsage,
    costUsd: response.costUsd,
    cancelled: response.cancelled,
    toolsInvoked: response.toolsInvoked,
    commandsRequested: response.commandsRequested,
    commandResults: response.commandResults,
    errorClass: response.errorClass,
    repositoryMutationRecord: response.repositoryMutationRecord,
  };
}

function mapErrorClass(
  errorClass?: RainyErrorClass,
):
  | 'timeout'
  | 'cancelled'
  | 'tool_error'
  | 'policy'
  | 'capability'
  | 'stale_lease'
  | 'internal'
  | 'unknown' {
  switch (errorClass) {
    case 'timeout':
      return 'timeout';
    case 'cancelled':
      return 'cancelled';
    case 'missing_credentials':
    case 'policy':
      return 'policy';
    case 'stale_lease':
      return 'stale_lease';
    case 'stale_head':
      return 'stale_lease';
    case 'provider_failure':
    case 'network':
      return 'tool_error';
    case 'internal':
      return 'internal';
    default:
      return 'unknown';
  }
}
