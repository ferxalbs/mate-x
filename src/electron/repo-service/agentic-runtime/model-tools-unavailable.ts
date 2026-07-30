import type { AgentOutcome } from "../../../contracts/chat";
import type { ToolExecutionRecord } from "../../evidence-pack";

const SUMMARY =
  "The selected model cannot use the repository tools required for this Execute run.";

export function isModelToolsUnavailableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "MODEL_TOOLS_UNAVAILABLE"
  );
}

export function createModelToolsUnavailableResult(
  toolExecutions: ToolExecutionRecord[],
): {
  content: string;
  outcome: AgentOutcome;
  synthesisStatus: "failed";
  synthesisSummary: string;
  toolExecutions: ToolExecutionRecord[];
} {
  return {
    content: SUMMARY,
    outcome: {
      status: "failed",
      summary: SUMMARY,
      diagnostic: {
        code: "MODEL_TOOLS_UNAVAILABLE",
        message:
          "The provider rejected required tools or returned prose instead of a required tool call.",
      },
      remediation: {
        type: "select_model",
        label: "Choose a model with tool support",
      },
    },
    synthesisStatus: "failed",
    synthesisSummary: SUMMARY,
    toolExecutions,
  };
}

export function createProviderFailureResult(
  toolExecutions: ToolExecutionRecord[],
  message: string,
): ReturnType<typeof createModelToolsUnavailableResult> {
  const summary = "The provider stopped before the repository run completed.";
  return {
    content: summary,
    outcome: {
      status: "failed",
      summary,
      diagnostic: {
        code: "PROVIDER_UNAVAILABLE",
        message,
      },
      remediation: {
        type: "retry",
        label: "Retry this run",
      },
    },
    synthesisStatus: "failed",
    synthesisSummary: summary,
    toolExecutions,
  };
}
