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
    label: "Run safety check",
    prompt:
      "Run the smallest useful safety check for the current changes. Do not claim Ready unless validation passes and proof is available.",
    overrides: { runbookId: "scan_contain_report" },
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
  mode: "build",
  reasoningEnabled: true,
  reasoning: "high",
  serviceTier: "standard",
  access: "approval",
} satisfies Partial<AssistantRunOptions>;
