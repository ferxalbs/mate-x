import type { BehaviorMode } from "../../../contracts/behavior-mode";

export function buildValidationAuthoritySection(
  workPlanJson: string,
  behaviorMode: BehaviorMode = "execute",
) {
  try {
    const workPlan = JSON.parse(workPlanJson) as {
      objectiveContract?: {
        strategy?: string;
        validationIsPrimaryObjective?: boolean;
      };
      validationContract?: {
        items?: Array<{
          signal?: string;
          obligation?: string;
          trigger?: string;
          applicability?: string;
          command?: string | null;
          availability?: string;
          unavailableCause?: string;
        }>;
      };
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
    const contractItems = workPlan.validationContract?.items ?? [];
    const legacyRequirements = workPlan.validationPlan?.requirements ?? [];
    const items = contractItems.length > 0
      ? contractItems
      : legacyRequirements.map((requirement) => ({
          signal: requirement.id,
          obligation: "required",
          trigger: "always",
          applicability: "applicable",
          command: requirement.command,
          availability: requirement.availability === "resolved" ? "resolved" : "unavailable",
          unavailableCause: requirement.unavailableCause,
        }));
    const strategy = workPlan.objectiveContract?.strategy ?? "work";
    const modeAdapter = behaviorMode === "execute"
      ? "execute"
      : `${behaviorMode} compatibility adapter; capability policy still governs execution`;
    const readOnlyStrategy = strategy === "inspection" || strategy === "planning";
    const readOnlyAdapter = behaviorMode !== "execute" || readOnlyStrategy;
    const strategyInstruction = readOnlyAdapter
      ? strategy === "planning" || behaviorMode === "plan"
        ? "- This is a read-only plan; validation commands are planned outputs and must not execute."
        : "- This is a read-only inspection; validation commands must not execute."
      : "- Execute only the exact resolved command from the repository; its process evidence is required before claiming validation.";
    if (items.length === 0) {
      return [
        "Canonical Work validation authority:",
        `- strategy: ${strategy}; adapter: ${modeAdapter}`,
        strategyInstruction,
        "- No validation signals are currently compiled. Conditional checks activate only when their trigger is true.",
      ].join("\n");
    }

    const lines = items.map((item) => {
      const command = item.command ?? "(none)";
      const state = item.availability === "resolved" && !readOnlyAdapter
        ? `resolved: ${command}`
        : `${item.availability ?? "unavailable"}: ${item.unavailableCause ?? "VALIDATION_COMMAND_UNRESOLVED"}`;
      return `- ${item.signal ?? "validation"} [${item.obligation ?? "required"}; trigger ${item.trigger ?? "always"}; ${item.applicability ?? "pending_trigger"}]: ${state}`;
    });
    return [
      "Canonical Work validation authority:",
      `- strategy: ${strategy}; adapter: ${modeAdapter}`,
      strategyInstruction,
      "- Obligations are independent. A signal is blocking only when it is required and applicable.",
      ...lines,
      "- Use only exact repository-authorized commands. Never invent a substitute for an unavailable or ambiguous signal.",
    ].join("\n");
  } catch {
    return "Validation authority for this run:\n- WorkPlan validation data could not be parsed; stop and obtain a typed validation plan before executing checks.";
  }
}
