import {
  ActivityIcon,
  ChatTextIcon,
  CheckCircleIcon,
  CircleIcon,
  FileCodeIcon,
  GitBranchIcon,
  ListChecksIcon,
  TerminalWindowIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import type { ChatMessage, Conversation, ReproducibleRun, ToolEvent } from "@/contracts/chat";
import { formatTimestamp } from "@/lib/time";
import { useChatStore } from "@/store/chat-store";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { usePlatform } from "@/hooks/use-platform";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";

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

function StandalonePackItem({
  pack,
  isSelected,
  onSelect,
  onVerify,
  onExport,
}: {
  pack: any;
  isSelected: boolean;
  onSelect: (taskId: string) => void;
  onVerify: (taskId: string) => void;
  onExport: (taskId: string) => void;
}) {
  return (
    <Card
      className={cn(
        "w-[min(280px,calc(100vw-3rem))] shrink-0 cursor-pointer rounded-2xl transition-colors",
        isSelected ? "border-sky-500 bg-sky-500/5" : "hover:border-border",
      )}
      onClick={() => onSelect(pack.taskId)}
    >
      <CardContent className="p-3">
        <div className="mate-text-secondary truncate font-mono">{pack.taskId}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-medium">{pack.verdict?.label || pack.status}</span>
          {pack.verifiedTaskScore && (
            <span className="text-muted-foreground">· {pack.verifiedTaskScore.score}/100</span>
          )}
        </div>
        <div className="mate-text-secondary mt-1">
          {pack.filesModifiedCount ?? 0} files · {pack.attestationStatus}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-xl px-3 text-[12px]"
            onClick={(e) => {
              e.stopPropagation();
              onVerify(pack.taskId);
            }}
          >
            Verify
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-xl px-3 text-[12px]"
            onClick={(e) => {
              e.stopPropagation();
              onExport(pack.taskId);
            }}
          >
            Export ZIP
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

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

function statusVariant(status: MissionRun["status"]): "default" | "secondary" | "destructive" {
  if (status === "completed") return "secondary";
  if (status === "running") return "default";
  return "destructive";
}

function getEventIcon(event: ToolEvent) {
  const text = `${event.label} ${event.detail}`.toLowerCase();
  if (event.status === "error") return WarningCircleIcon;
  if (text.includes("command") || text.includes("tool")) return TerminalWindowIcon;
  if (text.includes("file") || text.includes("diff") || text.includes("patch")) return FileCodeIcon;
  if (text.includes("check") || text.includes("test") || text.includes("lint")) return ListChecksIcon;
  return CircleIcon;
}

function getSemanticEventLabel(event: ToolEvent) {
  const label = event.label.toLowerCase();
  const text = `${event.label} ${event.detail}`.toLowerCase();
  if (event.status === "error") return "Policy pause";
  if (label.includes("resolve runbook")) return "Runbook selected";
  if (label.includes("agent pass")) return "Agent step";
  if (text.includes("retry")) return "Scoped retry";
  if (label.includes("patch") || label.includes("diff")) return "Patch attempt";
  if (text.includes("working set") || text.includes("inventory") || text.includes("search")) return "Scope discovery";
  if (label.includes("executing read")) return "File inspection";
  if (text.includes("file")) return "File inspection";
  if (label.includes("check") || label.includes("test") || label.includes("lint") || label.includes("typecheck")) {
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
  if (message.evidencePack?.verifiedTaskScore) {
    const score = message.evidencePack.verifiedTaskScore;
    return `${message.evidencePack.verdict.summary} Verified Task Score: ${score.score}/100 (${score.status}).`;
  }
  if (message.evidencePack?.verdict.summary) return message.evidencePack.verdict.summary;
  const content = message.content.trim();
  if (content.length === 0) return "Assistant turn completed without final synthesis text.";
  return content.length > 220 ? `${content.slice(0, 220)}...` : content;
}

export function RunsPage() {
  const platform = usePlatform();
  const { state } = useSidebar();
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

  const [localPacks, setLocalPacks] = useState<any[]>([]);
  const [showStandalonePacks, setShowStandalonePacks] = useState(false);
  const [selectedLocalTaskId, setSelectedLocalTaskId] = useState<string | null>(null);
  const [localPackDetail, setLocalPackDetail] = useState<any>(null);
  async function loadStandalonePacks() {
    if (!activeWorkspaceId) return;
    try {
      const packs = (await (window as any).mate?.evidencePack?.localList?.(activeWorkspaceId)) || [];
      setLocalPacks(packs);
      setShowStandalonePacks(true);
      setSelectedLocalTaskId(null);
      setLocalPackDetail(null);
    } catch (e) {
      console.error("Failed to load standalone evidence packs", e);
    }
  }

  async function loadLocalPackDetail(taskId: string) {
    if (!activeWorkspaceId) return;
    try {
      const pack = await (window as any).mate?.evidencePack?.get?.(activeWorkspaceId, taskId);
      setLocalPackDetail(pack);
      setSelectedLocalTaskId(taskId);
    } catch (e) {
      console.error("Failed to load pack detail", e);
    }
  }

  async function handleVerifyLocalPack(taskId: string) {
    if (!activeWorkspaceId) return;
    try {
      const res = await (window as any).mate?.evidencePack?.verifyAttestation?.(activeWorkspaceId, taskId);
      alert(res?.valid ? "Attestation valid ✓" : `Attestation invalid: ${res?.reason}`);
    } catch (e: any) {
      alert("Verify failed: " + (e?.message || e));
    }
  }

  async function handleExportLocalPack(taskId: string) {
    if (!activeWorkspaceId) return;
    try {
      const result = await (window as any).mate?.evidencePack?.exportZip?.(activeWorkspaceId, taskId);
      const zipPath = (result as any)?.zipPath;
      alert(`Compliance ZIP generated${zipPath ? ` at ${zipPath}` : ""}. Check .mate-x/evidence/${taskId}/`);
    } catch (e: any) {
      alert("Export failed: " + (e?.message || e));
    }
  }

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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--mate-page-bg)]">
      <header className={cn(
        "drag-region flex h-[52px] shrink-0 items-center justify-between border-b border-border/70 px-5 transition-[padding-left] duration-200 ease-linear",
        state === "collapsed" && platform === "mac" && "pl-[88px]",
        platform === "windows" && "pr-[138px]"
      )}>
        <div className="flex min-w-0 items-center gap-3">
          <SidebarTrigger className="-ml-1" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">Mission Log</h1>
            <p className="mate-text-secondary truncate">
              Real assistant runs from current workspace, shown as reviewable execution history.
            </p>
          </div>
        </div>
        <div className="mate-text-secondary flex min-w-0 items-center gap-2 overflow-x-auto">
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 rounded-xl px-3 text-xs focus-visible:ring-2 focus-visible:ring-ring/45"
            disabled={!selectedRun?.record}
            onClick={() => void handleExportRun()}
          >
            Export JSON
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 shrink-0 rounded-xl px-3 text-xs text-sky-600 focus-visible:ring-2 focus-visible:ring-ring/45 dark:text-sky-300"
            onClick={() => void loadStandalonePacks()}
          >
            Browse Proof Receipts
          </Button>
          <GitBranchIcon className="size-3.5" />
          <span className="max-w-[280px] truncate">{workspace?.path ?? "No workspace selected"}</span>
        </div>
      </header>

      {showStandalonePacks && (
        <div className="border-b border-border/70 bg-[var(--panel)]/80 px-4 py-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-medium text-foreground">Workspace proof receipts from .mate-x/evidence</div>
            <Button variant="ghost" size="sm" onClick={() => { setShowStandalonePacks(false); setSelectedLocalTaskId(null); setLocalPackDetail(null); }}>
              Close
            </Button>
          </div>
          {localPacks.length === 0 ? (
            <div className="text-muted-foreground">No packs found on disk for this workspace. Run an assistant task to generate one.</div>
          ) : (
            <ScrollArea className="w-full whitespace-nowrap pb-4">
              <div className="flex w-max space-x-2">
                {localPacks.map((p) => (
                  <StandalonePackItem
                    key={p.taskId}
                    pack={p}
                    isSelected={p.taskId === selectedLocalTaskId}
                    onSelect={loadLocalPackDetail}
                    onVerify={handleVerifyLocalPack}
                    onExport={handleExportLocalPack}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
          {localPackDetail && (
            <Card className="mt-3 bg-background/60">
              <CardContent className="p-3">
                <div className="mate-text-metadata break-all">Loaded from disk • {selectedLocalTaskId}</div>
                <div className="mt-1 text-sm font-medium">{localPackDetail.verdict?.label}</div>
                <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{localPackDetail.verdict?.summary}</div>
                <div className="mate-text-secondary mt-2">Score: {localPackDetail.verifiedTaskScore?.score ?? "n/a"} • Attestation: {localPackDetail.attestation?.status || "n/a"}</div>
                <div className="mate-text-secondary mt-1">Files: {(localPackDetail.filesModified || []).length} • Commands: {(localPackDetail.commandsExecuted || []).length}</div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {selectedRun ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto min-[1100px]:grid-cols-[260px_minmax(0,1fr)] min-[1100px]:overflow-hidden 2xl:grid-cols-[280px_minmax(0,1fr)_300px]">
          <aside className="min-h-0 border-r border-border/70 flex flex-col">
            <div className="border-b border-border/70 px-4 py-3">
              <div className="mate-text-metadata">
                Captured Runs
              </div>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="flex flex-col gap-1 p-2">
                {runs.map((run) => {
                  const status = runStatus === "running" && run.id === runs[0]?.id ? "running" : run.status;
                  return (
                    <button
                      className={cn(
                        "min-h-8 rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
                        run.id === selectedRun.id
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                      )}
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium">{run.title}</div>
                          <div className="mate-text-secondary mt-1 truncate">{run.threadTitle}</div>
                        </div>
                        <Badge variant={statusVariant(status)} className="px-2 py-0.5 text-[10px]">
                          {status}
                        </Badge>
                      </div>
                      <div className="mate-text-secondary mt-2 flex items-center justify-between">
                        <span>{formatTimestamp(run.startedAt)}</span>
                        <span>{run.events.length} events</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </aside>

          <main className="min-h-0 flex flex-col">
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-6">
                <div className="mb-5 grid grid-cols-5 gap-2">
                  <Metric label="Status" value={selectedStatus ?? "unknown"} />
                  <Metric label="Events" value={String(selectedRun.events.length)} />
                  <Metric
                    label="Changed"
                    value={String(selectedRun.assistantMessage.evidencePack?.filesModified?.length ?? 0)}
                  />
                  <Metric
                    label="Checks"
                    value={String(selectedRun.assistantMessage.evidencePack?.checks?.length ?? 0)}
                  />
                  <Metric
                    label="Verified Score"
                    value={
                      selectedRun.assistantMessage.evidencePack?.verifiedTaskScore
                        ? `${selectedRun.assistantMessage.evidencePack.verifiedTaskScore.score}/100`
                        : "n/a"
                    }
                  />
                </div>

                <Card className="mb-5 border-border/70">
                  <CardContent className="px-5 py-4">
                    <div className="mate-text-metadata mb-2 flex items-center gap-2">
                      <ChatTextIcon className="size-4" weight="regular" />
                      Initial Intent
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-5 text-foreground">{selectedRun.userIntent}</p>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  {selectedRun.events.length > 0 ? (
                    selectedRun.events.map((event, index) => {
                      const Icon = getEventIcon(event);
                      return (
                        <article className="grid grid-cols-[42px_24px_minmax(0,1fr)] gap-3" key={event.id}>
                          <div className="mate-text-secondary pt-1 text-right">{index + 1}</div>
                          <div className="flex flex-col items-center">
                            <div className="flex size-6 items-center justify-center rounded-full border border-border bg-[var(--mate-control-bg)] backdrop-blur-md z-10">
                              <Icon className="size-3.5 text-muted-foreground" />
                            </div>
                            <Separator orientation="vertical" className="h-full bg-border/70" />
                          </div>
                          <Card className="border-border/70 shadow-none mb-3">
                            <CardContent className="px-4 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <h2 className="text-xs font-semibold text-foreground">{getSemanticEventLabel(event)}</h2>
                                <Badge 
                                  variant={event.status === "error" ? "destructive" : event.status === "active" ? "default" : "secondary"}
                                  className="px-2 py-0.5 text-[10px] uppercase tracking-wider"
                                >
                                  {event.status}
                                </Badge>
                              </div>
                              <div className="mt-1 break-words text-[13px] font-medium text-foreground">{event.label}</div>
                              <p className="mt-1 whitespace-pre-wrap break-all text-xs leading-5 text-muted-foreground">
                                {event.detail || "No detail captured for this event."}
                              </p>
                            </CardContent>
                          </Card>
                        </article>
                      );
                    })
                  ) : (
                    <Empty>
                      <EmptyTitle>No tool timeline was captured</EmptyTitle>
                      <EmptyDescription>For this assistant turn.</EmptyDescription>
                    </Empty>
                  )}
                </div>
              </div>
            </ScrollArea>
          </main>

          <aside className="min-h-0 border-l border-border/70 flex flex-col min-[1100px]:col-span-2 2xl:col-span-1">
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-5">
                <div className="mate-text-metadata">
                  Run Evidence
                </div>
                <h2 className="mt-2 text-sm font-semibold text-foreground">{selectedRun.title}</h2>
                
                <Separator className="my-4" />
                
                <dl className="space-y-4 text-xs">
                  <Detail label="Thread" value={selectedRun.threadTitle} />
                  <Detail label="Initial state" value={selectedRun.record ? `${selectedRun.record.initialState.workspaceName}\n${selectedRun.record.initialState.workspacePath}\nbranch ${selectedRun.record.initialState.branch}` : "Legacy run inferred from assistant message"} />
                  <div>
                    <dt className="text-muted-foreground">Decisions</dt>
                    <dd className="mt-2 flex flex-col gap-2">
                      {decisionTrail.map((decision) => (
                        <Card key={`${decision.label}:${decision.detail}`} className="border-border/60 shadow-none">
                          <CardContent className="px-2.5 py-2">
                            <div className="font-medium text-foreground break-words">{decision.label}</div>
                            <div className="mate-text-secondary mt-0.5 break-all">{decision.detail}</div>
                          </CardContent>
                        </Card>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Integrity</dt>
                    <dd className="mt-2">
                      <Card className="border-border/60 shadow-none">
                        <CardContent className="px-2.5 py-2">
                          {selectedRun.record?.integrity ? (
                            <>
                              <div className="font-medium text-emerald-600 dark:text-emerald-300">Sealed run</div>
                              <div className="mate-text-secondary mt-1 break-all font-mono">
                                {selectedRun.record.integrity.rootHash}
                              </div>
                              <div className="mate-text-secondary mt-1">Exportable proof receipt · replay material preserved</div>
                            </>
                          ) : (
                            <>
                              <div className="font-medium text-sky-600 dark:text-sky-300">Sealing pending</div>
                              <div className="mate-text-secondary mt-1">
                                Run is still active or from legacy history. Final export will seal artifact.
                              </div>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    </dd>
                  </div>
                  <Detail label="Started" value={formatTimestamp(selectedRun.startedAt)} />
                  <Detail label="Completed" value={formatTimestamp(selectedRun.completedAt)} />
                  <Detail label="Tools used" value={(selectedRun.assistantMessage.evidencePack?.toolsUsed ?? []).map((tool) => tool.name).join(", ") || "None reported"} />
                  <div>
                    <dt className="text-muted-foreground">Commands</dt>
                    <dd className="mt-2 flex flex-col gap-2">
                      {commandEvidence.length > 0 ? (
                        commandEvidence.map((command) => (
                          <Card key={`${command.tool}:${command.target}:${command.result}`} className="border-border/60 shadow-none">
                            <CardContent className="px-2.5 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[13px] font-medium text-foreground">{command.tool}</span>
                                <Badge variant="secondary" className="px-1.5 py-0.5 text-[10px] rounded">{command.result}</Badge>
                              </div>
                              <div className="mate-text-secondary mt-1">{command.action}</div>
                              <div className="mate-text-secondary mt-1 truncate font-mono">{command.target}</div>
                            </CardContent>
                          </Card>
                        ))
                      ) : (
                        <div className="mate-text-secondary rounded-xl border border-border/60 px-2.5 py-2">
                          No command artifacts reported. Tool activity remains available in timeline.
                        </div>
                      )}
                    </dd>
                  </div>
                </dl>
                
                <Separator className="my-5" />
                
                <Card className="border-border/70 shadow-none">
                  <CardContent className="px-4 py-3">
                    <div className="mate-text-metadata mb-1 flex items-center gap-2">
                      <CheckCircleIcon className="size-4" weight="regular" />
                      Final Result
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                      {summarizeResult(selectedRun.assistantMessage)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          </aside>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6">
          <Empty>
            <EmptyMedia variant="icon">
              <ActivityIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No reproducible runs captured</EmptyTitle>
              <EmptyDescription>
                Ask MaTE X to work on current workspace. Mission Log will show real assistant turns, tool events,
                evidence packs, commands, files, and final results.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border/70 shadow-none">
      <CardContent className="px-4 py-3">
        <div className="mate-text-metadata">{label}</div>
        <div className="mt-1 truncate text-sm font-semibold">{value}</div>
      </CardContent>
    </Card>
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
