import type { AssistantRunOptions, AssistantRunbookId, EngineeringPathKind } from "./chat";

export const BEHAVIOR_MODES = ["review", "plan", "execute"] as const;
export type BehaviorMode = (typeof BEHAVIOR_MODES)[number];

export interface BehaviorPreference {
  mode: BehaviorMode;
}

export interface BehaviorModeDefinition {
  mode: BehaviorMode;
  purpose: string;
  pathKind: EngineeringPathKind;
  runbookId: AssistantRunbookId;
  allowsMutation: boolean;
  allowsCommands: boolean;
  responseContract: string;
  systemContract: readonly string[];
}

export const BEHAVIOR_MODE_DEFINITIONS: Readonly<
  Record<BehaviorMode, BehaviorModeDefinition>
> = Object.freeze({
  review: Object.freeze({
    mode: "review",
    purpose: "Inspect existing state and report evidence-backed findings.",
    pathKind: "verify_only",
    runbookId: "review_classify_summarize",
    allowsMutation: false,
    allowsCommands: false,
    responseContract: "Use read-only repository tools. Return findings with evidence and impact. Never edit files or run commands.",
    systemContract: [
      "Review is an evidence-only contract: inspect current repository state and classify confirmed findings, impact, and confidence.",
      "Do not mutate files, execute validation, or imply that an unrun check passed.",
      "Separate confirmed facts from inferences and name the missing evidence for every material uncertainty.",
    ],
  }),
  plan: Object.freeze({
    mode: "plan",
    purpose: "Inspect enough context to produce an executable implementation strategy.",
    pathKind: "verify_only",
    runbookId: "review_classify_summarize",
    allowsMutation: false,
    allowsCommands: false,
    responseContract: "Use read-only repository tools. Return a decision-complete implementation plan with affected areas and verification. Never edit files or run commands.",
    systemContract: [
      "Plan is a read-only design contract: inspect enough repository evidence to make the implementation strategy executable.",
      "Specify affected files, data/control-flow changes, exact validation requirements, risks, and approval boundaries.",
      "Do not edit files or execute commands; validation commands are planning outputs, not proof.",
    ],
  }),
  execute: Object.freeze({
    mode: "execute",
    purpose: "Perform requested work, validate it, and report the result.",
    pathKind: "full",
    runbookId: "patch_test_verify",
    allowsMutation: true,
    allowsCommands: true,
    responseContract: "For mutation work, use repository tools before answering: inspect, edit, search for remaining issues, validate, then return the typed outcome and evidence.",
    systemContract: [
      "Execute is the mutation-and-proof contract: inspect first, make the smallest authorized change, search for leftovers, then validate.",
      "Use only the current target repository validation authority and exact resolved commands; never invent host fallbacks.",
      "Finish with typed completed, blocked, approval, or failed evidence rather than prose-based confidence.",
    ],
  }),
});

export const DEFAULT_BEHAVIOR_PREFERENCE: BehaviorPreference = {
  mode: "execute",
};

export function behaviorRunOptions(
  preference: BehaviorPreference,
): Pick<AssistantRunOptions, "behaviorMode" | "pathKind" | "runbookId"> {
  const definition = BEHAVIOR_MODE_DEFINITIONS[preference.mode];
  return {
    behaviorMode: preference.mode,
    pathKind: definition.pathKind,
    runbookId: definition.runbookId,
  };
}

/** Strategy only. Authorization lives in the capability resolver. */
export function behaviorInstruction(mode: BehaviorMode): string {
  const definition = BEHAVIOR_MODE_DEFINITIONS[mode];
  return `${definition.purpose} ${definition.responseContract}`;
}

export function behaviorSystemContract(mode: BehaviorMode): string {
  return BEHAVIOR_MODE_DEFINITIONS[mode].systemContract.join("\n");
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
