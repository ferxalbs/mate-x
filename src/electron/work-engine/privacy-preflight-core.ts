export interface PrivacyPreflightDecisionInput {
  blocked: boolean;
  reason?: string;
  totalSpans: number;
  p0Count: number;
}

export interface PrivacyPreflightResult {
  status: "passed" | "blocked";
  redactionCount: number;
  p0Count: number;
  reason: string;
}

export function buildPrivacyPreflightResult(input: PrivacyPreflightDecisionInput): PrivacyPreflightResult {
  if (input.blocked) {
    return {
      status: "blocked",
      redactionCount: input.totalSpans,
      p0Count: input.p0Count,
      reason: input.reason ?? "Privacy Sentinel blocked unsanitized outbound context.",
    };
  }

  return {
    status: "passed",
    redactionCount: input.totalSpans,
    p0Count: input.p0Count,
    reason:
      input.totalSpans > 0
        ? "Outbound context sanitized before model use."
        : "Outbound context passed Privacy Sentinel preflight.",
  };
}
