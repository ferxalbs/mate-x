export const TELEMETRY_OPERATION_NAMES = [
  "mate.app.startup",
  "mate.workspace.open",
  "mate.analysis.run",
  "mate.code-review.run",
  "mate.agent.task",
  "mate.provider.request",
  "mate.settings.update",
] as const;

export type TelemetryOperationName = (typeof TELEMETRY_OPERATION_NAMES)[number];

export interface SafeTelemetryAttributes {
  feature?: string;
  category?: string;
  providerFamily?: string;
  model?: string;
  status?: "success" | "cancelled" | "failure";
  fileCountBucket?: "none" | "1-10" | "11-100" | "101+";
}

export interface RendererTelemetryMessage {
  name: TelemetryOperationName;
  attributes?: SafeTelemetryAttributes;
}

export interface TelemetryApi {
  track: (message: RendererTelemetryMessage) => Promise<void>;
}
