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
  }),
  plan: Object.freeze({
    mode: "plan",
    purpose: "Inspect enough context to produce an executable implementation strategy.",
    pathKind: "verify_only",
    runbookId: "review_classify_summarize",
    allowsMutation: false,
    allowsCommands: false,
    responseContract: "Use read-only repository tools. Return a decision-complete implementation plan with affected areas and verification. Never edit files or run commands.",
  }),
  execute: Object.freeze({
    mode: "execute",
    purpose: "Perform requested work, validate it, and report the result.",
    pathKind: "full",
    runbookId: "patch_test_verify",
    allowsMutation: true,
    allowsCommands: true,
    responseContract: "For mutation work, use repository tools before answering: inspect, edit, search for remaining issues, validate, then return the typed outcome and evidence.",
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
