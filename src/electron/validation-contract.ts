import type {
  NormalizedToolEvidence,
} from "../contracts/execution";
import type {
  ValidationApplicability,
  ValidationAvailability,
  ValidationCommandAuthoritySource,
  ValidationContract,
  ValidationContractItem,
  ValidationEvidenceStatus,
  ValidationObligation,
  ValidationSignal,
  ValidationTrigger,
  WorkObjectiveContract,
} from "../contracts/work-objective";
import type {
  ValidationCost,
  ValidationPlan,
  ValidationPlanCommand,
  ValidationRequirementId,
  ValidationUnavailableCause,
} from "../contracts/workspace";
import type { RepositoryToolchainProfile } from "./repository-toolchain";
import type { WorkPlan, WorkRisk, WorkRunbook } from "./work-engine/types";
import {
  isExecutableValidationCommand,
  isObsoleteValidationCommand,
} from "./validation-command";

export interface ValidationCompilerInput {
  objective: WorkObjectiveContract;
  targetToolchain?: RepositoryToolchainProfile;
  scripts?: Array<{
    name: string;
    command: string;
    signal: "test" | "lint" | "typecheck" | "build" | "dev" | "other";
  }>;
  risk: WorkRisk;
  runbook: WorkRunbook;
  requiresPostMutationValidation: boolean;
  preferredPrimaryCommand?: string | null;
  fallbackCommand?: string | null;
}

export interface ValidationActivationContext {
  phase: "initial" | "final";
  actualMutation: boolean;
  objectiveAlreadySatisfied: boolean;
  validationIsPrimaryObjective: boolean;
  highRiskChange: boolean;
  primaryStatus?: "passed" | "failed" | "inconclusive";
  evidence?: NormalizedToolEvidence[];
}

const STANDARD_SIGNALS: ValidationSignal[] = ["test", "typecheck", "lint", "build"];

export function hasHighRiskChange(files: string[]) {
  return files.some((file) =>
    /(?:^|\/)(?:authorization|auth|permissions?|roles?)[^/]*\.(?:ts|tsx|js|jsx)$|(?:^|\/)(?:contracts|electron)\//i.test(file),
  );
}

export function compileValidationContract(input: ValidationCompilerInput): ValidationContract {
  const requested = input.objective.conditionalAcceptanceCriteria
    .filter((criterion) => criterion.signal)
    .map((criterion) => ({
      id: criterion.id,
      signal: criterion.signal!,
      obligation: criterion.obligation ?? "required",
      trigger: criterion.trigger,
      reason: criterion.criterion,
    }));

  if (requested.length === 0 && input.requiresPostMutationValidation) {
    const preferredSignal = signalForCommand(input.preferredPrimaryCommand) ?? firstAvailableSignal(input);
    if (preferredSignal) {
      requested.push({
        id: `after_mutation:${preferredSignal}`,
        signal: preferredSignal,
        obligation: "required",
        trigger: "after_mutation",
        reason: `${input.runbook} requires repository validation after a mutation is confirmed.`,
      });
    }
  }

  if (input.fallbackCommand) {
    const fallbackSignal = signalForCommand(input.fallbackCommand) ?? "build";
    const fallbackTrigger: ValidationTrigger = input.risk === "high"
      ? "high_risk_change"
      : "primary_failed";
    requested.push({
      id: `fallback:${fallbackSignal}`,
      signal: fallbackSignal,
      obligation: "fallback",
      trigger: fallbackTrigger,
      reason: input.risk === "high"
        ? "High-risk changes require the configured fallback evidence."
        : "Fallback validation activates only after the primary signal fails or is inconclusive.",
    });
  }

  const deduped = new Map<string, typeof requested[number]>();
  for (const item of requested) {
    const key = `${item.signal}:${item.obligation}:${item.trigger}`;
    if (!deduped.has(key)) deduped.set(key, item);
  }

  return {
    schemaVersion: 1,
    items: [...deduped.values()].map((item) => {
      const commandResolution = resolveCommand(input, item.signal, item.id);
      return {
        id: item.id,
        signal: item.signal,
        obligation: item.obligation,
        trigger: item.trigger,
        applicability: initialApplicability(item.trigger, input.objective.validationIsPrimaryObjective),
        availability: commandResolution.availability,
        command: commandResolution.command,
        commandSource: commandResolution.commandSource,
        unavailableCause: commandResolution.unavailableCause,
        evidence: { status: "not_run" },
        reason: item.reason,
      } satisfies ValidationContractItem;
    }),
    actualMutation: false,
    objectiveAlreadySatisfied: input.objective.objectiveAlreadySatisfied,
    validationIsPrimaryObjective: input.objective.validationIsPrimaryObjective,
    compiledAt: new Date().toISOString(),
    source: "canonical_compiler",
  };
}

export function compileActiveValidationContract(
  contract: ValidationContract,
  context: ValidationActivationContext,
): ValidationContract {
  const evidence = context.evidence ?? [];
  const items = contract.items.map((item) => {
    const applicability = resolveApplicability(item.trigger, context);
    const matchingEvidence = evidence.find((candidate) =>
      candidate.validationRequirementId === item.signal ||
      (candidate.validationRequirementId === "validation" && item.signal === "custom"),
    );
    const evidenceStatus = evidenceStatusFor(applicability, item.availability, matchingEvidence);
    return {
      ...item,
      applicability,
      evidence: {
        status: evidenceStatus,
        executionId: matchingEvidence?.validationExecutionId,
        approvalProvenance: matchingEvidence?.validationAuthorization,
      },
    };
  });
  return {
    ...contract,
    items,
    actualMutation: context.actualMutation,
    objectiveAlreadySatisfied: context.objectiveAlreadySatisfied,
    compiledAt: new Date().toISOString(),
  };
}

export function contractForWorkPlan(workPlan: WorkPlan): ValidationContract {
  if (workPlan.validationContract) return workPlan.validationContract;
  return legacyPlanToValidationContract(workPlan.validationPlan);
}

export function activeContractForWorkPlan(
  workPlan: WorkPlan,
  context: ValidationActivationContext,
): ValidationContract {
  return compileActiveValidationContract(contractForWorkPlan(workPlan), context);
}

export function requiredApplicableItems(contract: ValidationContract) {
  return contract.items.filter(
    (item) =>
      (item.obligation === "required" || item.obligation === "fallback") &&
      item.applicability === "applicable",
  );
}

export function blockingValidationItems(contract: ValidationContract) {
  return requiredApplicableItems(contract).filter(
    (item) => (item.availability !== "resolved" && item.evidence.approvalProvenance !== "approved_override") ||
      ["failed", "blocked", "inconclusive", "not_run", "running"].includes(item.evidence.status),
  );
}

export function contractToLegacyRequirements(contract: ValidationContract): NonNullable<ValidationPlan["requirements"]> {
  return contract.items.map((item) => {
    const base = {
      command: item.command,
      availability: item.availability === "resolved" ? "resolved" as const : "unresolved" as const,
      requirementId: legacyRequirementId(item.signal),
      source: legacySource(item.commandSource),
      reason: item.reason,
      estimatedCost: estimatedCost(item.signal),
      expectedSignal: `${item.signal} evidence for the canonical work objective.`,
    };
    return item.unavailableCause
      ? { ...base, unavailableCause: item.unavailableCause }
      : base;
  });
}

export function legacyPlanToValidationContract(plan: WorkPlan["validationPlan"]): ValidationContract {
  const primarySignal = signalForCommand(plan.primaryCommand);
  const primaryId: ValidationRequirementId =
    primarySignal && primarySignal !== "custom" ? primarySignal : "validation";
  const legacyItems: Array<{
    id: ValidationRequirementId;
    command: string | null;
    availability: "resolved" | "unresolved";
    unavailableCause?: "VALIDATION_COMMAND_UNRESOLVED" | "TYPECHECK_UNAVAILABLE" | "TOOLCHAIN_AMBIGUOUS";
    source?: ValidationPlanCommand["source"];
    reason?: string;
  }> = (plan.requirements ?? []).length > 0
    ? (plan.requirements ?? []).map((item) => ({
        id: item.id,
        command: item.command,
        availability: item.availability,
        unavailableCause: item.unavailableCause,
      }))
    : plan.required
      ? [{
          id: primaryId,
          command: plan.primaryCommand,
          availability: plan.primaryCommand ? "resolved" as const : "unresolved" as const,
          unavailableCause: plan.primaryCommand ? undefined : "VALIDATION_COMMAND_UNRESOLVED" as const,
        }]
      : [];
  return {
    schemaVersion: 1,
    items: legacyItems.map((item) => ({
      id: item.id,
      signal: item.id,
      obligation: "required" as const,
      trigger: "always" as const,
      applicability: "applicable" as const,
      availability: item.availability === "resolved" ? "resolved" as const : "unavailable" as const,
      command: item.command,
      commandSource: item.source === "repository_script" ? "repository_script" as const : "legacy_plan" as const,
      unavailableCause: item.unavailableCause,
      evidence: { status: "not_run" as const },
      reason: item.reason ?? "Legacy validation requirement.",
    })),
    actualMutation: false,
    objectiveAlreadySatisfied: false,
    validationIsPrimaryObjective: false,
    compiledAt: new Date().toISOString(),
    source: "legacy_adapter",
  };
}

/**
 * Normalize JSON persisted by older validation-plan versions. The current
 * repository snapshot remains the command authority; this only makes the
 * cached shape safe to deserialize and gives legacy requirements explicit
 * canonical obligation/trigger defaults.
 */
export function normalizePersistedValidationPlan(value: unknown): ValidationPlan | null {
  const record = recordOf(value);
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.objective !== "string" ||
    !stringArrayValue(record.changedFiles) ||
    !stringArrayValue(record.impactedFiles)
  ) {
    return null;
  }

  const primary = normalizePersistedCommand(record.primary, "validation");
  const fallback = normalizePersistedCommand(record.fallback, "validation");
  if (!primary || !fallback) return null;

  const requirements = Array.isArray(record.requirements)
    ? record.requirements
        .map((item) => normalizePersistedCommand(item, "validation"))
        .filter((item): item is ValidationPlanCommand => item !== null)
    : [];
  const riskLevel = record.riskLevel === "low" || record.riskLevel === "medium" || record.riskLevel === "high"
    ? record.riskLevel
    : "medium";
  const normalized: ValidationPlan = {
    id: record.id,
    objective: record.objective,
    changedFiles: stringArrayValue(record.changedFiles)!,
    impactedFiles: stringArrayValue(record.impactedFiles)!,
    detectedFramework: typeof record.detectedFramework === "string" ? record.detectedFramework : undefined,
    riskLevel,
    primary,
    fallback,
    requirements,
    authority: normalizePersistedAuthority(record.authority),
    fallbackTrigger: typeof record.fallbackTrigger === "string" ? record.fallbackTrigger : "primary_failed",
    recommendations: stringArrayValue(record.recommendations) ?? [],
    comments: stringArrayValue(record.comments) ?? [],
    executionState: normalizePersistedExecutionState(record.executionState),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
  };

  if (isValidationContract(record.contract)) {
    normalized.contract = record.contract;
  } else if (record.contract === undefined) {
    normalized.contract = persistedRequirementsToContract(requirements);
  }

  return normalized;
}

function persistedRequirementsToContract(
  requirements: ValidationPlanCommand[],
): ValidationContract {
  return {
    schemaVersion: 1,
    items: requirements.map((requirement) => ({
      id: requirement.requirementId,
      signal: requirement.requirementId,
      obligation: "required",
      trigger: "always",
      applicability: "applicable",
      availability: requirement.availability === "resolved" ? "resolved" : "unavailable",
      command: requirement.command,
      commandSource: requirement.source === "repository_script" || requirement.source === "local_toolchain" || requirement.source === "native"
        ? requirement.source
        : "legacy_plan",
      ...(requirement.unavailableCause ? { unavailableCause: requirement.unavailableCause } : {}),
      evidence: { status: "not_run" },
      reason: requirement.reason,
    })),
    actualMutation: false,
    objectiveAlreadySatisfied: false,
    validationIsPrimaryObjective: false,
    compiledAt: new Date(0).toISOString(),
    source: "legacy_adapter",
  };
}

function normalizePersistedCommand(value: unknown, fallbackId: ValidationRequirementId): ValidationPlanCommand | null {
  const record = recordOf(value);
  if (!record) return null;
  const requirementId = isValidationRequirementId(record.requirementId)
    ? record.requirementId
    : fallbackId;
  const command = typeof record.command === "string" && record.command.trim() ? record.command : null;
  const availability = record.availability === "resolved" && command ? "resolved" : "unresolved";
  const source = record.source === "repository_script" || record.source === "local_toolchain" || record.source === "native"
    ? record.source
    : null;
  const unavailableCause = isValidationUnavailableCause(record.unavailableCause)
    ? record.unavailableCause
    : undefined;
  return {
    command,
    availability,
    requirementId,
    source,
    ...(unavailableCause ? { unavailableCause } : {}),
    reason: typeof record.reason === "string" ? record.reason : "Legacy validation requirement.",
    estimatedCost: record.estimatedCost === "cheap" || record.estimatedCost === "medium" || record.estimatedCost === "expensive"
      ? record.estimatedCost
      : "medium",
    expectedSignal: typeof record.expectedSignal === "string"
      ? record.expectedSignal
      : `${requirementId} evidence for the persisted validation plan.`,
  };
}

function normalizePersistedAuthority(value: unknown): ValidationPlan["authority"] {
  const record = recordOf(value);
  if (!record) return undefined;
  return {
    packagePath: typeof record.packagePath === "string" ? record.packagePath : undefined,
    manager: typeof record.manager === "string" ? record.manager : null,
    managerSource: typeof record.managerSource === "string" ? record.managerSource : null,
    status: record.status === "resolved" || record.status === "ambiguous" || record.status === "unavailable"
      ? record.status
      : undefined,
    cause: isValidationUnavailableCause(record.cause) ? record.cause : undefined,
  };
}

function normalizePersistedExecutionState(value: unknown): ValidationPlan["executionState"] {
  const record = recordOf(value);
  return {
    primary: "not_run",
    fallback: "not_run",
    persistence: "not_verified",
    blockingInstruction: typeof record?.blockingInstruction === "string"
      ? record.blockingInstruction
      : "Execute only current repository-authorized validation commands.",
  };
}

function isValidationContract(value: unknown): value is ValidationContract {
  const record = recordOf(value);
  if (!record || record.schemaVersion !== 1 || !Array.isArray(record.items)) return false;
  return record.items.every((item) => {
    const candidate = recordOf(item);
    const evidence = recordOf(candidate?.evidence);
    return Boolean(
      candidate &&
      typeof candidate.id === "string" &&
      isValidationSignal(candidate.signal) &&
      isValidationObligation(candidate.obligation) &&
      isValidationTrigger(candidate.trigger) &&
      isValidationApplicability(candidate.applicability) &&
      isValidationAvailability(candidate.availability) &&
      (candidate.command === null || typeof candidate.command === "string") &&
      isValidationCommandSource(candidate.commandSource) &&
      (!candidate.unavailableCause || isValidationUnavailableCause(candidate.unavailableCause)) &&
      evidence &&
      isValidationEvidenceStatus(evidence.status) &&
      typeof candidate.reason === "string"
    );
  });
}

function isValidationRequirementId(value: unknown): value is ValidationRequirementId {
  return value === "test" || value === "typecheck" || value === "lint" || value === "build" || value === "validation";
}

function isValidationSignal(value: unknown): value is ValidationSignal {
  return isValidationRequirementId(value) || value === "custom";
}

function isValidationUnavailableCause(value: unknown): value is ValidationUnavailableCause {
  return value === "VALIDATION_COMMAND_UNRESOLVED" || value === "TYPECHECK_UNAVAILABLE" || value === "TOOLCHAIN_AMBIGUOUS";
}

function isValidationObligation(value: unknown): value is ValidationObligation {
  return value === "required" || value === "recommended" || value === "fallback";
}

function isValidationTrigger(value: unknown): value is ValidationTrigger {
  return value === "always" || value === "after_mutation" || value === "validation_is_objective" || value === "primary_failed" || value === "primary_inconclusive" || value === "high_risk_change";
}

function isValidationApplicability(value: unknown): value is ValidationApplicability {
  return value === "applicable" || value === "not_applicable" || value === "pending_trigger";
}

function isValidationAvailability(value: unknown): value is ValidationAvailability {
  return value === "resolved" || value === "unavailable" || value === "ambiguous";
}

function isValidationEvidenceStatus(value: unknown): value is ValidationEvidenceStatus {
  return value === "not_run" || value === "running" || value === "passed" || value === "failed" || value === "blocked" || value === "inconclusive";
}

function isValidationCommandSource(value: unknown): value is ValidationCommandAuthoritySource {
  return value === null || value === "repository_script" || value === "local_toolchain" || value === "deno" || value === "native" || value === "explicit_objective" || value === "legacy_plan";
}

function stringArrayValue(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function initialApplicability(
  trigger: ValidationTrigger,
  validationIsPrimaryObjective: boolean,
): ValidationApplicability {
  if (trigger === "always") return "applicable";
  if (trigger === "validation_is_objective" && validationIsPrimaryObjective) return "applicable";
  return "pending_trigger";
}

function resolveApplicability(
  trigger: ValidationTrigger,
  context: ValidationActivationContext,
): ValidationApplicability {
  switch (trigger) {
    case "always":
      return "applicable";
    case "after_mutation":
      return context.actualMutation
        ? "applicable"
        : context.phase === "final" ? "not_applicable" : "pending_trigger";
    case "validation_is_objective":
      return context.validationIsPrimaryObjective
        ? "applicable"
        : "not_applicable";
    case "primary_failed":
      return context.primaryStatus === "failed"
        ? "applicable"
        : context.phase === "final" ? "not_applicable" : "pending_trigger";
    case "primary_inconclusive":
      return context.primaryStatus === "inconclusive"
        ? "applicable"
        : context.phase === "final" ? "not_applicable" : "pending_trigger";
    case "high_risk_change":
      return context.actualMutation && context.highRiskChange
        ? "applicable"
        : context.phase === "final" ? "not_applicable" : "pending_trigger";
  }
}

function evidenceStatusFor(
  applicability: ValidationApplicability,
  availability: ValidationAvailability,
  evidence: NormalizedToolEvidence | undefined,
): ValidationEvidenceStatus {
  if (!evidence?.validationStatus) return "not_run";
  // Preserve the truth of an actually started command even when the cached
  // plan classified that signal as unavailable. Historical runs may contain
  // an execution attempt recorded before the current repository-aware
  // authority was introduced; rewriting its non-zero exit as "not run" would
  // erase failure evidence during compatibility reduction.
  if (evidence.validationStatus === "failed") return "failed";
  if (
    availability !== "resolved" &&
    applicability === "applicable" &&
    evidence.validationAuthorization !== "approved_override"
  ) return "not_run";
  if (evidence.validationStatus === "pending") return "inconclusive";
  return evidence.validationStatus;
}

function resolveCommand(
  input: ValidationCompilerInput,
  signal: ValidationSignal,
  itemId: string,
): {
  command: string | null;
  availability: ValidationAvailability;
  commandSource: ValidationCommandAuthoritySource;
  unavailableCause?: "VALIDATION_COMMAND_UNRESOLVED" | "TYPECHECK_UNAVAILABLE" | "TOOLCHAIN_AMBIGUOUS";
} {
  const standardSignal = STANDARD_SIGNALS.includes(signal as Exclude<ValidationSignal, "custom" | "validation">)
    ? signal as Exclude<ValidationSignal, "custom" | "validation">
    : null;
  const preferred = itemId.startsWith("fallback:")
    ? input.fallbackCommand
    : input.preferredPrimaryCommand;
  const authoritative = standardSignal
    ? input.targetToolchain?.commands[standardSignal]?.command
    : null;
  const preferredIsAuthorized = Boolean(
    preferred &&
      authoritative &&
      (normalizeCommand(preferred) === normalizeCommand(authoritative) ||
        normalizeCommand(preferred).startsWith(`${normalizeCommand(authoritative)} `)),
  );
  if (preferredIsAuthorized && (standardSignal === signalForCommand(preferred) || !standardSignal)) {
    return {
      command: preferred ?? null,
      availability: "resolved",
      commandSource: "explicit_objective",
    };
  }
  const profileCommand = standardSignal ? input.targetToolchain?.commands[standardSignal]?.command : null;
  const profileSource = standardSignal ? input.targetToolchain?.commands[standardSignal]?.source : null;
  if (profileCommand) {
    return {
      command: profileCommand,
      availability: "resolved",
      commandSource: mapSource(profileSource),
    };
  }
  const script = input.scripts?.find(
    (candidate) =>
      candidate.signal === standardSignal &&
      isExecutableValidationCommand(candidate.command) &&
      !isObsoleteValidationCommand(candidate.command),
  );
  if (script) {
    return {
      command: script.command,
      availability: "resolved",
      commandSource: "repository_script",
    };
  }
  return {
    command: null,
    availability: input.targetToolchain?.status === "ambiguous" ? "ambiguous" : "unavailable",
    commandSource: null,
    unavailableCause:
      input.targetToolchain?.status === "ambiguous"
        ? "TOOLCHAIN_AMBIGUOUS"
        : signal === "typecheck"
          ? input.targetToolchain?.cause === "TOOLCHAIN_AMBIGUOUS"
            ? "TOOLCHAIN_AMBIGUOUS"
            : "TYPECHECK_UNAVAILABLE"
          : "VALIDATION_COMMAND_UNRESOLVED",
  };
}

function normalizeCommand(command: string) {
  return command.trim().replace(/\s+/g, " ");
}

function firstAvailableSignal(input: ValidationCompilerInput): ValidationSignal | null {
  for (const signal of STANDARD_SIGNALS) {
    if (resolveCommand(input, signal, "default").availability === "resolved") return signal;
  }
  return input.targetToolchain?.cause === "TOOLCHAIN_AMBIGUOUS" ? "test" : "typecheck";
}

function signalForCommand(command: string | null | undefined): ValidationSignal | null {
  if (!command) return null;
  const normalized = command.toLowerCase();
  if (/\btypecheck\b|\btsc\b/.test(normalized)) return "typecheck";
  if (/\blint\b|\beslint\b/.test(normalized)) return "lint";
  if (/\bbuild\b|\bpackage\b/.test(normalized)) return "build";
  if (/\btest\b|\bvitest\b|\bjest\b/.test(normalized)) return "test";
  return "custom";
}

function mapSource(source: "script" | "local_toolchain" | "deno" | "native" | null | undefined): ValidationCommandAuthoritySource {
  switch (source) {
    case "script": return "repository_script";
    case "local_toolchain": return "local_toolchain";
    case "deno": return "deno";
    case "native": return "native";
    default: return null;
  }
}

function legacyRequirementId(signal: ValidationSignal): ValidationRequirementId {
  return signal === "custom" ? "validation" : signal;
}

function legacySource(source: ValidationCommandAuthoritySource): ValidationPlanCommand["source"] {
  return source === "repository_script" || source === "local_toolchain" || source === "native"
    ? source
    : null;
}

function estimatedCost(signal: ValidationSignal): ValidationCost {
  return signal === "build" ? "expensive" : signal === "typecheck" || signal === "lint" ? "medium" : "cheap";
}
