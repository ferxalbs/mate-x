import type { BehaviorMode } from "../../../contracts/behavior-mode";

export function buildValidationAuthoritySection(
  workPlanJson: string,
  behaviorMode: BehaviorMode = "execute",
) {
  if (behaviorMode === "review") {
    return "Validation authority for this run:\n- Review mode is read-only; do not execute validation or present validation as proof.";
  }
  if (behaviorMode === "plan") {
    return "Validation authority for this run:\n- Plan mode may describe repository-backed validation requirements, but must not execute them or claim proof.";
  }
  try {
    const workPlan = JSON.parse(workPlanJson) as {
      validationPlan?: {
        required?: boolean;
        requirements?: Array<{
          id?: string;
          command?: string | null;
          availability?: string;
          unavailableCause?: string;
        }>;
      };
    };
    const validationPlan = workPlan.validationPlan;
    const requirements = validationPlan?.requirements ?? [];
    if (!validationPlan?.required || requirements.length === 0) {
      return "Validation authority for this run:\n- No typed required validation requirements are present in the WorkPlan.";
    }

    const lines = requirements.map((requirement) => {
      const command = requirement.command ?? "(none)";
      const state = requirement.availability === "resolved"
        ? `resolved: ${command}`
        : `unresolved: ${requirement.unavailableCause ?? "VALIDATION_COMMAND_UNRESOLVED"}`;
      return `- ${requirement.id ?? "validation"}: ${state}`;
    });
    return [
      "Validation authority for this run:",
      "- Required requirements are independent; every line below needs its own typed proof.",
      ...lines,
      "- Use only the exact resolved command shown above. Never invent a substitute for an unresolved line.",
    ].join("\n");
  } catch {
    return "Validation authority for this run:\n- WorkPlan validation data could not be parsed; stop and obtain a typed validation plan before executing checks.";
  }
}
