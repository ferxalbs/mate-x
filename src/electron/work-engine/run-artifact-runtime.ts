import type { ToolEvent } from "../../contracts/chat";
import type { FinalRunVerdict } from "./finalizer";
import { buildWorkEngineRunArtifact, type WorkEngineRunArtifact } from "./run-artifact";
import { persistWorkEngineRunArtifact } from "./run-artifact-persistence";
import type { WorkStage } from "./stages";
import type { WorkPlan } from "./types";
import type { WorkPlanInputSnapshot } from "./work-engine-core";

export type WorkEngineRunArtifactPersistFn = (input: {
  appDataRoot: string;
  artifact: WorkEngineRunArtifact;
}) => Promise<string>;

const SECRET_VALUE_RE =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|[A-Za-z0-9+/]{32,}={0,2})\b/g;

export async function persistWorkEngineRunArtifactSafely(input: {
  appDataRoot: string;
  runId: string;
  conversationId?: string;
  workspaceId?: string;
  model?: {
    provider: string;
    id: string;
  };
  snapshot: WorkPlanInputSnapshot;
  workPlan: WorkPlan;
  stages: WorkStage[];
  finalVerdict: FinalRunVerdict;
  toolEvents: ToolEvent[];
  validationStatus?: NonNullable<WorkEngineRunArtifact["validation"]>["status"];
  evidenceAttached: boolean;
  evidenceArtifactPath?: string | null;
  downgradedClaims?: string[];
  persist?: WorkEngineRunArtifactPersistFn;
}) {
  try {
    const artifact = buildWorkEngineRunArtifact({
      runId: input.runId,
      conversationId: input.conversationId,
      workspaceId: input.workspaceId,
      model: input.model,
      snapshot: input.snapshot,
      workPlan: input.workPlan,
      stages: input.stages,
      finalVerdict: input.finalVerdict,
      toolEvents: input.toolEvents,
      validationStatus: input.validationStatus,
      evidenceAttached: input.evidenceAttached,
      evidenceArtifactPath: input.evidenceArtifactPath,
      downgradedClaims: input.downgradedClaims,
    });
    const artifactPath = await (input.persist ?? persistWorkEngineRunArtifact)({
      appDataRoot: input.appDataRoot,
      artifact,
    });
    return { ok: true as const, artifact, artifactPath };
  } catch (error) {
    console.warn("Work Engine artifact persistence failed:", safeErrorMessage(error));
    return {
      ok: false as const,
      error: safeErrorMessage(error),
    };
  }
}

function safeErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(SECRET_VALUE_RE, "[redacted]");
}
