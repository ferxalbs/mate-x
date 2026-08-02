import type { SearchMatch, WorkspaceTrustContract } from "../../contracts/workspace";
import type {
  ConditionalAcceptanceCriterion,
  MutationPermission,
  ObjectiveState,
  RepositoryObjectiveAssertion,
  ObjectiveStateAssertion,
  WorkObjectiveContract,
  WorkStrategy,
  ValidationObligation,
  ValidationSignal,
  ValidationTrigger,
} from "../../contracts/work-objective";
import type { WorkIntent } from "./types";

export interface ObjectiveCompilerInput {
  prompt: string;
  intent: WorkIntent;
  mode: "execute" | "analyze" | "quality" | "security_review";
  preexistingFiles?: string[];
  workspacePolicy?: WorkspaceTrustContract | null;
  initialInspection?: {
    matches?: SearchMatch[];
    state?: ObjectiveState;
    evidenceIds?: string[];
  };
  objectiveProposal?: unknown;
}

const SIGNAL_PATTERNS: Array<[ValidationSignal, RegExp]> = [
  ["test", /\b(?:focused\s+)?tests?\b|\btest\s+suite\b|\bvitest\b|\bjest\b/i],
  ["typecheck", /\btype[ -]?check\b|\btsc\b/i],
  ["lint", /\blint\b|\beslint\b/i],
  ["build", /\bbuild\b|\bpackage\b/i],
];

const MUTATION_WORDS = /\b(?:change|create|delete|edit|fix|migrat(?:e|ion)|modif(?:y|ication)|patch|replace|update|write)\b/i;

export function compileObjectiveContract(input: ObjectiveCompilerInput): WorkObjectiveContract {
  const structured = normalizeStructuredProposal(input.objectiveProposal, input);
  if (structured) return structured;

  const validationIsPrimaryObjective =
    input.intent === "validate" ||
    (!MUTATION_WORDS.test(input.prompt) && containsValidationSignal(input.prompt));
  const strategy = strategyFor(input.mode, input.intent, validationIsPrimaryObjective, input.prompt);
  const stateAssertions = parseStateAssertions(input.prompt);
  const repositoryAssertions = compileRepositoryAssertions(input.prompt, stateAssertions);
  const conditionalAcceptanceCriteria = parseValidationCriteria(
    input.prompt,
    validationIsPrimaryObjective,
    stateAssertions,
  );
  const explicitConstraints = input.prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*]\s*)?(?:do not|don't|never|only|unless|without)\b/i.test(line));
  const requestedRepositoryState = parseRequestedState(input.prompt, stateAssertions);
  const initialState = input.initialInspection?.state ?? "unknown";

  return {
    schemaVersion: 1,
    primaryObjective: input.prompt.trim(),
    requestedRepositoryState,
    explicitConstraints,
    acceptanceCriteria: [
      ...requestedRepositoryState,
      ...stateAssertions.map((assertion) =>
        assertion.kind === "must_exist"
          ? `Required state exists: ${assertion.expression}`
          : `Prohibited state is absent: ${assertion.expression}`,
      ),
    ],
    conditionalAcceptanceCriteria,
    evidenceRequirements: [
      "Repository evidence must establish the requested state or explain why it remains unknown.",
      ...(validationIsPrimaryObjective ? ["The requested validation must produce execution evidence."] : []),
    ],
    stateAssertions,
    repositoryAssertions,
    mutationPermission: mutationPermissionFor(input.workspacePolicy, input.mode, input.prompt),
    validationIsPrimaryObjective,
    objectiveAlreadySatisfied: initialState === "satisfied",
    actualDelta: {
      mutationOccurred: false,
      changedFiles: [],
      preexistingFiles: input.preexistingFiles ?? [],
      targetState: initialState,
      evidenceIds: input.initialInspection?.evidenceIds ?? [],
    },
    strategy,
    source: "deterministic_fallback",
  };
}

export function updateObjectiveDelta(
  objective: WorkObjectiveContract,
  delta: Pick<WorkObjectiveContract["actualDelta"], "mutationOccurred" | "changedFiles" | "targetState" | "evidenceIds">,
): WorkObjectiveContract {
  return {
    ...objective,
    actualDelta: {
      ...objective.actualDelta,
      ...delta,
    },
  };
}

function normalizeStructuredProposal(
  proposal: unknown,
  input: ObjectiveCompilerInput,
): WorkObjectiveContract | null {
  const value = recordOf(proposal);
  if (!value || typeof value.primaryObjective !== "string") return null;
  const criteria = Array.isArray(value.conditionalAcceptanceCriteria)
    ? value.conditionalAcceptanceCriteria
        .map(normalizeCriterion)
        .filter((criterion): criterion is ConditionalAcceptanceCriterion => criterion !== null)
    : [];
  const assertions = Array.isArray(value.stateAssertions)
    ? value.stateAssertions
        .map(normalizeAssertion)
        .filter((assertion): assertion is ObjectiveStateAssertion => assertion !== null)
    : [];
  const repositoryAssertions = Array.isArray(value.repositoryAssertions)
    ? value.repositoryAssertions
        .map(normalizeRepositoryAssertion)
        .filter((assertion): assertion is RepositoryObjectiveAssertion => assertion !== null)
    : compileRepositoryAssertions(input.prompt, assertions);
  const requestedRepositoryState = stringArray(value.requestedRepositoryState);
  const acceptanceCriteria = stringArray(value.acceptanceCriteria);
  const explicitConstraints = stringArray(value.explicitConstraints);
  const evidenceRequirements = stringArray(value.evidenceRequirements);
  const validationIsPrimaryObjective = value.validationIsPrimaryObjective === true;
  const targetState = input.initialInspection?.state === "satisfied" ? "satisfied" : "unknown";
  const policyMutationPermission = mutationPermissionFor(input.workspacePolicy, input.mode, input.prompt);
  const mutationPermission = mostRestrictivePermission(
    policyMutationPermission,
    normalizeMutationPermission(value.mutationPermission),
  );
  const proposedStrategy = normalizeStrategy(value.strategy) ?? strategyFor(
    input.mode,
    input.intent,
    validationIsPrimaryObjective,
    input.prompt,
  );
  return {
    schemaVersion: 1,
    primaryObjective: value.primaryObjective.trim(),
    requestedRepositoryState: requestedRepositoryState.length > 0 ? requestedRepositoryState : [value.primaryObjective.trim()],
    explicitConstraints,
    acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : requestedRepositoryState,
    conditionalAcceptanceCriteria: criteria,
    evidenceRequirements,
    stateAssertions: assertions,
    repositoryAssertions,
    mutationPermission,
    validationIsPrimaryObjective,
    objectiveAlreadySatisfied: targetState === "satisfied",
    actualDelta: {
      mutationOccurred: false,
      changedFiles: [],
      preexistingFiles: input.preexistingFiles ?? [],
      targetState,
      evidenceIds: [],
    },
    strategy: mutationPermission === "read_only" && proposedStrategy === "work"
      ? "inspection"
      : proposedStrategy,
    source: "structured",
  };
}

function parseValidationCriteria(
  prompt: string,
  validationIsPrimaryObjective: boolean,
  assertions: ObjectiveStateAssertion[],
): ConditionalAcceptanceCriterion[] {
  const criteria: ConditionalAcceptanceCriterion[] = [];
  let activeTrigger: ValidationTrigger | null = null;
  for (const rawLine of prompt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(?:[-*]\s*)?(?:do not|don't|never)\b/i.test(line)) continue;
    const label = line.replace(/^[-*]\s*/, "");
    const isSectionLabel = /:$/.test(label);
    if (isSectionLabel) {
      activeTrigger = inferSectionTrigger(label);
      continue;
    }
    const trigger =
      activeTrigger ??
      (validationIsPrimaryObjective ? "validation_is_objective" : "after_mutation");
    for (const [signal, pattern] of SIGNAL_PATTERNS) {
      if (!pattern.test(line)) continue;
      const id = `${trigger}:${signal}`;
      if (criteria.some((criterion) => criterion.id === id)) continue;
      criteria.push({
        id,
        criterion: line,
        trigger,
        signal,
        obligation: "required",
      });
    }
  }

  if (validationIsPrimaryObjective && criteria.length === 0) {
    const inferredSignal = inferValidationSignal(prompt);
    if (inferredSignal) {
      criteria.push({
        id: "validation_is_objective:primary",
        criterion: prompt.trim(),
        trigger: "validation_is_objective",
        signal: inferredSignal,
        obligation: "required",
      });
    }
  }

  if (criteria.length === 0 && assertions.length === 0 && !validationIsPrimaryObjective) {
    return [];
  }
  return criteria;
}

function parseStateAssertions(prompt: string): ObjectiveStateAssertion[] {
  const replacementLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^[-*]?\s*replace\b/i.test(line));
  const replacement = replacementLine?.match(
    /^[-*]?\s*replace\s+(.+?)\s+with\s+(.+?)\s+in\s+(?:all\s+)?(.+?)\.?\s*$/i,
  );
  if (!replacement) return [];
  const obsolete = cleanExpression(replacement[1]);
  const target = cleanExpression(replacement[2]);
  if (!obsolete || !target) return [];
  const scope = cleanExpression(replacement[3]) || null;
  return [
    { id: "target-present", kind: "must_exist", expression: target, scope },
    { id: "obsolete-absent", kind: "must_not_exist", expression: obsolete, scope },
  ];
}

function compileRepositoryAssertions(
  prompt: string,
  legacyAssertions: ObjectiveStateAssertion[],
): RepositoryObjectiveAssertion[] {
  const required = legacyAssertions.find((assertion) => assertion.kind === "must_exist");
  const forbidden = legacyAssertions.find((assertion) => assertion.kind === "must_not_exist");
  if (!required || !forbidden) return [];

  const semanticScope = compileScope(forbidden.scope ?? required.scope);
  const oldPattern = callTarget(forbidden.expression);
  const replacementPattern = callTarget(required.expression);
  if (!oldPattern || !replacementPattern) return [];

  return [
    {
      id: "forbidden-runtime-call-absent",
      kind: "forbidden_pattern_absent",
      pattern: oldPattern,
      matcher: "call_expression",
      scope: semanticScope,
      exclusions: defaultRepositoryExclusions(),
      reason: `Runtime scope must not contain calls to ${oldPattern}.`,
    },
    {
      id: "replacement-runtime-call-present",
      kind: "required_pattern_present",
      pattern: replacementPattern,
      matcher: "call_expression",
      scope: semanticScope,
      exclusions: defaultRepositoryExclusions(),
      reason: `Runtime scope must contain the replacement call ${replacementPattern}.`,
    },
    {
      id: "legacy-match-allowed-only",
      kind: "allowed_match_only",
      pattern: oldPattern.split(".").at(-1),
      matcher: "symbol",
      scope: ["semantic:repository_source"],
      exclusions: [...semanticScope, ...defaultRepositoryExclusions()],
      allowedContexts: ["declaration", "stub"],
      reason: `Remaining ${oldPattern} matches are allowed only in declarations or compatibility stubs outside runtime scope.`,
    },
    {
      id: "runtime-scope-covered",
      kind: "file_state",
      scope: semanticScope,
      exclusions: defaultRepositoryExclusions(),
      reason: "Every runtime file in the requested scope must be inspected.",
    },
  ];
}

function compileScope(scope: string | null | undefined) {
  const normalized = scope?.trim().toLowerCase() ?? "";
  if (/runtime\s+service/.test(normalized)) return ["semantic:runtime_service"];
  if (/runtime/.test(normalized)) return ["semantic:runtime_source"];
  if (scope?.trim()) return [scope.trim()];
  return ["semantic:repository_source"];
}

function defaultRepositoryExclusions() {
  return [
    "semantic:test",
    "semantic:documentation",
    "semantic:generated",
  ];
}

function callTarget(expression: string) {
  const value = expression.trim().replace(/[`'"]/g, "");
  const openingParen = value.indexOf("(");
  const target = (openingParen >= 0 ? value.slice(0, openingParen) : value).trim();
  return /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)+$/.test(target)
    ? target.replace(/\s+/g, "")
    : null;
}

function parseRequestedState(prompt: string, assertions: ObjectiveStateAssertion[]) {
  const firstMeaningful = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (assertions.length > 0) {
    return assertions.map((assertion) =>
      assertion.kind === "must_exist"
        ? `Target state exists: ${assertion.expression}`
        : `Obsolete state is absent: ${assertion.expression}`,
    );
  }
  return firstMeaningful ? [firstMeaningful] : ["Complete the requested repository work."];
}

function inferSectionTrigger(label: string): ValidationTrigger | null {
  const normalized = label.toLowerCase();
  if (/(?:after|once|upon|when)\b/.test(normalized) && MUTATION_WORDS.test(normalized)) {
    return "after_mutation";
  }
  if (/\b(?:if|when)\b.*\bprimary\b.*\b(?:fail|inconclusive)/.test(normalized)) {
    return "primary_failed";
  }
  return null;
}

function inferValidationSignal(text: string): ValidationSignal | null {
  return SIGNAL_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

function containsValidationSignal(text: string) {
  return SIGNAL_PATTERNS.some(([, pattern]) => pattern.test(text));
}

function strategyFor(
  mode: ObjectiveCompilerInput["mode"],
  intent: WorkIntent,
  validationIsPrimaryObjective: boolean,
  prompt: string,
): WorkStrategy {
  if (validationIsPrimaryObjective) return "validation";
  if (mode === "quality" || planningRequested(prompt)) return "planning";
  if (readOnlyConstraint(prompt)) return "inspection";
  if (mode === "analyze" || intent === "review_changes" || intent === "inspect" || intent === "security_review") return "inspection";
  return "work";
}

function planningRequested(prompt: string) {
  return /\b(?:make|create|produce|write|give|provide)\b[^.!?\n]{0,48}\b(?:implementation\s+)?plan\b/i.test(
    prompt,
  );
}

function mutationPermissionFor(
  policy: WorkspaceTrustContract | null | undefined,
  mode: ObjectiveCompilerInput["mode"],
  prompt: string,
): MutationPermission {
  if (readOnlyConstraint(prompt)) return "read_only";
  if (policy?.writeAccess === "read-only") return "read_only";
  if (policy?.writeAccess === "approval-required") return "ask_before_changes";
  if (policy?.writeAccess === "workspace") return "workspace_changes";
  return mode === "execute" ? "ask_before_changes" : "read_only";
}

function mostRestrictivePermission(
  policyPermission: MutationPermission,
  proposedPermission?: MutationPermission,
): MutationPermission {
  if (!proposedPermission) return policyPermission;
  const rank: Record<MutationPermission, number> = {
    read_only: 0,
    ask_before_changes: 1,
    workspace_changes: 2,
  };
  return rank[policyPermission] <= rank[proposedPermission]
    ? policyPermission
    : proposedPermission;
}

function readOnlyConstraint(prompt: string) {
  return (
    /\b(?:do not|don't|never)\s+(?:modify|change|edit|write|mutate|delete|touch)\b/i.test(prompt) ||
    /\b(?:read[- ]only|without\s+(?:making|writing|changing)\s+(?:changes|files))\b/i.test(prompt)
  ) && !/\bunless\s+(?:required|needed)\b/i.test(prompt);
}

function cleanExpression(value: string) {
  return value.trim().replace(/^[-*`\s]+|[-*`.\s]+$/g, "");
}

function normalizeCriterion(value: unknown): ConditionalAcceptanceCriterion | null {
  const record = recordOf(value);
  if (!record || typeof record.id !== "string" || typeof record.criterion !== "string") return null;
  const trigger = normalizeTrigger(record.trigger);
  if (!trigger) return null;
  const signal = normalizeSignal(record.signal);
  const obligation = normalizeObligation(record.obligation) ?? "required";
  return { id: record.id, criterion: record.criterion, trigger, signal, obligation };
}

function normalizeAssertion(value: unknown): ObjectiveStateAssertion | null {
  const record = recordOf(value);
  if (!record || typeof record.id !== "string" || typeof record.expression !== "string") return null;
  if (record.kind !== "must_exist" && record.kind !== "must_not_exist") return null;
  return {
    id: record.id,
    kind: record.kind,
    expression: record.expression,
    scope: typeof record.scope === "string" ? record.scope : null,
  };
}

function normalizeRepositoryAssertion(value: unknown): RepositoryObjectiveAssertion | null {
  const record = recordOf(value);
  if (!record || typeof record.id !== "string" || typeof record.reason !== "string") return null;
  if (![
    "forbidden_pattern_absent",
    "required_pattern_present",
    "allowed_match_only",
    "file_state",
  ].includes(String(record.kind))) return null;
  const pattern = typeof record.pattern === "string" && record.pattern.trim()
    ? record.pattern.trim()
    : undefined;
  if (record.kind !== "file_state" && !pattern) return null;
  const matcher = record.matcher === "literal" || record.matcher === "symbol" || record.matcher === "call_expression"
    ? record.matcher
    : undefined;
  return {
    id: record.id,
    kind: record.kind as RepositoryObjectiveAssertion["kind"],
    pattern,
    matcher,
    scope: stringArray(record.scope),
    exclusions: stringArray(record.exclusions),
    allowedContexts: Array.isArray(record.allowedContexts)
      ? record.allowedContexts.filter((context): context is "declaration" | "stub" =>
          context === "declaration" || context === "stub")
      : undefined,
    reason: record.reason,
  };
}

function normalizeTrigger(value: unknown): ValidationTrigger | null {
  return [
    "always",
    "after_mutation",
    "validation_is_objective",
    "primary_failed",
    "primary_inconclusive",
    "high_risk_change",
  ].includes(value as string)
    ? value as ValidationTrigger
    : null;
}

function normalizeSignal(value: unknown): ValidationSignal | undefined {
  return ["test", "typecheck", "lint", "build", "validation", "custom"].includes(value as string)
    ? value as ValidationSignal
    : undefined;
}

function normalizeObligation(value: unknown): ValidationObligation | undefined {
  return ["required", "recommended", "fallback"].includes(value as string)
    ? value as ValidationObligation
    : undefined;
}

function normalizeMutationPermission(value: unknown): MutationPermission | undefined {
  return ["read_only", "ask_before_changes", "workspace_changes"].includes(value as string)
    ? value as MutationPermission
    : undefined;
}

function normalizeStrategy(value: unknown): WorkStrategy | undefined {
  return ["work", "inspection", "planning", "validation"].includes(value as string)
    ? value as WorkStrategy
    : undefined;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}
