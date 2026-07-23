export const LINEAR_OAUTH_SCOPES = [
  "read",
  "write",
  "app:assignable",
  "app:mentionable",
] as const;

export type LinearConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "permission_changed"
  | "revoked"
  | "error";

export interface LinearIntegrationStatus {
  state: LinearConnectionState;
  installationState: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  organizationName: string | null;
  scopes: string[];
  relayConnected: boolean;
  lastDeliveryAt: string | null;
  message: string | null;
}

export interface LinearRepositoryCandidate {
  workspaceId: string;
  hostname: string;
  repositoryFullName: string;
}

export type LinearActivityKind = "thought" | "action" | "elicitation" | "response" | "error";

export interface LinearWebhookEnvelope {
  deliveryId: string;
  receivedAt: string;
  payload: Record<string, unknown>;
}
