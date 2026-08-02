import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  AgentExecutionSessionState,
  AgentRunEventV3,
  LocalDiagnosticPayload,
  PublicRunPayload,
  RunEventDelta,
  RunEventKind,
  RunEventVisibility,
  RunPhase,
} from "../../contracts/agent-run-trace";
import type { BehaviorMode } from "../../contracts/behavior-mode";
import type { ExecutionOutcome } from "../../contracts/execution";
import type { ToolEvent, ToolEventStatus } from "../../contracts/chat";
import type { EngineeringRepository } from "../engineering/repository-types";
import { getEngineeringRepository } from "../engineering/repository";

type AppendInput = {
  kind: RunEventKind;
  phase: RunPhase;
  visibility: RunEventVisibility;
  payload: PublicRunPayload | LocalDiagnosticPayload;
  spanId?: string;
  parentSpanId?: string | null;
  executionId?: string;
};

const activeSessions = new Map<string, AgentExecutionSession>();

const ABSOLUTE_PATH_PATTERN =
  /(?:^|[\s"'(])(?:\/(?:Users|home|var|tmp|private|Volumes|opt|etc)\/|[A-Za-z]:[\\/])/;
const SECRET_PATTERN =
  /\b(?:sk|ra)-[a-z0-9_-]{12,}\b|(?:api[_-]?key|token|secret|password)\s*[:=]/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export class AgentExecutionSession {
  readonly traceId = randomBytes(16).toString("hex");
  private state: AgentExecutionSessionState = "created";
  private sequence = 0;
  private previousIntegrityHash: string | null = null;
  private readonly legacyState = new Map<string, string>();

  constructor(
    readonly runId: string,
    readonly mode: BehaviorMode,
    readonly engineeringTaskId: string | null,
    readonly executionId: string | null = null,
    private readonly repository: EngineeringRepository = getEngineeringRepository(),
  ) {
    activeSessions.set(runId, this);
    this.append({
      kind: "run.created",
      phase: "preflight",
      visibility: "public",
      payload: { title: "Run created", status: "active" },
    });
  }

  start(): RunEventDelta {
    this.state = "running";
    return this.append({
      kind: "run.started",
      phase: "preflight",
      visibility: "public",
      payload: { title: "Run started", status: "active" },
    });
  }

  captureLegacyEvents(events: ToolEvent[]): RunEventDelta | undefined {
    const pending: AppendInput[] = [];
    for (const event of events) {
      const stableId = event.segmentId ?? event.id;
      const stateKey = `${event.status}\u001f${event.type ?? ""}\u001f${event.visibility ?? ""}`;
      if (this.legacyState.get(stableId) === stateKey) continue;
      this.legacyState.set(stableId, stateKey);

      const phase = phaseForToolEvent(event);
      const visibility: RunEventVisibility =
        event.visibility === "public" ? "public" : "local_diagnostic";
      const kind = kindForToolEvent(event);
      const spanId = stableSpanId(this.runId, stableId);
      pending.push({
        kind,
        phase,
        visibility,
        executionId: event.executionId,
        spanId,
        payload:
          visibility === "public"
            ? {
                title: sanitizePublicText(event.title ?? event.label),
                summary: sanitizePublicText(event.summary ?? event.detail),
                status: publicStatus(event.status),
              }
            : {
                toolClass: sanitizeToolClass(event.type ?? event.label),
                durationMs: event.durationMs,
                code:
                  event.status === "blocked"
                    ? "TOOL_BLOCKED"
                    : event.status === "failed" || event.status === "error"
                      ? "TOOL_FAILED"
                      : undefined,
              },
      });
    }
    return pending.length > 0 ? this.appendMany(pending) : undefined;
  }

  transition(
    state: Exclude<AgentExecutionSessionState, "created" | "running" | "terminal">,
  ): RunEventDelta {
    this.state = state;
    const mapping = {
      awaiting_approval: {
        kind: "run.awaiting_approval" as const,
        phase: "execution" as const,
        title: "Waiting for approval",
      },
      verifying: {
        kind: "run.verifying" as const,
        phase: "verification" as const,
        title: "Validating changes",
      },
      recovering: {
        kind: "run.recovering" as const,
        phase: "recovery" as const,
        title: "Recovering workspace",
      },
    }[state];
    return this.append({
      kind: mapping.kind,
      phase: mapping.phase,
      visibility: "public",
      payload: { title: mapping.title, status: "active" },
    });
  }

  complete(outcome: ExecutionOutcome): RunEventDelta {
    this.state = "terminal";
    const kind: RunEventKind =
      outcome.terminalState === "completed"
        ? "run.completed"
        : outcome.terminalState === "partial"
          ? "run.partial"
          : outcome.terminalState === "blocked"
            ? "run.blocked"
            : outcome.terminalState === "cancelled"
              ? "run.cancelled"
              : "run.failed";
    const annotations: AppendInput[] = [];
    if (outcome.completionKind === "already_satisfied") {
      annotations.push(
        {
          kind: "objective.already_satisfied",
          phase: "inspection",
          visibility: "public",
          payload: {
            title: "Objective already satisfied",
            summary: "Repository evidence shows the requested state already exists.",
            status: "completed",
            completionKind: outcome.completionKind,
          },
        },
        {
          kind: "mutation.not_required",
          phase: "execution",
          visibility: "public",
          payload: {
            title: "No mutation required",
            summary: "No workspace files needed changes.",
            status: "completed",
            completionKind: outcome.completionKind,
          },
        },
        {
          kind: "validation.not_applicable",
          phase: "verification",
          visibility: "public",
          payload: {
            title: "Post-mutation validation not applicable",
            summary: "Mutation-triggered checks were not activated because no mutation occurred.",
            status: "completed",
            validationState: outcome.validationState ?? outcome.evidence.validation.status,
            completionKind: outcome.completionKind,
          },
        },
      );
    }
    const delta = this.appendMany([
      ...annotations,
      {
        kind,
        phase: "finalization",
        visibility: "public",
        payload: {
          title: "Run finished",
          summary: sanitizePublicText(outcome.summary),
          status:
            kind === "run.completed"
              ? "completed"
              : kind === "run.partial"
                ? "partial"
                : kind === "run.blocked"
                  ? "blocked"
                  : kind === "run.cancelled"
                    ? "cancelled"
                    : "failed",
          validationState: outcome.validationState ?? outcome.evidence.validation.status,
          worktreeHealth: outcome.worktreeHealth,
          completionKind: outcome.completionKind,
        },
      },
    ]);
    activeSessions.delete(this.runId);
    return delta;
  }

  record(input: AppendInput): RunEventDelta {
    return this.append(input);
  }

  getEvents(afterSeq = 0, limit = 1_000): AgentRunEventV3[] {
    return this.repository.getAgentRunEvents(this.runId, afterSeq, limit);
  }

  private append(input: AppendInput): RunEventDelta {
    return this.appendMany([input]);
  }

  private appendMany(inputs: AppendInput[]): RunEventDelta {
    const events: AgentRunEventV3[] = [];
    for (const input of inputs) {
      const seq = ++this.sequence;
      const occurredAt = new Date().toISOString();
      const envelope = {
        schemaVersion: 3 as const,
        eventId: `run_evt_${randomUUID()}`,
        traceId: this.traceId,
        spanId: input.spanId ?? randomBytes(8).toString("hex"),
        parentSpanId: input.parentSpanId ?? null,
        engineeringTaskId: this.engineeringTaskId,
        executionId: input.executionId ?? this.executionId,
        runId: this.runId,
        seq,
        occurredAt,
        kind: input.kind,
        phase: input.phase,
        mode: this.mode,
        visibility: input.visibility,
        payload: input.payload,
        previousIntegrityHash: this.previousIntegrityHash,
      };
      assertSafePayload(envelope.payload);
      const integrityHash = sha256(JSON.stringify(envelope));
      const event: AgentRunEventV3 = { ...envelope, integrityHash };
      this.previousIntegrityHash = integrityHash;
      events.push(event);
    }
    this.repository.appendAgentRunEvents({
      runId: this.runId,
      traceId: this.traceId,
      engineeringTaskId: this.engineeringTaskId,
      executionId: this.executionId,
      behaviorMode: this.mode,
      state: this.state,
      events,
    });
    return {
      runId: this.runId,
      fromSeq: events[0].seq,
      toSeq: events.at(-1)!.seq,
      events,
    };
  }
}

export function getActiveAgentExecutionSession(
  runId: string | undefined,
): AgentExecutionSession | null {
  return runId ? activeSessions.get(runId) ?? null : null;
}

export function getRunEventDelta(
  runId: string,
  afterSeq = 0,
  limit = 1_000,
  repository: EngineeringRepository = getEngineeringRepository(),
): RunEventDelta {
  const events = repository.getAgentRunEvents(runId, afterSeq, limit);
  return {
    runId,
    fromSeq: events[0]?.seq ?? afterSeq + 1,
    toSeq: events.at(-1)?.seq ?? afterSeq,
    events,
  };
}

function phaseForToolEvent(event: ToolEvent): RunPhase {
  if (event.segmentKind === "intermediate_response") return "execution";
  if (event.type === "validation") return "verification";
  if (event.type === "edit") return "execution";
  if (event.type === "approval") return "execution";
  if (event.type === "result") return "finalization";
  return "inspection";
}

function kindForToolEvent(event: ToolEvent): RunEventKind {
  if (
    event.segmentKind === "intermediate_response" &&
    event.visibility === "public"
  ) {
    return "provider.completed";
  }
  const { status, type } = event;
  const prefix =
    type === "validation"
      ? "validation"
      : type === "approval"
        ? "approval"
        : "tool";
  if (prefix === "approval") {
    return status === "active" || status === "queued"
      ? "approval.requested"
      : "approval.resolved";
  }
  if (status === "blocked") return `${prefix}.blocked` as RunEventKind;
  if (status === "failed" || status === "error") {
    return `${prefix}.failed` as RunEventKind;
  }
  if (status === "cancelled") return "tool.cancelled";
  if (status === "completed" || status === "done") {
    return `${prefix}.completed` as RunEventKind;
  }
  return `${prefix}.started` as RunEventKind;
}

function publicStatus(status: ToolEventStatus): PublicRunPayload["status"] {
  if (status === "blocked") return "blocked";
  if (status === "failed" || status === "error") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "completed" || status === "done") return "completed";
  return "active";
}

function stableSpanId(runId: string, stableId: string): string {
  return sha256(`${runId}\u001f${stableId}`).slice(0, 16);
}

function sanitizeToolClass(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 64);
}

function sanitizePublicText(value: string): string {
  return value
    .replace(ABSOLUTE_PATH_PATTERN, " [workspace]/")
    .replace(SECRET_PATTERN, "[REDACTED]")
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .slice(0, 500);
}

function assertSafePayload(payload: PublicRunPayload | LocalDiagnosticPayload): void {
  const serialized = JSON.stringify(payload);
  if (
    ABSOLUTE_PATH_PATTERN.test(serialized) ||
    SECRET_PATTERN.test(serialized) ||
    EMAIL_PATTERN.test(serialized)
  ) {
    throw new Error("Run trace payload rejected by the privacy boundary.");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
