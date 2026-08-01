export type ValidationRequirementId =
  | "test"
  | "typecheck"
  | "lint"
  | "build"
  | "validation";

const PLACEHOLDER_VALIDATION_RE =
  /(?:^|\s)(?:echo|printf)\b[\s\S]*\bno validation command detected\b/i;

export function isExecutableValidationCommand(
  command: unknown,
): command is string {
  return (
    typeof command === "string" &&
    command.trim().length > 0 &&
    !PLACEHOLDER_VALIDATION_RE.test(command.trim())
  );
}

export function validationRequirementForCommand(
  command: string,
): ValidationRequirementId {
  const normalized = command.toLowerCase();
  if (/\btypecheck\b|\btsc\b/.test(normalized)) return "typecheck";
  if (/\blint\b|\beslint\b/.test(normalized)) return "lint";
  if (/\btest\b|\bvitest\b|\bjest\b/.test(normalized)) return "test";
  if (/\bbuild\b|\bpackage\b/.test(normalized)) return "build";
  return "validation";
}
