import type { SearchMatch, WorkspaceTrustContract } from "../../contracts/workspace";
import type {
  ConditionalAcceptanceCriterion,
  MutationPermission,
  ObjectiveState,
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

export interface ObjectiveEvidenceExecution {
  toolName: string;
  args: Record<string, unknown>;
  output: string;
  parsedOutput?: Record<string, unknown>;
  changedFiles?: string[];
}

export interface ResolvedObjectiveEvidence {
  state: ObjectiveState;
  evidenceIds: string[];
  summary: string;
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

export function resolveObjectiveEvidence(
  objective: WorkObjectiveContract,
  executions: ObjectiveEvidenceExecution[],
  initialInspection?: { matches?: SearchMatch[] },
): ResolvedObjectiveEvidence {
  const evidenceIds: string[] = [];
  let explicitSatisfied = false;
  let explicitUnsatisfied = false;

  for (const execution of executions) {
    const objectiveEvidence = recordOf(execution.parsedOutput?.objectiveEvidence);
    if (!objectiveEvidence) continue;
    const state = objectiveEvidence.state;
    const targetStateSatisfied = objectiveEvidence.targetStateSatisfied;
    const prohibitedStateAbsent = objectiveEvidence.prohibitedStateAbsent;
    if (
      state === "satisfied" &&
      targetStateSatisfied !== false &&
      prohibitedStateAbsent !== false
    ) {
      explicitSatisfied = true;
      evidenceIds.push(executionId(execution));
    } else if (state === "unsatisfied") {
      explicitUnsatisfied = true;
      evidenceIds.push(executionId(execution));
    }
  }

  const assertionResults = objective.stateAssertions.map((assertion) => ({
    assertion,
    proven: assertionProven(assertion, executions, initialInspection?.matches ?? []),
  }));
  const allAssertionsProven = assertionResults.length > 0 && assertionResults.every((result) => result.proven);
  const anyAssertionDisproved = assertionResults.some((result) => result.proven === false);
  const assertionEvidenceIds = assertionResults
    .filter((result) => result.proven !== undefined)
    .map((result) => `assertion:${result.assertion.id}`);
  evidenceIds.push(...assertionEvidenceIds);

  if (explicitSatisfied || allAssertionsProven) {
    return {
      state: "satisfied",
      evidenceIds: unique(evidenceIds),
      summary: "Repository evidence proves the requested target state is already satisfied.",
    };
  }
  if (explicitUnsatisfied || anyAssertionDisproved) {
    return {
      state: "unsatisfied",
      evidenceIds: unique(evidenceIds),
      summary: "Repository evidence shows that at least one requested state assertion is not satisfied.",
    };
  }
  return {
    state: "unknown",
    evidenceIds: unique(evidenceIds),
    summary: "Repository evidence is insufficient to classify the requested target state.",
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

function assertionProven(
  assertion: ObjectiveStateAssertion,
  executions: ObjectiveEvidenceExecution[],
  initialMatches: SearchMatch[],
): boolean | undefined {
  if (assertion.kind === "must_exist") {
    const initialMatch = initialMatches.some((match) =>
      containsExpression(match.text, assertion.expression) && scopeMatches(assertion.scope, match.file),
    );
    const executionMatch = executions.some((execution) => {
      if (isNegativeSearchResult(execution)) return false;
      return containsExpression(execution.output, assertion.expression) &&
        scopeMatches(assertion.scope, stringValue(execution.args.path));
    });
    return initialMatch || executionMatch ? true : undefined;
  }

  const negativeSearch = executions.some((execution) => {
    const query = stringValue(execution.args.query);
    const searchedScope = stringValue(execution.args.path);
    return (
      isSearchTool(execution.toolName) &&
      typeof query === "string" &&
      containsExpression(assertion.expression, query) &&
      scopeMatches(assertion.scope, searchedScope) &&
      isNegativeSearchResult(execution)
    );
  });
  return negativeSearch ? true : undefined;
}

function isNegativeSearchResult(execution: ObjectiveEvidenceExecution) {
  const discovery = recordOf(execution.parsedOutput);
  if (discovery?.discoveryStatus === "no_matches" && Array.isArray(discovery.matches) && discovery.matches.length === 0) {
    return true;
  }
  return /no matches found|no matching files/i.test(execution.output);
}

function scopeMatches(scope: string | null | undefined, searchedPath: string | undefined) {
  if (!scope) return true;
  if (!searchedPath) return true;
  const tokens = scope.toLowerCase().match(/[a-z0-9_-]{4,}/g) ?? [];
  if (tokens.length === 0) return true;
  const normalizedPath = searchedPath.toLowerCase();
  return tokens.some((token) => normalizedPath.includes(token));
}

function containsExpression(value: string | undefined, expression: string) {
  if (!value) return false;
  const compact = (text: string) => text.replace(/\s+/g, "").toLowerCase();
  return compact(value).includes(compact(expression));
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

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function isSearchTool(toolName: string) {
  return ["rg", "ast_grep", "glob", "find"].includes(toolName.trim().toLowerCase());
}

function executionId(execution: ObjectiveEvidenceExecution) {
  const value = execution.parsedOutput?.executionId;
  return typeof value === "string" ? value : `tool:${execution.toolName}`;
}

function unique(values: string[]) {
  return [...new Set(values)];
}
