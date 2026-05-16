import { privacyFirewall } from "../privacy/privacy-firewall-service";
import { buildPrivacyPreflightResult, type PrivacyPreflightResult } from "./privacy-preflight-core";

export async function runPrivacyPreflight(
  payload: unknown,
  context: { workspaceId?: string; runId?: string; inputKind?: string },
): Promise<PrivacyPreflightResult> {
  const result = await privacyFirewall.sanitizeOutboundModelPayload(payload, {
    ...context,
    inputKind: context.inputKind ?? "work_engine_preflight",
  });

  return buildPrivacyPreflightResult({
    blocked: result.blocked,
    reason: result.reason,
    totalSpans: result.scan.stats.totalSpans,
    p0Count: result.scan.stats.p0Count,
  });
}
