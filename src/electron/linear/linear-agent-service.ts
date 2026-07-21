import { randomUUID } from "node:crypto";
import { AgentActivitySignal, LinearClient } from "@linear/sdk";
import type { LinearRepositoryCandidate, LinearWebhookEnvelope } from "../../contracts/linear-integration";
import type { EngineeringCommandBus } from "../engineering/command-bus";
import { LinearStore, type LinearSessionBinding, type StoredLinearInstallation } from "./linear-store";

export interface LinearRuntimeAuthority {
  start(input: { graphRunId: string; engineeringTaskId: string; workspaceId: string; prompt: string }): Promise<void>;
  resume(input: { graphRunId: string; engineeringTaskId: string; workspaceId: string; prompt: string }): Promise<void>;
  cancel(graphRunId: string): Promise<void>;
}

export interface LinearAgentApi {
  activity(sessionId: string, content: Record<string, unknown>, ephemeral?: boolean): Promise<void>;
  repositorySuggestions(issueId: string, sessionId: string, candidates: LinearRepositoryCandidate[]): Promise<Array<{ hostname: string; repositoryFullName: string; confidence: number }>>;
  externalUrls(sessionId: string, urls: Array<{ label: string; url: string }>): Promise<void>;
  projectPlan?(sessionId: string, steps: Array<{ id: string; title: string; status: string }>): Promise<void>;
}

type SessionPayload = {
  action: string;
  organizationId: string;
  promptContext?: string | null;
  agentSession: { id: string; issue?: { id?: string; title?: string } | null };
  agentActivity?: { id?: string; body?: string; content?: { body?: string }; signal?: string } | null;
};

export class SdkLinearAgentApi implements LinearAgentApi {
  constructor(private readonly client: LinearClient) {}
  async activity(sessionId: string, content: Record<string, unknown>, ephemeral = false): Promise<void> {
    const { subtype, options, ...validatedContent } = content;
    await this.client.createAgentActivity({
      agentSessionId: sessionId,
      content: validatedContent,
      ephemeral,
      signal: subtype === "select" ? AgentActivitySignal.Select : undefined,
      signalMetadata: subtype === "select" ? { options } : undefined,
    });
  }
  async repositorySuggestions(issueId: string, sessionId: string, candidates: LinearRepositoryCandidate[]) {
    const result = await this.client.issueRepositorySuggestions(
      candidates.map(({ hostname, repositoryFullName }) => ({ hostname, repositoryFullName })),
      issueId,
      { agentSessionId: sessionId },
    );
    return result.suggestions
      .filter((item) => Boolean(item.hostname))
      .map((item) => ({ hostname: item.hostname!, repositoryFullName: item.repositoryFullName, confidence: item.confidence }));
  }
  async externalUrls(sessionId: string, urls: Array<{ label: string; url: string }>): Promise<void> {
    await this.client.updateAgentSession(sessionId, { externalUrls: urls });
  }
  async projectPlan(sessionId: string, steps: Array<{ id: string; title: string; status: string }>): Promise<void> {
    await this.client.updateAgentSession(sessionId, { plan: steps.map((step) => ({
      content: step.title,
      status: step.status === "done" ? "completed" : step.status === "running" ? "inProgress" : step.status === "error" ? "canceled" : "pending",
    })) });
  }
}

export class LinearAgentService {
  constructor(
    private readonly store: LinearStore,
    private readonly bus: EngineeringCommandBus,
    private readonly runtime: LinearRuntimeAuthority,
    private readonly apiFor: (installation: StoredLinearInstallation) => LinearAgentApi,
    private readonly repositories: () => Promise<LinearRepositoryCandidate[]>,
    private readonly runUrl: (binding: LinearSessionBinding) => string,
  ) {}

  async recover(): Promise<void> {
    for (const delivery of await this.store.pendingDeliveries()) await this.processDelivery(delivery);
    await this.flushActivities();
  }

  async acceptDelivery(envelope: LinearWebhookEnvelope): Promise<boolean> {
    const inserted = await this.store.persistDelivery(envelope);
    if (inserted || await this.store.isDeliveryPending(envelope.deliveryId)) await this.processDelivery(envelope);
    return inserted;
  }

  private async processDelivery(envelope: LinearWebhookEnvelope): Promise<void> {
    try {
      const payload = envelope.payload as SessionPayload;
      const payloadType = String(envelope.payload.type ?? "");
      if (payload.action === "revoked" || payload.action === "deauthorized") {
        await this.store.setInstallationState(payload.organizationId, "revoked");
      } else if (payload.action === "permissionChange" || payload.action === "permission_changed" || payloadType === "AppUserTeamAccessChanged") {
        await this.store.setInstallationState(payload.organizationId, "permission_changed");
      } else if (payload.action === "created" || payload.action === "prompted") {
        await this.handleSession(payload, envelope.deliveryId);
      }
      await this.store.markDeliveryProcessed(envelope.deliveryId);
    } catch (error) {
      await this.store.markDeliveryFailed(envelope.deliveryId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async handleSession(payload: SessionPayload, deliveryId: string): Promise<void> {
    const sessionId = payload.agentSession.id;
    const installation = await this.store.getInstallation(payload.organizationId);
    if (!installation || installation.state === "revoked") throw new Error("Linear installation is unavailable");
    const api = this.apiFor(installation);
    await this.queueAndFlush(`${deliveryId}:ack`, sessionId, { type: "thought", body: "I’m connecting this issue to MaTE X and checking the repository context." }, true, api);

    let binding = await this.store.getBinding(sessionId);
    const stop = payload.agentActivity?.signal === "stop" || /^(stop|cancel)$/i.test(this.promptBody(payload).trim());
    if (stop) {
      if (binding) await this.runtime.cancel(binding.graphRunId);
      await this.queueAndFlush(`${deliveryId}:stopped`, sessionId, { type: "response", body: "Stopped. The MaTE X run has been canceled." }, false, api);
      return;
    }

    if (!binding) {
      const selected = await this.selectRepository(payload, api, deliveryId);
      if (!selected) return;
      const capture = this.bus.dispatch({
        type: "CaptureTask",
        workspaceId: selected.workspaceId,
        objectiveSeed: payload.promptContext?.trim() || this.promptBody(payload),
        title: payload.agentSession.issue?.title || "Linear agent task",
        actor: { kind: "agent", id: "linear" },
        commandId: `linear:${sessionId}:capture`,
      } as never);
      if (!capture.ok) throw new Error(capture.error.message);
      const capturedTask = capture.data as { engineeringTaskId: string };
      binding = await this.store.bindSession({
        sessionId,
        organizationId: payload.organizationId,
        issueId: payload.agentSession.issue?.id ?? null,
        workspaceId: selected.workspaceId,
        engineeringTaskId: capturedTask.engineeringTaskId,
        graphRunId: `grun_${randomUUID()}`,
      });
      await api.externalUrls(sessionId, [{ label: "Open MaTE X run", url: this.runUrl(binding) }]);
      await this.runtime.start({ ...binding, prompt: payload.promptContext?.trim() || this.promptBody(payload) });
    } else {
      await this.runtime.resume({ ...binding, prompt: this.promptBody(payload) });
    }
  }

  private promptBody(payload: SessionPayload): string {
    return payload.agentActivity?.body ?? payload.agentActivity?.content?.body ?? "Continue the Linear task.";
  }

  private async selectRepository(payload: SessionPayload, api: LinearAgentApi, deliveryId: string): Promise<LinearRepositoryCandidate | null> {
    const candidates = await this.repositories();
    if (candidates.length === 0) throw new Error("MaTE X has no accessible repositories");
    const reply = this.promptBody(payload).trim().toLowerCase();
    const explicit = candidates.find((candidate) => candidate.workspaceId.toLowerCase() === reply || candidate.repositoryFullName.toLowerCase() === reply);
    if (explicit) return explicit;
    if (candidates.length === 1 || !payload.agentSession.issue?.id) return candidates[0]!;
    const suggestions = (await api.repositorySuggestions(payload.agentSession.issue.id, payload.agentSession.id, candidates)).sort((a, b) => b.confidence - a.confidence);
    const best = suggestions[0];
    const second = suggestions[1];
    if (best && best.confidence >= 0.8 && (!second || best.confidence - second.confidence >= 0.15)) {
      return candidates.find((candidate) => candidate.hostname === best.hostname && candidate.repositoryFullName === best.repositoryFullName) ?? null;
    }
    await this.queueAndFlush(`${deliveryId}:repo`, payload.agentSession.id, {
      type: "elicitation",
      body: "Which repository should MaTE X use?",
      subtype: "select",
      options: candidates.map((candidate) => ({ label: candidate.repositoryFullName, value: candidate.workspaceId })),
    }, false, api);
    return null;
  }

  async emitRuntimeActivity(sessionId: string, key: string, content: Record<string, unknown>, ephemeral = false): Promise<void> {
    const binding = await this.store.getBinding(sessionId);
    if (!binding) return;
    const installation = await this.store.getInstallation(binding.organizationId);
    if (!installation) return;
    await this.queueAndFlush(key, sessionId, content, ephemeral, this.apiFor(installation));
  }

  async emitRuntimeActivityByRun(graphRunId: string, key: string, content: Record<string, unknown>, ephemeral = false): Promise<void> {
    const binding = await this.store.getBindingByRun(graphRunId);
    if (binding) await this.emitRuntimeActivity(binding.sessionId, key, content, ephemeral);
  }

  async projectPlan(sessionId: string, steps: Array<{ id: string; title: string; status: string }>): Promise<void> {
    const binding = await this.store.getBinding(sessionId);
    if (!binding) return;
    const installation = await this.store.getInstallation(binding.organizationId);
    const api = installation ? this.apiFor(installation) : null;
    if (!api?.projectPlan) return;
    try { await api.projectPlan(sessionId, steps); } catch { /* Preview projection is best effort. */ }
  }

  async projectPlanByRun(graphRunId: string, steps: Array<{ id: string; title: string; status: string }>): Promise<void> {
    const binding = await this.store.getBindingByRun(graphRunId);
    if (binding) await this.projectPlan(binding.sessionId, steps);
  }

  async addPullRequestUrl(sessionId: string, pullRequestUrl: string): Promise<void> {
    const binding = await this.store.getBinding(sessionId);
    if (!binding) return;
    const installation = await this.store.getInstallation(binding.organizationId);
    if (installation) await this.apiFor(installation).externalUrls(sessionId, [
      { label: "Open MaTE X run", url: this.runUrl(binding) },
      { label: "Open pull request", url: pullRequestUrl },
    ]);
  }

  private async queueAndFlush(key: string, sessionId: string, content: Record<string, unknown>, ephemeral: boolean, api: LinearAgentApi): Promise<void> {
    await this.store.enqueueActivity({ activityKey: key, sessionId, content, ephemeral });
    await this.flushActivities(api);
  }

  async flushActivities(providedApi?: LinearAgentApi): Promise<void> {
    for (const activity of await this.store.pendingActivities()) {
      try {
        const binding = await this.store.getBinding(activity.sessionId);
        const installation = binding ? await this.store.getInstallation(binding.organizationId) : null;
        const api = providedApi ?? (installation ? this.apiFor(installation) : null);
        if (!api) continue;
        await api.activity(activity.sessionId, activity.content, activity.ephemeral);
        await this.store.markActivityDelivered(activity.activityKey);
      } catch (error) {
        await this.store.markActivityFailed(activity.activityKey, error instanceof Error ? error.message : String(error));
      }
    }
  }
}
