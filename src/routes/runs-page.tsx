import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  FileCode2Icon,
  GitBranchIcon,
  ListChecksIcon,
  MessageSquareTextIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { ChatMessage, Conversation, ReproducibleRun, ToolEvent } from "../contracts/chat";
import { formatTimestamp } from "../lib/time";
import { useChatStore } from "../store/chat-store";

type MissionRun = {
  id: string;
  title: string;
  threadTitle: string;
  userIntent: string;
  assistantMessage: ChatMessage;
  startedAt: string;
  completedAt: string;
  status: "completed" | "failed" | "running";
  events: ToolEvent[];
  record?: ReproducibleRun;
};

type CommandEvidence = {
  tool: string;
  action: string;
  target: string;
  result: string;
};

function buildRuns(threads: Conversation[]) {
  const runs: MissionRun[] = [];

  for (const thread of threads) {
    for (const run of thread.runs ?? []) {
      const assistantMessage = thread.messages.find((message) => message.id === run.assistantMessageId);
      const fallbackAssistantMessage: ChatMessage = {
        id: run.assistantMessageId,
        role: "assistant",
        content: run.result?.summary ?? "",
        createdAt: run.completedAt ?? run.startedAt,
        events: run.events,
        artifacts: run.artifacts,
        evidencePack: run.result?.evidencePack,
      };

      runs.push({
        id: run.id,
        title: run.title,
        threadTitle: thread.title,
        userIntent: run.userIntent,
        assistantMessage: assistantMessage ?? fallbackAssistantMessage,
        startedAt: run.startedAt,
        completedAt: run.completedAt ?? run.startedAt,
        status: run.status,
        events: run.events,
        record: run,
      });
    }

    if ((thread.runs ?? []).length > 0) {
      continue;
    }

    thread.messages.forEach((message, index) => {
      if (message.role !== "assistant") return;

      const previousUserMessage = [...thread.messages]
        .slice(0, index)
        .reverse()
        .find((candidate) => candidate.role === "user");
      const events = message.events ?? [];
      const evidence = message.evidencePack;
      const hasFailure =
        events.some((event) => event.status === "error") ||
        evidence?.status === "failed" ||
        evidence?.status === "blocked";

      runs.push({
        id: `${thread.id}:${message.id}`,
        title: previousUserMessage?.content.split("\n")[0].slice(0, 90) || thread.title,
        threadTitle: thread.title,
        userIntent: previousUserMessage?.content || "No user prompt captured before this assistant turn.",
        assistantMessage: message,
        startedAt: previousUserMessage?.createdAt ?? message.createdAt,
        completedAt: message.createdAt,
        status: hasFailure ? "failed" : "completed",
        events,
      });
    });
  }

  return runs.sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );
}

function statusClass(status: MissionRun["status"]) {
  if (status === "completed") return "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300";
  if (status === "running") return "bg-sky-500/12 text-sky-600 dark:text-sky-300";
  return "bg-red-500/12 text-red-600 dark:text-red-300";
}

function getEventIcon(event: ToolEvent) {
  const text = `${event.label} ${event.detail}`.toLowerCase();
  if (event.status === "error") return AlertCircleIcon;
  if (text.includes("command") || text.includes("tool")) return TerminalSquareIcon;
  if (text.includes("file") || text.includes("diff") || text.includes("patch")) return FileCode2Icon;
  if (text.includes("check") || text.includes("test") || text.includes("lint")) return ListChecksIcon;
  return CircleDotIcon;
}

function getSemanticEventLabel(event: ToolEvent) {
  const text = `${event.label} ${event.detail}`.toLowerCase();
  if (event.status === "error") return "Policy pause";
  if (text.includes("retry")) return "Scoped retry";
  if (text.includes("patch") || text.includes("diff") || text.includes("file")) return "Patch attempt";
  if (text.includes("check") || text.includes("test") || text.includes("lint") || text.includes("typecheck")) {
    return event.status === "done" ? "Verification pass" : "Verification run";
  }
  if (text.includes("tool batch") || text.includes("tool") || text.includes("command")) return "Tool batch";
  if (text.includes("plan") || text.includes("scope") || text.includes("decision")) return "Agent replan";
  return "Execution step";
}

function getDecisionTrail(run: MissionRun) {
  const decisions = run.record?.decisions ?? [];
  const events = run.events;
  const trail = decisions.map((decision) => ({
    label: decision.summary,
    detail: decision.reason,
  }));

  if (events.some((event) => event.status === "error")) {
    trail.push({
      label: "Policy denials / blocking events",
      detail: "Run encountered an error-state event and preserved it in the execution timeline.",
    });
  }

  if (events.some((event) => `${event.label} ${event.detail}`.toLowerCase().includes("approval"))) {
    trail.push({
      label: "Approvals requested",
      detail: "Approval-related event detected in run telemetry.",
    });
  }

  if (events.some((event) => `${event.label} ${event.detail}`.toLowerCase().includes("retry"))) {
    trail.push({
      label: "Scoped retry",
      detail: "Agent retried a bounded operation instead of broadening execution scope.",
    });
  }

  if (trail.length === 0) {
    trail.push(
      {
        label: "Execution mode fixed",
        detail: "Run used captured mode/access settings from initial state.",
      },
      {
        label: "Scope maintained",
        detail: "No approval pauses, policy denials, fallback paths, or scope reductions were recorded.",
      },
    );
  }

  return trail;
}

function parseCommandEvidence(run: MissionRun): CommandEvidence[] {
  const commands = run.assistantMessage.evidencePack?.commandsExecuted ?? [];

  return commands.map((command) => {
    const parts = command.command.trim().split(/\s+/);
    const tool = parts[0] ?? "command";
    const target =
      parts.find((part) => part.startsWith("src/") || part.startsWith("/") || part.includes(".")) ??
      "workspace";

    return {
      tool,
      action: command.summary ?? "Executed command",
      target,
      result:
        typeof command.exitCode === "number"
          ? `exit ${command.exitCode}`
          : command.summary
            ? "reported"
            : "captured",
    };
  });
}

function summarizeResult(message: ChatMessage) {
  if (message.evidencePack?.verdict.summary) return message.evidencePack.verdict.summary;
  const content = message.content.trim();
  if (content.length === 0) return "Assistant turn completed without final synthesis text.";
  return content.length > 220 ? `${content.slice(0, 220)}...` : content;
}

export function RunsPage() {
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const workspace = useChatStore((state) => state.workspace);
  const threadsByWorkspace = useChatStore((state) => state.threadsByWorkspace);
  const runStatus = useChatStore((state) => state.runStatus);
  const threads = activeWorkspaceId ? (threadsByWorkspace[activeWorkspaceId] ?? []) : [];
  const runs = useMemo(() => buildRuns(threads), [threads]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
  const isCurrentRunActive = runStatus === "running" && selectedRun?.id === runs[0]?.id;
  const selectedStatus = isCurrentRunActive ? "running" : selectedRun?.status;
  const decisionTrail = selectedRun ? getDecisionTrail(selectedRun) : [];
  const commandEvidence = selectedRun ? parseCommandEvidence(selectedRun) : [];

  async function handleExportRun() {
    if (!selectedRun?.record) return;

    const blob = new Blob([JSON.stringify(selectedRun.record, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedRun.record.id}.mission-log.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-border/70 px-5">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground">Mission Log</h1>
          <p className="truncate text-[11px] text-muted-foreground">
            Real assistant runs from current workspace, shown as reviewable execution history.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <button
            className="rounded-md border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!selectedRun?.record}
            onClick={() => void handleExportRun()}
            type="button"
          >
            Export JSON
          </button>
          <GitBranchIcon className="size-3.5" />
          <span className="max-w-[280px] truncate">{workspace?.path ?? "No workspace selected"}</span>
        </div>
      </header>

      {selectedRun ? (
        <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_320px]">
          <aside className="min-h-0 border-r border-border/70">
            <div className="border-b border-border/70 px-4 py-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Captured Runs
              </div>
            </div>
            <div className="flex min-h-0 flex-col gap-1 overflow-y-auto p-2">
              {runs.map((run) => {
                const status = runStatus === "running" && run.id === runs[0]?.id ? "running" : run.status;
                return (
                  <button
                    className={`rounded-md px-3 py-2 text-left transition-colors ${
                      run.id === selectedRun.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    }`}
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{run.title}</div>
                        <div className="mt-1 truncate text-[10px] opacity-70">{run.threadTitle}</div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${statusClass(status)}`}>
                        {status}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] opacity-70">
                      <span>{formatTimestamp(run.startedAt)}</span>
                      <span>{run.events.length} events</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto px-6 py-5">
            <div className="mb-5 grid grid-cols-4 gap-2">
              <Metric label="Status" value={selectedStatus ?? "unknown"} />
              <Metric label="Events" value={String(selectedRun.events.length)} />
              <Metric
                label="Files"
                value={String(selectedRun.assistantMessage.evidencePack?.filesModified?.length ?? 0)}
              />
              <Metric
                label="Checks"
                value={String(selectedRun.assistantMessage.evidencePack?.checks?.length ?? 0)}
              />
            </div>

            <section className="mb-5 rounded-md border border-border/70 px-4 py-3">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                <MessageSquareTextIcon className="size-3.5" />
                Initial Intent
              </div>
              <p className="whitespace-pre-wrap text-xs leading-5 text-foreground">{selectedRun.userIntent}</p>
            </section>

            <div className="space-y-3">
              {selectedRun.events.length > 0 ? (
                selectedRun.events.map((event, index) => {
                  const Icon = getEventIcon(event);
                  return (
                    <article className="grid grid-cols-[42px_24px_minmax(0,1fr)] gap-3" key={event.id}>
                      <div className="pt-1 text-right text-[11px] text-muted-foreground">{index + 1}</div>
                      <div className="flex flex-col items-center">
                        <div className="flex size-6 items-center justify-center rounded-full border border-border bg-background">
                          <Icon className="size-3.5 text-muted-foreground" />
                        </div>
                        <div className="mt-2 h-full w-px bg-border/70" />
                      </div>
                      <div className="rounded-md border border-border/70 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <h2 className="text-xs font-semibold text-foreground">{getSemanticEventLabel(event)}</h2>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider ${statusClass(event.status === "error" ? "failed" : event.status === "active" ? "running" : "completed")}`}>
                            {event.status}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] font-medium text-foreground/80">{event.label}</div>
                        <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                          {event.detail || "No detail captured for this event."}
                        </p>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  No tool timeline was captured for this assistant turn.
                </div>
              )}
            </div>
          </main>

          <aside className="min-h-0 overflow-y-auto border-l border-border/70 px-4 py-5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Run Evidence
            </div>
            <h2 className="mt-2 text-sm font-semibold text-foreground">{selectedRun.title}</h2>
            <dl className="mt-4 space-y-3 text-xs">
              <Detail label="Thread" value={selectedRun.threadTitle} />
              <Detail label="Initial state" value={selectedRun.record ? `${selectedRun.record.initialState.workspaceName}\n${selectedRun.record.initialState.workspacePath}\nbranch ${selectedRun.record.initialState.branch}` : "Legacy run inferred from assistant message"} />
              <div>
                <dt className="text-muted-foreground">Decisions</dt>
                <dd className="mt-1 space-y-2">
                  {decisionTrail.map((decision) => (
                    <div className="rounded-md border border-border/60 px-2 py-1.5" key={`${decision.label}:${decision.detail}`}>
                      <div className="font-medium text-foreground">{decision.label}</div>
                      <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{decision.detail}</div>
                    </div>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Integrity</dt>
                <dd className="mt-1 rounded-md border border-border/60 px-2 py-1.5">
                  {selectedRun.record?.integrity ? (
                    <>
                      <div className="font-medium text-emerald-600 dark:text-emerald-300">Sealed run</div>
                      <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                        {selectedRun.record.integrity.rootHash}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">Exportable evidence pack · trusted replay ready</div>
                    </>
                  ) : (
                    <>
                      <div className="font-medium text-sky-600 dark:text-sky-300">Sealing pending</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Run is still active or from legacy history. Final export will seal artifact.
                      </div>
                    </>
                  )}
                </dd>
              </div>
              <Detail label="Started" value={formatTimestamp(selectedRun.startedAt)} />
              <Detail label="Completed" value={formatTimestamp(selectedRun.completedAt)} />
              <Detail label="Tools used" value={(selectedRun.assistantMessage.evidencePack?.toolsUsed ?? []).map((tool) => tool.name).join(", ") || "None reported"} />
              <div>
                <dt className="text-muted-foreground">Commands</dt>
                <dd className="mt-1 space-y-2">
                  {commandEvidence.length > 0 ? (
                    commandEvidence.map((command) => (
                      <div className="rounded-md border border-border/60 px-2 py-1.5" key={`${command.tool}:${command.target}:${command.result}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] font-medium text-foreground">{command.tool}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{command.result}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">{command.action}</div>
                        <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/75">{command.target}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                      No command artifacts reported. Tool activity remains available in timeline.
                    </div>
                  )}
                </dd>
              </div>
            </dl>
            <div className="mt-5 rounded-md border border-border/70 px-3 py-2">
              <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                <CheckCircle2Icon className="size-3.5" />
                Final Result
              </div>
              <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                {summarizeResult(selectedRun.assistantMessage)}
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-[520px] rounded-md border border-border/70 px-6 py-5 text-center">
            <h2 className="text-sm font-semibold text-foreground">No reproducible runs captured yet</h2>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Ask MaTE X to work on current workspace. Mission Log will show real assistant turns, tool events,
              evidence packs, commands, files, and final results from thread history.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-foreground">{value}</dd>
    </div>
  );
}
