import type { ToolEvent } from "../../contracts/chat";
import type { FinalRunVerdict } from "./finalizer";
import type { WorkStage } from "./stages";
import type { WorkPlan } from "./types";
import type { WorkPlanInputSnapshot } from "./work-engine-core";

export type WorkEngineRunArtifact = {
  version: 1;
  runId: string;
  conversationId?: string;
  workspaceId?: string;
  createdAt: string;
  model?: {
    provider: string;
    id: string;
  };
  snapshot: WorkPlanInputSnapshot;
  workPlan: WorkPlan;
  stages: WorkStage[];
  finalVerdict: FinalRunVerdict;
  toolEvents: Array<{
    id: string;
    name: string;
    status: "passed" | "failed" | "blocked" | "skipped";
    startedAt?: string;
    completedAt?: string;
    summary?: string;
  }>;
  validation?: {
    required: boolean;
    command?: string | null;
    fallbackCommand?: string | null;
    status: "passed" | "failed" | "blocked" | "skipped" | "missing" | "unknown";
  };
  evidence?: {
    required: boolean;
    attached: boolean;
    artifactPath?: string | null;
    missing: string[];
  };
  privacy?: {
    status: "passed" | "blocked" | "partial" | "unknown";
    redactions: number;
    categories: string[];
  };
  downgradedClaims: string[];
  missingStages: string[];
};

export type BuildWorkEngineRunArtifactInput = {
  runId: string;
  conversationId?: string;
  workspaceId?: string;
  createdAt?: string;
  model?: {
    provider: string;
    id: string;
  };
  snapshot: WorkPlanInputSnapshot;
  workPlan: WorkPlan;
  stages: WorkStage[];
  finalVerdict: FinalRunVerdict;
  toolEvents?: ToolEvent[];
  validationStatus?: NonNullable<WorkEngineRunArtifact["validation"]>["status"];
  evidenceAttached: boolean;
  evidenceArtifactPath?: string | null;
  downgradedClaims?: string[];
};

const SECRET_VALUE_RE =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|[A-Za-z0-9+/]{32,}={0,2})\b/g;

export function buildWorkEngineRunArtifact(input: BuildWorkEngineRunArtifactInput): WorkEngineRunArtifact {
  const snapshot = sanitizeSnapshot(input.snapshot);
  const missingStages = input.stages
    .filter((stage) => stage.status === "pending" || stage.status === "failed" || stage.status === "blocked")
    .map((stage) => stage.id);

  return {
    version: 1,
    runId: input.runId,
    conversationId: input.conversationId,
    workspaceId: input.workspaceId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    model: input.model,
    snapshot,
    workPlan: sanitizeWorkPlan(input.workPlan),
    stages: input.stages,
    finalVerdict: input.finalVerdict,
    toolEvents: (input.toolEvents ?? []).map(summarizeToolEvent),
    validation: {
      required: input.workPlan.validationPlan.required,
      command: input.workPlan.validationPlan.primaryCommand,
      fallbackCommand: input.workPlan.validationPlan.fallbackCommand,
      status: input.validationStatus ?? inferValidationStatus(input.stages, input.workPlan.validationPlan.required),
    },
    evidence: {
      required: input.workPlan.evidencePlan.required,
      attached: input.evidenceAttached,
      artifactPath: input.evidenceArtifactPath ?? null,
      missing: input.evidenceAttached ? [] : input.workPlan.evidencePlan.expectedArtifacts,
    },
    privacy: {
      status: inferPrivacyStatus(input.stages, snapshot.privacy?.status),
      redactions: snapshot.privacy?.redactions ?? 0,
      categories: sanitizeStringList(snapshot.privacy?.categories ?? []),
    },
    downgradedClaims: sanitizeStringList(input.downgradedClaims ?? []),
    missingStages,
  };
}

export function exportSanitizedWorkEngineRunArtifact(
  artifact: WorkEngineRunArtifact,
): WorkEngineRunArtifact {
  return {
    ...artifact,
    snapshot: sanitizeSnapshot(artifact.snapshot),
    workPlan: sanitizeWorkPlan(artifact.workPlan),
    toolEvents: artifact.toolEvents.map((event) => ({
      ...event,
      summary: event.summary ? sanitizeText(event.summary) : event.summary,
    })),
    downgradedClaims: sanitizeStringList(artifact.downgradedClaims),
  };
}

function summarizeToolEvent(event: ToolEvent): WorkEngineRunArtifact["toolEvents"][number] {
  return {
    id: event.id,
    name: event.label,
    status: event.status === "done" ? "passed" : event.status === "error" ? "failed" : "skipped",
    summary: sanitizeText(event.detail).slice(0, 240),
  };
}

function inferValidationStatus(
  stages: WorkStage[],
  required: boolean,
): NonNullable<WorkEngineRunArtifact["validation"]>["status"] {
  const stage = stages.find((item) => item.id === "validation_executed");
  if (!stage) return required ? "missing" : "skipped";
  if (stage.status === "pending") return required ? "missing" : "skipped";
  return stage.status;
}

function inferPrivacyStatus(
  stages: WorkStage[],
  snapshotStatus?: NonNullable<WorkPlanInputSnapshot["privacy"]>["status"],
): NonNullable<WorkEngineRunArtifact["privacy"]>["status"] {
  const stage = stages.find((item) => item.id === "privacy_preflight_passed");
  if (stage?.status === "blocked" || snapshotStatus === "blocked") return "blocked";
  if (stage?.status === "passed" || snapshotStatus === "active") return "passed";
  if (snapshotStatus === "inactive") return "partial";
  return "unknown";
}

function sanitizeSnapshot(snapshot: WorkPlanInputSnapshot): WorkPlanInputSnapshot {
  const privacyRequiresPromptRedaction =
    snapshot.privacy?.strict === true &&
    ((snapshot.privacy.redactions ?? 0) > 0 || snapshot.privacy.status === "blocked");
  return {
    ...snapshot,
    prompt: privacyRequiresPromptRedaction ? "[redacted by Privacy Sentinel]" : sanitizeText(snapshot.prompt),
    repoGraph: snapshot.repoGraph
      ? {
          ...snapshot.repoGraph,
          sensitiveSurfaces: snapshot.repoGraph.sensitiveSurfaces.map((surface) => ({
            ...surface,
            reason: sanitizeText(surface.reason),
          })),
        }
      : snapshot.repoGraph,
    failures: snapshot.failures?.map((failure) => ({
      ...failure,
      signature: sanitizeText(failure.signature),
      command: sanitizeText(failure.command),
    })),
    privacy: snapshot.privacy
      ? {
          ...snapshot.privacy,
          categories: sanitizeStringList(snapshot.privacy.categories),
        }
      : snapshot.privacy,
  };
}

function sanitizeWorkPlan(workPlan: WorkPlan): WorkPlan {
  return {
    ...workPlan,
    objective: sanitizeText(workPlan.objective),
    workingSet: {
      ...workPlan.workingSet,
      sensitiveSurfaces: workPlan.workingSet.sensitiveSurfaces.map((surface) => ({
        ...surface,
        reason: sanitizeText(surface.reason),
      })),
      knownFailures: workPlan.workingSet.knownFailures.map((failure) => ({
        ...failure,
        signature: sanitizeText(failure.signature),
        command: sanitizeText(failure.command),
      })),
    },
    privacyPlan: {
      ...workPlan.privacyPlan,
      reason: sanitizeText(workPlan.privacyPlan.reason),
    },
    preventivePlan: {
      ...workPlan.preventivePlan,
      recommendedControls: sanitizeStringList(workPlan.preventivePlan.recommendedControls),
      requiredChecks: sanitizeStringList(workPlan.preventivePlan.requiredChecks),
      reason: sanitizeText(workPlan.preventivePlan.reason),
    },
  };
}

function sanitizeStringList(values: string[]) {
  return values.map(sanitizeText);
}

function sanitizeText(value: string) {
  return value.replace(SECRET_VALUE_RE, "[redacted]");
}
