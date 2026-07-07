import type {
  AssistantRunOptions,
  EvidencePack,
  FactoryRun,
  FactoryRunStage,
  RatchetSuggestion,
  ShipProofSummary,
  ToolEvent,
} from "../contracts/chat";

export function normalizeFactoryRunOptions(
  options: AssistantRunOptions,
): AssistantRunOptions {
  if (options.mode !== "factory" && options.mode !== "ship") {
    return options;
  }

  return {
    ...options,
    access: "approval",
    runbookId:
      options.mode === "ship"
        ? "patch_test_verify"
        : options.runbookId ?? "patch_test_verify",
  };
}

export function createFactoryRun(params: {
  id: string;
  prompt: string;
  options: AssistantRunOptions;
  createdAt: string;
}): FactoryRun | undefined {
  if (params.options.mode !== "factory" && params.options.mode !== "ship") {
    return undefined;
  }

  return {
    id: params.id,
    mode: params.options.mode,
    prompt: params.prompt,
    access: "approval",
    stages: createInitialFactoryStages(params.prompt),
    ratchetSuggestions: [],
    createdAt: params.createdAt,
  };
}

export function completeFactoryRun(
  run: FactoryRun | undefined,
  params: {
    events: ToolEvent[];
    evidencePack?: EvidencePack;
    completedAt: string;
  },
): FactoryRun | undefined {
  if (!run) return undefined;

  const plannedValidation = hasEvent(params.events, /plan_validation|validation plan/i);
  const ranValidation = hasEvent(params.events, /run_tests|sandbox_run|validation run/i);
  const failedValidation = hasErrorEvent(params.events, /run_tests|sandbox_run|validation/i);
  const mappedRepoContext = hasEvent(params.events, /repo(graph)?|semantic memory|workspace health|working set|git status/i);
  const mappedRiskSurfaces = hasEvent(params.events, /risk surface|trust gate|active gate|privacy firewall|policy stop|security|blast radius/i);
  const ratchetSuggestions = createRatchetSuggestions(params.events);

  return {
    ...run,
    completedAt: params.completedAt,
    stages: run.stages.map((stage) => {
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
          summary:
            mappedRiskSurfaces
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
          status: params.events.length > 0 ? "completed" : "missing",
          summary:
            params.events.length > 0
              ? `${params.events.length} tool event(s) recorded.`
              : "No agent tool actions were recorded.",
        };
      }
      if (stage.id === "verification_result") {
        return {
          ...stage,
          status: ranValidation ? (failedValidation ? "blocked" : "completed") : "missing",
          summary: ranValidation
            ? failedValidation
              ? "Validation ran and reported a blocking failure."
              : "Validation evidence was recorded."
            : "Missing validation execution. Any fix or ship claim remains unproven.",
        };
      }
      if (stage.id === "ratchet_suggestions") {
        return {
          ...stage,
          status: ratchetSuggestions.length > 0 ? "active" : "completed",
          summary:
            ratchetSuggestions.length > 0
              ? `${ratchetSuggestions.length} durable repo rule suggestion(s) require approval.`
              : "No repeated workspace behavior needed a durable rule.",
        };
      }
      if (stage.id === "ship_proof") {
        return {
          ...stage,
          status: params.evidencePack ? "completed" : "missing",
          summary: params.evidencePack
            ? "Ship Proof is attached from the run evidence."
            : "No Ship Proof was generated.",
        };
      }
      return stage;
    }),
    ratchetSuggestions,
    shipProof: params.evidencePack ? createShipProofSummary(params.evidencePack) : undefined,
  };
}

export function createShipProofSummary(evidencePack: EvidencePack): ShipProofSummary {
  const validationCommands = (evidencePack.commandsExecuted ?? [])
    .map((command) => command.command)
    .filter((command) => /\b(test|typecheck|lint|build|package|make|bun run)\b/i.test(command));
  const failedEvidence = [
    ...(evidencePack.commandsExecuted ?? [])
      .filter((command) => typeof command.exitCode === "number" && command.exitCode !== 0)
      .map((command) => command.command),
    ...(evidencePack.checks ?? [])
      .filter((check) => check.status === "failed")
      .map((check) => check.name),
  ];
  const passedEvidence = [
    ...(evidencePack.commandsExecuted ?? [])
      .filter((command) => command.exitCode === 0)
      .map((command) => command.command),
    ...(evidencePack.checks ?? [])
      .filter((check) => check.status === "passed")
      .map((check) => check.name),
  ];
  const missingEvidence = [
    ...(evidencePack.verifiedTaskScore?.missingEvidence ?? []),
    ...(validationCommands.length === 0 ? ["Validation command evidence missing."] : []),
  ];
  const privacyStatus =
    evidencePack.attestation?.status === "blocked"
      ? "blocked"
      : evidencePack.attestation?.status === "signed"
        ? "signed"
        : "not signed";

  return {
    verdict: evidencePack.verdict.label,
    touchedFilesCount: evidencePack.filesModified?.length ?? evidencePack.touchedPaths?.length ?? 0,
    riskSurfaces: evidencePack.unresolvedRisks?.slice(0, 4) ?? [],
    validationCommands,
    passedEvidence,
    failedEvidence,
    missingEvidence,
    privacyStatus,
    gitStatus:
      evidencePack.status === "complete" &&
      failedEvidence.length === 0 &&
      missingEvidence.length === 0
        ? "allowed"
        : "blocked",
  };
}

export function createRatchetSuggestions(events: ToolEvent[]): RatchetSuggestion[] {
  const repeatedFailure = findRepeatedFailure(events);
  if (!repeatedFailure) return [];

  return [
    {
      id: `ratchet-${slug(repeatedFailure)}`,
      target: "AGENTS.md",
      reason: `Repeated workspace behavior detected: ${repeatedFailure}.`,
      rule:
        "Use `bun run` commands for validation in this workspace. Do not suggest npm commands unless package.json explicitly requires npm.",
      requiresApproval: true,
      actions: ["Add repo rule", "Ignore once", "Never suggest again"],
    },
  ];
}

function createInitialFactoryStages(prompt: string): FactoryRunStage[] {
  return [
    { id: "spec", label: "Spec", status: "completed", summary: prompt },
    {
      id: "repo_context",
      label: "Repo context",
      status: "active",
      summary: "Use RepoGraph semantic memory and workspace health before broad file reads.",
    },
    { id: "risk_surfaces", label: "Risk surfaces", status: "pending", summary: "Map touched runtime, config, data, and trust-boundary surfaces." },
    { id: "validation_plan", label: "Validation plan", status: "pending", summary: "Required before any fix or ship claim." },
    { id: "agent_actions", label: "Agent actions", status: "pending", summary: "No actions recorded yet." },
    { id: "verification_result", label: "Verification result", status: "missing", summary: "Validation has not run yet." },
    { id: "ratchet_suggestions", label: "Ratchet suggestions", status: "pending", summary: "Durable rule suggestions require approval." },
    { id: "ship_proof", label: "Ship Proof status", status: "missing", summary: "No Ship Proof attached yet." },
  ];
}

function hasEvent(events: ToolEvent[], pattern: RegExp) {
  return events.some((event) => pattern.test(`${event.label} ${event.detail}`));
}

function hasErrorEvent(events: ToolEvent[], pattern: RegExp) {
  return events.some(
    (event) =>
      event.status === "error" && pattern.test(`${event.label} ${event.detail}`),
  );
}

function findRepeatedFailure(events: ToolEvent[]) {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.status !== "error") continue;
    const key = normalizeFailure(`${event.label} ${event.detail}`);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if ((counts.get(key) ?? 0) >= 2) return key;
  }
  return "";
}

function normalizeFailure(value: string) {
  const lower = value.toLowerCase();
  if (/\bnpm\b/.test(lower) && /\bbun\b/.test(lower)) return "package manager mismatch";
  if (/command|tool|workspace|package manager|npm|bun/.test(lower)) return value.slice(0, 120);
  return "";
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace-rule";
}
