import type { AssistantRunOptions } from "./chat";

export const BEHAVIOR_MODES = ["auto", "guided", "review", "custom"] as const;
export type BehaviorMode = (typeof BEHAVIOR_MODES)[number];
export const AUTONOMY_POLICIES = [
  "auto_scoped",
  "guided_approval",
  "review_read_only",
  "custom",
] as const;
export type AutonomyPolicyId = (typeof AUTONOMY_POLICIES)[number];

export interface CustomBehaviorPolicy {
  askBeforeEdits: boolean;
  askBeforeCommands: boolean;
  askBeforeNetwork: boolean;
  askBeforeGit: boolean;
  autoValidate: boolean;
}

export interface BehaviorPreference {
  mode: BehaviorMode;
  custom: CustomBehaviorPolicy;
}

export interface AutonomyPolicy {
  id: AutonomyPolicyId;
  custom?: CustomBehaviorPolicy;
}

export function behaviorAutonomyPolicy(
  preference: BehaviorPreference,
): AutonomyPolicy {
  switch (preference.mode) {
    case "auto": return { id: "auto_scoped" };
    case "guided": return { id: "guided_approval" };
    case "review": return { id: "review_read_only" };
    case "custom": return { id: "custom", custom: { ...preference.custom } };
  }
}

export const DEFAULT_CUSTOM_BEHAVIOR: CustomBehaviorPolicy = {
  askBeforeEdits: true,
  askBeforeCommands: true,
  askBeforeNetwork: true,
  askBeforeGit: true,
  autoValidate: true,
};

export const DEFAULT_BEHAVIOR_PREFERENCE: BehaviorPreference = {
  mode: "auto",
  custom: DEFAULT_CUSTOM_BEHAVIOR,
};

export function behaviorRunOptions(
  preference: BehaviorPreference,
): Pick<AssistantRunOptions, "access" | "pathKind" | "runbookId" | "autonomyPolicy"> {
  if (preference.mode === "review") {
    return {
      access: "approval",
      pathKind: "verify_only",
      runbookId: "review_classify_summarize",
      autonomyPolicy: behaviorAutonomyPolicy(preference),
    };
  }
  const needsApproval =
    preference.mode === "guided" ||
    (preference.mode === "custom" &&
      (preference.custom.askBeforeEdits || preference.custom.askBeforeCommands));
  return {
    access: needsApproval ? "approval" : "scoped",
    pathKind: "full",
    runbookId: "patch_test_verify",
    autonomyPolicy: behaviorAutonomyPolicy(preference),
  };
}

export function behaviorInstruction(preference: BehaviorPreference): string {
  switch (preference.mode) {
    case "auto":
      return "AUTO: Inspect repository evidence first. Infer safe intent, edit and validate without ceremony. Ask only for material ambiguity, credentials, destructive actions, or required approval. Git commit and push remain protected.";
    case "guided":
      return "GUIDED: Inspect first. Present one concise finding and plan with inline Run fix and Review details actions. Wait before edits or significant commands, then resume this same EngineeringTask.";
    case "review":
      return "REVIEW: Read-only. Inspect and explain one evidence-grounded finding. Never edit files or run mutating commands.";
    case "custom":
      return `CUSTOM: askBeforeEdits=${preference.custom.askBeforeEdits}; askBeforeCommands=${preference.custom.askBeforeCommands}; askBeforeNetwork=${preference.custom.askBeforeNetwork}; askBeforeGit=${preference.custom.askBeforeGit}; autoValidate=${preference.custom.autoValidate}. Inspect evidence before any question.`;
  }
}

export function shouldAskQuestion(input: {
  evidenceSufficient: boolean;
  materialAmbiguity: boolean;
  destructive: boolean;
  missingCredentials: boolean;
  policyRequiresApproval: boolean;
}): boolean {
  return (
    input.destructive ||
    input.missingCredentials ||
    input.policyRequiresApproval ||
    (!input.evidenceSufficient && input.materialAmbiguity)
  );
}
