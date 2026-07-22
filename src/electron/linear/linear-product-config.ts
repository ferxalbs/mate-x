import type { LinearDeveloperSetup } from "../../contracts/linear-integration";

// Linear OAuth Client IDs are public identifiers. This is intentionally product
// configuration, not a secret. LINEAR_CLIENT_ID remains a development-only override.
export const BUILT_IN_LINEAR_CLIENT_ID = "";
export const LINEAR_CALLBACK_URL = "https://mate-x.app/api/linear/oauth/callback";
export const LINEAR_WEBHOOK_URL = "https://mate-x.app/api/linear/webhook";

export type LinearConfigurationSource = "built_in" | "development_override" | "local" | "missing";

export function resolveLinearClientId(input: {
  isPackaged: boolean;
  environmentClientId?: string;
  localClientId?: string | null;
  builtInClientId?: string;
}): { clientId: string; source: LinearConfigurationSource } {
  const environmentClientId = input.environmentClientId?.trim();
  if (!input.isPackaged && environmentClientId) {
    return { clientId: environmentClientId, source: "development_override" };
  }
  const localClientId = input.localClientId?.trim();
  if (localClientId) return { clientId: localClientId, source: "local" };
  const builtInClientId = input.builtInClientId ?? BUILT_IN_LINEAR_CLIENT_ID;
  if (builtInClientId) return { clientId: builtInClientId, source: "built_in" };
  return { clientId: "", source: "missing" };
}

export function createLinearDeveloperSetup(): LinearDeveloperSetup {
  const manifest = {
    $schema: "https://linear.app/.well-known/oauth-app-manifest.schema.json",
    schemaVersion: "1.0.0",
    distribution: "public",
    display: { description: "Connect MaTE X to issues and agent sessions in your Linear workspace." },
    developer: { name: "MaTE X" },
    oauth: {
      client_name: "MaTE X",
      client_uri: "https://mate-x.app",
      redirect_uris: [LINEAR_CALLBACK_URL],
      grant_types: ["authorization_code"],
    },
    webhook: {
      enabled: true,
      url: LINEAR_WEBHOOK_URL,
      resourceTypes: ["AgentSessionEvent", "OAuthAuthorization", "PermissionChange"],
    },
  };
  return {
    callbackUrl: LINEAR_CALLBACK_URL,
    webhookUrl: LINEAR_WEBHOOK_URL,
    createAppUrl: `https://linear.app/settings/api/applications/new?manifest=${encodeURIComponent(JSON.stringify(manifest))}`,
  };
}
