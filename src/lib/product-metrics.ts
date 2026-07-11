export type ProductMetricEventName =
  | "app_opened"
  | "repository_opened"
  | "repo_map_completed"
  | "review_started"
  | "review_completed"
  | "factory_started"
  | "factory_completed"
  | "ship_proof_generated"
  | "git_action_blocked"
  | "block_remediated"
  | "proof_reused"
  | "proof_stale"
  | "run_cancelled"
  | "model_profile_used"
  | "profile_escalated"
  | "user_override"
  | "run_failed";

export interface ProductMetricEvent {
  name: ProductMetricEventName;
  occurredAt: string;
  anonymousWorkspaceId?: string;
  properties: Record<string, string | number | boolean | null>;
}

export interface ProductMetricsSink {
  record(event: ProductMetricEvent): void | Promise<void>;
}

export interface ProductMetricsSettings {
  enabled: boolean;
  anonymousWorkspaceId?: string;
}

const SAFE_KEY = /^[a-z][a-z0-9_]{0,48}$/;
const SENSITIVE_KEY = /path|file|prompt|secret|token|key|code|diff|output|command|evidence|repo(name)?$/i;

export class LocalProductMetrics {
  constructor(
    private readonly settings: ProductMetricsSettings,
    private readonly sink: ProductMetricsSink,
  ) {}

  record(name: ProductMetricEventName, properties: Record<string, unknown> = {}) {
    if (!this.settings.enabled) return;
    return this.sink.record({
      name,
      occurredAt: new Date().toISOString(),
      anonymousWorkspaceId: this.settings.anonymousWorkspaceId,
      properties: sanitizeMetricProperties(properties),
    });
  }
}

export function sanitizeMetricProperties(properties: Record<string, unknown>) {
  const sanitized: ProductMetricEvent["properties"] = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!SAFE_KEY.test(key) || SENSITIVE_KEY.test(key)) continue;
    if (typeof value === "string") {
      sanitized[key] = value.length > 120 ? `${value.slice(0, 117)}...` : value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
