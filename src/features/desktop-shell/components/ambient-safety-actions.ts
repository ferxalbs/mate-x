import type { AssistantRunOptions } from "../../../contracts/chat";

export type AmbientSafetyActionId = "runSafetyCheck" | "reviewChanges";

export interface AmbientSafetyAction {
  id: AmbientSafetyActionId;
  label: string;
  prompt: string;
  overrides: Partial<AssistantRunOptions>;
}

export const ambientSafetyActions = {
  runSafetyCheck: {
    id: "runSafetyCheck",
    label: "Run verification",
    prompt:
      "Run verification for the current changes. Build a validation plan, run the smallest useful proof-producing checks, and do not claim Ready unless validation passes and Ship Proof is available.",
    overrides: { runbookId: "patch_test_verify", access: "approval" },
  },
  reviewChanges: {
    id: "reviewChanges",
    label: "Review changes",
    prompt:
      "Explain the current changes in plain language. Highlight what changed, why it matters, likely blast radius, and what I should inspect first.",
    overrides: { runbookId: "review_classify_summarize" },
  },
} satisfies Record<AmbientSafetyActionId, AmbientSafetyAction>;

export const defaultAmbientSafetyRunOptions = {
  pathKind: "verify_only",
  reasoningEnabled: true,
  reasoning: "high",
  serviceTier: "standard",
  access: "approval",
} satisfies Partial<AssistantRunOptions>;
