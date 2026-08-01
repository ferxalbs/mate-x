import type { ValidationPlan } from "../contracts/workspace";

export type ValidationRequirementId =
  | "test"
  | "typecheck"
  | "lint"
  | "build"
  | "validation";

const PLACEHOLDER_VALIDATION_RE =
  /(?:^|\s)(?:echo|printf)\b[\s\S]*\bno validation command detected\b/i;

const VALIDATION_COMMAND_RE =
  /\b(?:test|tests|typecheck|type-check|tsc|lint|eslint|build|compile|check|verify|vitest|jest|mocha|pytest)\b|\b(?:cargo|go)\s+test\b/i;

export type ValidationResolutionCause =
  | "VALIDATION_COMMAND_UNRESOLVED"
  | "TYPECHECK_UNAVAILABLE"
  | "TOOLCHAIN_AMBIGUOUS";

export function isExecutableValidationCommand(
  command: unknown,
): command is string {
  return (
    typeof command === "string" &&
    command.trim().length > 0 &&
    !PLACEHOLDER_VALIDATION_RE.test(command.trim())
  );
}

export function normalizeValidationCommand(command: string) {
  return command.trim().replace(/\s+/g, " ");
}

export function findValidationPlanCommand(
  command: string,
  validationPlan?: ValidationPlan | null,
) {
  if (!validationPlan) return undefined;

  const normalizedCommand = normalizeValidationCommand(command);
  for (const slot of ["primary", "fallback"] as const) {
    const candidate = validationPlan[slot];
    if (
      candidate.availability !== "unresolved" &&
      candidate.command &&
      normalizeValidationCommand(candidate.command) === normalizedCommand
    ) {
      return {
        slot,
        command: candidate.command,
        requirementId: candidate.requirementId,
      };
    }
  }

  return undefined;
}

/** True for commands that claim to produce validation proof, not diagnostics. */
export function isValidationLikeCommand(command: string) {
  return VALIDATION_COMMAND_RE.test(normalizeValidationCommand(command));
}

export function isValidationResolutionCause(
  value: unknown,
): value is ValidationResolutionCause {
  return (
    value === "VALIDATION_COMMAND_UNRESOLVED" ||
    value === "TYPECHECK_UNAVAILABLE" ||
    value === "TOOLCHAIN_AMBIGUOUS"
  );
}

export function validationRequirementForCommand(
  command: string,
): ValidationRequirementId {
  const normalized = command.toLowerCase();
  if (/\btypecheck\b|\btype-check\b|\btsc\b|\bcheck(?::|-|\s+)types?\b/.test(normalized)) return "typecheck";
  if (/\blint\b|\beslint\b/.test(normalized)) return "lint";
  if (/\btest\b|\bvitest\b|\bjest\b/.test(normalized)) return "test";
  if (/\bbuild\b|\bpackage\b/.test(normalized)) return "build";
  return "validation";
}
