import type { AssistantRunProgress } from "../../contracts/chat";
import type { LinearAgentService, LinearRuntimeAuthority } from "./linear-agent-service";

export class GraphRuntimeLinearAdapter implements LinearRuntimeAuthority {
  private readonly controllers = new Map<string, AbortController>();
  constructor(private readonly service: () => LinearAgentService) {}

  async start(input: { graphRunId: string; engineeringTaskId: string; workspaceId: string; prompt: string }): Promise<void> {
    this.launch(input);
  }
  async resume(input: { graphRunId: string; engineeringTaskId: string; workspaceId: string; prompt: string }): Promise<void> {
    this.launch(input);
  }
  async cancel(graphRunId: string): Promise<void> {
    this.controllers.get(graphRunId)?.abort();
  }

  private launch(input: { graphRunId: string; engineeringTaskId: string; workspaceId: string; prompt: string }): void {
    const controller = new AbortController();
    this.controllers.set(input.graphRunId, controller);
    void import("../repo-service").then(({ runAssistant }) => runAssistant(
      input.prompt,
      [],
      input.workspaceId,
      { reasoningEnabled: true, reasoning: "high", access: "scoped", pathKind: "full", engineeringTaskId: input.engineeringTaskId },
      { runId: input.graphRunId, signal: controller.signal, emit: (progress) => void this.onProgress(input.graphRunId, progress) },
    )).then(async (result) => {
      await this.service().emitRuntimeActivityByRun(input.graphRunId, `${input.graphRunId}:response`, { type: "response", body: result.message.content || "MaTE X completed the run." });
    }).catch(async (error) => {
      if (controller.signal.aborted) return;
      await this.service().emitRuntimeActivityByRun(input.graphRunId, `${input.graphRunId}:error`, { type: "error", body: error instanceof Error ? error.message : String(error) });
    }).finally(() => this.controllers.delete(input.graphRunId));
  }

  private async onProgress(graphRunId: string, progress: AssistantRunProgress): Promise<void> {
    const last = progress.events?.at(-1);
    const content = last
      ? { type: "action", action: last.label ?? "MaTE X step", parameter: last.detail ?? "", result: last.status }
      : { type: "thought", body: progress.thought ?? progress.content ?? "Working…" };
    await this.service().emitRuntimeActivityByRun(graphRunId, `${graphRunId}:${last?.id ?? progress.status}`, content, true);
    if (progress.events?.length) {
      await this.service().projectPlanByRun(graphRunId, progress.events.map((event) => ({ id: event.id ?? event.segmentId ?? randomId(), title: event.label ?? "Runtime step", status: event.status ?? "pending" })));
    }
  }
}

function randomId(): string { return `step_${crypto.randomUUID()}`; }
