import type { AgentOutcome, ToolEvent } from "../../../contracts/chat";
import type { ToolExecutionRecord } from "../../evidence-pack";
import { getActiveAgentExecutionSession } from "../../run-trace/agent-execution-session";

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
  error: unknown,
): ReturnType<typeof createModelToolsUnavailableResult> {
  const failure = classifyProviderFailure(error);
  return {
    content: failure.summary,
    outcome: {
      status: "failed",
      summary: failure.summary,
      diagnostic: {
        code: failure.code,
        message: failure.message,
      },
      remediation: {
        type: "retry",
        label: "Retry this run",
      },
    },
    synthesisStatus: "failed",
    synthesisSummary: failure.summary,
    toolExecutions,
  };
}

export function recordProviderFailure(
  runId: string,
  error: unknown,
  attempt: number,
): void {
  const failure = classifyProviderFailure(error);
  getActiveAgentExecutionSession(runId)?.record({
    kind: "provider.failed",
    phase: "inspection",
    visibility: "local_diagnostic",
    payload: {
      toolClass: "rainy",
      code: failure.code,
      attempt,
    },
  });
}

export function createProviderFailurePublicEvent(input: {
  runId: string;
  attempt: number;
  summary: string;
}): ToolEvent {
  return {
    id: `${input.runId}:provider-failed:${input.attempt}`,
    runId: input.runId,
    passId: `${input.runId}:pass:${input.attempt}`,
    segmentKind: "error",
    type: "error",
    label: "Provider request failed",
    detail: input.summary,
    status: "failed",
    visibility: "public",
  };
}

function classifyProviderFailure(error: unknown): {
  code: string;
  message: string;
  summary: string;
} {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown provider failure.";

  if (isModelToolsUnavailableError(error)) {
    return {
      code: "MODEL_TOOLS_UNAVAILABLE",
      message,
      summary: SUMMARY,
    };
  }

  if (/stable billing operation id is required/i.test(message)) {
    return {
      code: "PROVIDER_BILLING_OPERATION_ID_REQUIRED",
      message,
      summary:
        "The provider rejected the request because its billing operation identifier was missing.",
    };
  }

  return {
    code: "PROVIDER_UNAVAILABLE",
    message,
    summary: "The provider stopped before the repository run completed.",
  };
}
