import { LinearClient } from "@linear/sdk";
import { simpleGit } from "simple-git";
import { pathToFileURL } from "node:url";
import type { LinearRepositoryCandidate } from "../../contracts/linear-integration";
import { getEngineeringCommandBus } from "../engineering/command-bus";
import { tursoService } from "../turso-service";
import { LinearAgentService, SdkLinearAgentApi } from "./linear-agent-service";
import { LinearConnectionService } from "./linear-connection-service";
import { LinearRelayClient } from "./linear-relay-client";
import { GraphRuntimeLinearAdapter } from "./linear-runtime";
import { LinearStore } from "./linear-store";
import { LINEAR_CALLBACK_URL, resolveLinearClientId } from "./linear-product-config";
import { app } from "electron";

let store: LinearStore | null = null;
let connection: LinearConnectionService | null = null;
let agent: LinearAgentService | null = null;
let relay: LinearRelayClient | null = null;

export async function initializeLinearIntegration(): Promise<void> {
  const databasePath = tursoService.getLocalDatabaseFilePath();
  if (!databasePath) return;
  store = new LinearStore(pathToFileURL(databasePath).toString());
  await store.initialize();
  const resolvedConfig = resolveLinearClientId({
    isPackaged: app.isPackaged,
    environmentClientId: process.env.LINEAR_CLIENT_ID,
    localClientId: await store.getClientId(),
  });
  connection = new LinearConnectionService(store, {
    clientId: resolvedConfig.clientId,
    redirectUri: LINEAR_CALLBACK_URL,
  }, resolvedConfig.source);
  const existingInstallation = await store.firstInstallation();
  if (existingInstallation?.state === "connected") {
    try { await connection.accessToken(existingInstallation.organizationId); } catch { /* Status exposes refresh failure. */ }
  }
  const runtime = new GraphRuntimeLinearAdapter(() => getLinearAgentService());
  agent = new LinearAgentService(
    store,
    getEngineeringCommandBus(),
    runtime,
    (installation) => new SdkLinearAgentApi(new LinearClient({ accessToken: connection!.decryptInstallation(installation).accessToken })),
    accessibleRepositories,
    (binding) => `${process.env.MATEX_PUBLIC_URL ?? "https://mate-x.app"}/runs/${encodeURIComponent(binding.graphRunId)}`,
  );
  await agent.recover();
  const relayUrl = process.env.MATEX_LINEAR_RELAY_URL;
  const relayToken = process.env.MATEX_LINEAR_RELAY_TOKEN;
  if (relayUrl && relayToken) {
    relay = new LinearRelayClient(relayUrl, relayToken, async (envelope) => {
      const organizationId = typeof envelope.payload.organizationId === "string" ? envelope.payload.organizationId : null;
      if (organizationId) await connection!.accessToken(organizationId);
      return agent!.acceptDelivery(envelope);
    }, (connected) => connection!.setRelayConnected(connected));
    relay.start();
  }
}

export function teardownLinearIntegration(): void { relay?.stop(); relay = null; }
export function getLinearConnectionService(): LinearConnectionService {
  if (!connection) throw new Error("Linear integration is not initialized");
  return connection;
}
export function getLinearAgentService(): LinearAgentService {
  if (!agent) throw new Error("Linear integration is not initialized");
  return agent;
}

async function accessibleRepositories(): Promise<LinearRepositoryCandidate[]> {
  const workspaces = await tursoService.getWorkspaces();
  const candidates: LinearRepositoryCandidate[] = [];
  for (const workspace of workspaces) {
    try {
      const remote = (await simpleGit(workspace.path).getConfig("remote.origin.url")).value;
      if (!remote) continue;
      const parsed = parseRemote(remote);
      if (parsed) candidates.push({ workspaceId: workspace.id, ...parsed });
    } catch { /* A workspace without a readable origin is not an accessible candidate. */ }
  }
  return candidates;
}

function parseRemote(remote: string): { hostname: string; repositoryFullName: string } | null {
  const scp = remote.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (scp) return { hostname: scp[1]!, repositoryFullName: scp[2]!.replace(/\.git$/, "") };
  try {
    const url = new URL(remote);
    return { hostname: url.hostname, repositoryFullName: url.pathname.replace(/^\//, "").replace(/\.git$/, "") };
  } catch { return null; }
}
