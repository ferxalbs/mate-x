/**
 * Legacy FactoryRun projection helpers.
 * Write authority deleted (NES-8.1 / R4). New Factory runs are never created.
 * completeFactoryRun does not advance stages via regex as product truth.
 * Historical messages may still embed FactoryRun for read-only display.
 */

import type {
  AssistantRunOptions,
  EvidencePack,
  FactoryRun,
  FactoryRunStage,
  RatchetSuggestion,
  ShipProofSummary,
  ToolEvent,
} from "../contracts/chat";

/**
 * Factory write authority is dead. Always returns undefined.
 * Legacy messages may still carry historical FactoryRun records (read-only).
 */
export function createFactoryRun(_params: {
  id: string;
  prompt: string;
  options: AssistantRunOptions;
  createdAt: string;
}): FactoryRun | undefined {
  return undefined;
}

/**
 * Does not advance stage status from tool-event regex.
 * Preserves historical run as-is; only stamps completedAt when provided.
 * Product readiness is EngineeringTask + GitGate only.
 */
export function completeFactoryRun(
  run: FactoryRun | undefined,
  params: {
    events: ToolEvent[];
    evidencePack?: EvidencePack;
    completedAt: string;
  },
): FactoryRun | undefined {
  if (!run) return undefined;
  // Read-only: never rewrite stage truth from events
  return {
    ...run,
    completedAt: params.completedAt ?? run.completedAt,
  };
}

/**
 * @deprecated Projection helper for migration fixtures only — not product authority.
 * Regex stage inference retained solely for testing historical message rendering.
 */
export function projectLegacyFactoryStagesFromEvents(
  stages: FactoryRunStage[],
  events: ToolEvent[],
): FactoryRunStage[] {
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

export function normalizeFactoryRunOptions(
  options: AssistantRunOptions,
): AssistantRunOptions {
  // Strip factory/ship product modes — pathKind is internal only
  if (options.mode === "factory" || options.mode === "ship") {
    return {
      ...options,
      mode: "chat",
      access: "approval",
      runbookId:
        options.mode === "ship"
          ? "patch_test_verify"
          : options.runbookId ?? "patch_test_verify",
    };
  }
  return options;
}

export function createInitialFactoryStages(prompt: string): FactoryRunStage[] {
  // Migration/fixture helper only — prompt is never a completed specification.
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
): RatchetSuggestion[] {
  void events;
  // No hard-coded package-manager ratchet as product truth (deletion map).
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
