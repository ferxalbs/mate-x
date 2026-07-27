import type {
  PolicyRunState,
  PolicyStop,
  PolicyStopAction,
  PolicyStopAttemptKind,
  ResolvePolicyStopRequest,
} from "../contracts/policy";

type CreatePolicyStopInput = {
  runId: string;
  workspacePath: string;
  toolName: string;
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

/**
 * Stores approval state only. Capability decisions belong to
 * capability-resolver.ts so an operation has exactly one authorization path.
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
        target: input.target,
        command: input.command,
        metadata: input.metadata,
      },
      recommendation: input.recommendation,
      availableActions: input.availableActions,
      status: "open",
    };
    this.stops.set(stop.id, stop);
    return stop;
  }

  listStops(runId?: string) {
    const stops = Array.from(this.stops.values()).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
    return runId ? stops.filter((stop) => stop.runId === runId) : stops;
  }

  getRunState(runId: string): PolicyRunState {
    const openStops = this.listStops(runId).filter((stop) => stop.status === "open");
    return {
      runId,
      status: openStops.length > 0 ? "paused" : "clear",
      openStops,
    };
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

  markStopResumed(stopId: string) {
    return this.updateStopStatus(stopId, "resumed");
  }

  markStopCompleted(stopId: string) {
    return this.updateStopStatus(stopId, "completed");
  }

  markStopFailed(stopId: string) {
    return this.updateStopStatus(stopId, "failed");
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
