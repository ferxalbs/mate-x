/**
 * Dead Factory write path stubs + migration projection helpers.
 * Write authority deleted (NES-8.1 / CLOSURE 2).
 * Historical Factory decode lives under engineering/migration only.
 * This module must not restore Factory authority through configuration.
 */

import type {
  AssistantRunOptions,
  EvidencePack,
  ShipProofSummary,
  ToolEvent,
} from "../contracts/chat";
import type {
  LegacyFactoryRun,
  LegacyFactoryRunStage,
} from "../electron/engineering/migration/legacy-factory-types";

/**
 * Factory write authority is dead. Always returns undefined.
 */
export function createFactoryRun(_params: {
  id: string;
  prompt: string;
  options: AssistantRunOptions;
  createdAt: string;
}): undefined {
  return undefined;
}

/**
 * Does not advance stage status. Preserves historical run timestamps only.
 * Product readiness is EngineeringTask + GitGate only.
 */
export function completeFactoryRun(
  run: LegacyFactoryRun | undefined,
  params: {
    events: ToolEvent[];
    evidencePack?: EvidencePack;
    completedAt: string;
  },
): LegacyFactoryRun | undefined {
  if (!run) return undefined;
  void params.events;
  void params.evidencePack;
  return {
    ...run,
    completedAt: params.completedAt ?? run.completedAt,
  };
}

/**
 * @deprecated Projection helper for migration fixtures only — not product authority.
 */
export function projectLegacyFactoryStagesFromEvents(
  stages: LegacyFactoryRunStage[],
  events: ToolEvent[],
): LegacyFactoryRunStage[] {
  const plannedValidation = hasEvent(events, /plan_validation|validation plan/i);
  const ranValidation = hasEvent(events, /run_tests|sandbox_run|validation run/i);
  const failedValidation = hasErrorEvent(events, /run_tests|sandbox_run|validation/i);
  const mappedRepoContext = hasEvent(
    events,
    /repo(graph)?|semantic memory|workspace health|working set|git status/i,
  );
  const mappedRiskSurfaces = hasEvent(
    events,
    /risk surface|trust gate|active gate|privacy firewall|policy stop|security|blast radius/i,
  );

  return stages.map((stage) => {
    if (stage.id === "repo_context") {
      return {
        ...stage,
        status: mappedRepoContext ? "completed" : "missing",
        summary: mappedRepoContext
          ? "Repo context evidence was recorded before broad reads."
          : "No RepoGraph, workspace health, working set, or git status evidence was recorded.",
      };
    }
    if (stage.id === "risk_surfaces") {
      return {
        ...stage,
        status: mappedRiskSurfaces ? "completed" : "missing",
        summary: mappedRiskSurfaces
          ? "Risk surfaces were derived from runtime context and tool events."
          : "No tool evidence recorded risk surfaces.",
      };
    }
    if (stage.id === "validation_plan") {
      return {
        ...stage,
        status: plannedValidation ? "completed" : "missing",
        summary: plannedValidation
          ? "Validation was planned before any fix or ship claim."
          : "Missing validation plan. Do not treat the run as ready to ship.",
      };
    }
    if (stage.id === "agent_actions") {
      return {
        ...stage,
        status: events.length > 0 ? "completed" : "missing",
        summary:
          events.length > 0
            ? `${events.length} tool event(s) recorded.`
            : "No agent tool actions were recorded.",
      };
    }
    if (stage.id === "verification_result") {
      if (failedValidation) {
        return {
          ...stage,
          status: "blocked",
          summary: "Validation command evidence recorded a failure.",
        };
      }
      return {
        ...stage,
        status: ranValidation ? "completed" : "missing",
        summary: ranValidation
          ? "Validation command evidence executed."
          : "No validation command evidence executed.",
      };
    }
    return stage;
  });
}

/**
 * Normalize run options: strip any residual legacy mode fields if present
 * on untyped payloads; prefer pathKind.
 */
export function normalizeFactoryRunOptions(
  options: AssistantRunOptions & { mode?: string },
): AssistantRunOptions {
  const residualMode = options.mode;
  // Residual legacy mode aliases map to pathKind (overrides when present)
  let pathKind = options.pathKind;
  if (residualMode) {
    if (residualMode === "ship" || residualMode === "review") {
      pathKind = "verify_only";
    } else if (residualMode === "chat" || residualMode === "plan") {
      pathKind = "chat_help";
    } else if (
      residualMode === "factory" ||
      residualMode === "build" ||
      residualMode === "critic_loop"
    ) {
      pathKind = "full";
    }
  }
  const { mode: _drop, ...rest } = options as AssistantRunOptions & {
    mode?: string;
  };
  void _drop;
  const resolvedPath = pathKind ?? "full";
  return {
    ...rest,
    pathKind: resolvedPath,
    access:
      residualMode === "factory" || residualMode === "ship"
        ? "approval"
        : options.access,
    runbookId:
      residualMode === "ship"
        ? "patch_test_verify"
        : options.runbookId ??
          (resolvedPath === "chat_help"
            ? "review_classify_summarize"
            : "patch_test_verify"),
  };
}

export function createInitialFactoryStages(prompt: string): LegacyFactoryRunStage[] {
  void prompt;
  return [
    {
      id: "repo_context",
      label: "Repo context",
      status: "pending",
      summary: "Awaiting evidence.",
    },
    {
      id: "risk_surfaces",
      label: "Risk surfaces",
      status: "pending",
      summary: "Awaiting evidence.",
    },
    {
      id: "validation_plan",
      label: "Validation plan",
      status: "pending",
      summary: "Awaiting evidence.",
    },
    {
      id: "agent_actions",
      label: "Agent actions",
      status: "pending",
      summary: "Awaiting evidence.",
    },
    {
      id: "verification_result",
      label: "Verification",
      status: "pending",
      summary: "Awaiting evidence.",
    },
  ];
}

export function createRatchetSuggestions(
  events: ToolEvent[],
): never[] {
  void events;
  return [];
}

export function createShipProofSummary(params: {
  events: ToolEvent[];
  evidencePack?: EvidencePack;
}): ShipProofSummary {
  const ranValidation = hasEvent(
    params.events,
    /run_tests|sandbox_run|validation run/i,
  );
  // Decorative only — GitGate is main-process authority
  return {
    verdict: ranValidation ? "partial" : "missing",
    touchedFilesCount: params.evidencePack?.filesModified?.length ?? 0,
    riskSurfaces: [],
    validationCommands:
      params.evidencePack?.commandsExecuted?.map((c) => c.command) ?? [],
    passedEvidence: [],
    failedEvidence: [],
    missingEvidence: ranValidation
      ? []
      : ["Validation command evidence missing."],
    privacyStatus: "unknown",
    gitStatus: "blocked",
  };
}

function hasEvent(events: ToolEvent[], pattern: RegExp): boolean {
  return events.some((event) => {
    const hay = `${event.label ?? ""} ${event.detail ?? ""} ${event.status ?? ""}`;
    return pattern.test(hay);
  });
}

function hasErrorEvent(events: ToolEvent[], pattern: RegExp): boolean {
  return events.some((event) => {
    const hay = `${event.label ?? ""} ${event.detail ?? ""} ${event.status ?? ""}`;
    const isError = event.status === "error";
    return isError && pattern.test(hay);
  });
}
