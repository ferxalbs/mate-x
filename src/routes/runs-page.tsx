import { HugeiconsIcon } from "@hugeicons/react";
import {
  Activity01Icon,
  ChatIcon,
  CheckmarkCircle01Icon,
  CircleIcon,
  CodeIcon,
  GitBranchIcon,
  Task01Icon,
  TerminalIcon,
  Alert01Icon,
  Search01Icon,
  Download01Icon,
  CheckmarkCircle02Icon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";

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
        "w-[min(280px,calc(100vw-3rem))] shrink-0 cursor-pointer rounded-2xl border transition-colors shadow-none",
        isSelected ? "border-primary/60 bg-primary/5" : "border-border/60 hover:border-border",
      )}
      onClick={() => onSelect(pack.taskId)}
    >
      <CardContent className="p-3">
        <div className="truncate font-mono text-[11px] text-muted-foreground">{pack.taskId}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[12.5px] font-semibold text-foreground">{pack.verdict?.label || pack.status}</span>
          {pack.verifiedTaskScore && (
            <span className="text-[11px] text-muted-foreground">· {pack.verifiedTaskScore.score}/100</span>
          )}
        </div>
        <div className="mt-1 text-[11.5px] text-muted-foreground">
          {pack.filesModifiedCount ?? 0} files · {pack.attestationStatus}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 rounded-xl border-border/60 px-3 text-[11.5px] font-medium"
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
            className="h-7 rounded-xl border-border/60 px-3 text-[11.5px] font-medium"
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

function statusBadgeTone(status: MissionRun["status"]) {
  if (status === "completed") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
  if (status === "running") return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 animate-pulse";
  return "bg-destructive/10 text-destructive border-destructive/20";
}

function getEventIcon(event: ToolEvent) {
  const text = `${event.label} ${event.detail}`.toLowerCase();
  if (event.status === "error") return Alert01Icon;
  if (text.includes("command") || text.includes("tool")) return TerminalIcon;
  if (text.includes("file") || text.includes("diff") || text.includes("patch")) return CodeIcon;
  if (text.includes("check") || text.includes("test") || text.includes("lint")) return Task01Icon;
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

function renderEventDetail(detail?: string) {
  if (!detail) return <p className="mt-1 text-[11.5px] italic text-muted-foreground/70">No detail captured for this event.</p>;
  const trimmed = detail.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      return (
        <div className="mt-2 space-y-1 rounded-xl border border-border/50 bg-control/25 p-2.5 font-mono text-[11px]">
          {Object.entries(parsed).map(([key, val]) => (
            <div className="flex items-start justify-between gap-3 min-w-0" key={key}>
              <span className="shrink-0 text-muted-foreground font-medium">{key}:</span>
              <span className="truncate text-foreground font-semibold">
                {typeof val === "object" ? JSON.stringify(val) : String(val)}
              </span>
            </div>
          ))}
        </div>
      );
    } catch {
      // Fallback if not valid JSON
    }
  }
  return (
    <p className="mt-1 whitespace-pre-wrap break-all text-[12px] leading-relaxed text-muted-foreground">
      {detail}
    </p>
  );
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
  const [searchQuery, setSearchQuery] = useState("");

  const filteredRuns = useMemo(() => {
    if (!searchQuery.trim()) return runs;
    const query = searchQuery.toLowerCase();
    return runs.filter(
      (run) =>
        run.title.toLowerCase().includes(query) ||
        run.threadTitle.toLowerCase().includes(query) ||
        run.userIntent.toLowerCase().includes(query)
    );
  }, [runs, searchQuery]);

  const selectedRun = filteredRuns.find((run) => run.id === selectedRunId) ?? filteredRuns[0] ?? runs[0] ?? null;
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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-transparent">
      <header
        className={cn(
          "drag-region flex h-[52px] shrink-0 items-center justify-between border-b border-border/60 px-5 bg-transparent",
          state === "collapsed" && platform === "mac" && "pl-[88px]",
          platform === "windows" && "pr-[138px]"
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <SidebarTrigger className="-ml-1" />
          <div className="min-w-0">
            <h1 className="truncate text-[13px] font-semibold text-foreground tracking-tight">Mission Log</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              Execution history and verifiable audit evidence for current workspace.
            </p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          <Button
            variant="outline"
            size="sm"
            className="h-7.5 rounded-xl border-border/60 px-3 text-[11.5px] font-medium text-foreground hover:bg-accent shadow-none"
            disabled={!selectedRun?.record}
            onClick={() => void handleExportRun()}
          >
            <HugeiconsIcon icon={Download01Icon} className="size-3.5 mr-1.5" />
            Export JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7.5 rounded-xl border-border/60 px-3 text-[11.5px] font-medium text-primary hover:bg-primary/10 shadow-none"
            onClick={() => void loadStandalonePacks()}
          >
            <HugeiconsIcon icon={Shield01Icon} className="size-3.5 mr-1.5" />
            Proof Receipts
          </Button>
          <div className="h-4 w-px bg-border/50 mx-1" />
          <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground truncate max-w-[240px]">
            <HugeiconsIcon icon={GitBranchIcon} className="size-3.5 shrink-0" />
            <span className="truncate">{workspace?.path ?? "No workspace"}</span>
          </div>
        </div>
      </header>

      {showStandalonePacks && (
        <div className="border-b border-border/60 bg-control/40 px-4 py-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Workspace proof receipts from .mate-x/evidence
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 rounded-lg px-2 text-[11px]"
              onClick={() => {
                setShowStandalonePacks(false);
                setSelectedLocalTaskId(null);
                setLocalPackDetail(null);
              }}
            >
              Close
            </Button>
          </div>
          {localPacks.length === 0 ? (
            <div className="text-muted-foreground text-[12px]">
              No evidence packs found on disk for this workspace.
            </div>
          ) : (
            <ScrollArea className="w-full whitespace-nowrap pb-2">
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
            <Card className="mt-2.5 rounded-xl border-border/60 bg-panel shadow-none">
              <CardContent className="p-3">
                <div className="text-[10px] font-mono text-muted-foreground break-all">
                  Loaded from disk • {selectedLocalTaskId}
                </div>
                <div className="mt-1 text-[13px] font-semibold text-foreground">
                  {localPackDetail.verdict?.label}
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground line-clamp-2">
                  {localPackDetail.verdict?.summary}
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">
                  Score: {localPackDetail.verifiedTaskScore?.score ?? "n/a"} • Attestation:{" "}
                  {localPackDetail.attestation?.status || "n/a"}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {selectedRun ? (
        <div className="flex flex-col md:flex-row flex-1 min-h-0 min-w-0 overflow-y-auto md:overflow-hidden">
          {/* Left Sidebar: Runs List */}
          <aside className="shrink-0 w-full md:w-[260px] xl:w-[280px] border-b md:border-b-0 md:border-r border-border/60 flex flex-col min-h-[260px] md:min-h-0 bg-transparent">
            <div className="sticky top-0 z-10 border-b border-border/60 p-2.5 space-y-2 bg-transparent">
              <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Captured Runs
              </div>
              <div className="relative">
                <HugeiconsIcon icon={Search01Icon} className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Filter runs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-7.5 w-full rounded-xl border border-border/60 bg-card/60 pl-8 pr-2.5 text-[11.5px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/60 control-surface transition-all"
                />
              </div>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="flex flex-col gap-1.5 p-2">
                {filteredRuns.map((run) => {
                  const status = runStatus === "running" && run.id === runs[0]?.id ? "running" : run.status;
                  const isSelected = run.id === selectedRun.id;
                  return (
                    <button
                      className={cn(
                        "rounded-xl border px-3 py-2 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                        isSelected
                          ? "control-surface border-border/70 bg-card text-foreground font-semibold shadow-xs"
                          : "border-transparent text-muted-foreground hover:bg-card/50 hover:border-border/50 hover:text-foreground"
                      )}
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-medium leading-snug">{run.title}</div>
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{run.threadTitle}</div>
                        </div>
                        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider", statusBadgeTone(status))}>
                          {status}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[10.5px] text-muted-foreground">
                        <span>{formatTimestamp(run.startedAt)}</span>
                        <span>{run.events.length} events</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </aside>

          {/* Center Main Content: Timeline */}
          <main className="flex-1 min-w-0 flex flex-col min-h-[500px] md:min-h-0 relative z-0">
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-5 max-w-[900px] mx-auto space-y-4">
                {/* Stat Metrics Row */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
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

                {/* Initial Intent Card */}
                <Card className="control-surface rounded-2xl border border-border/70 bg-card text-card-foreground shadow-none">
                  <CardContent className="px-4.5 py-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                      <HugeiconsIcon icon={ChatIcon} className="size-3.5 text-primary" />
                      Initial Intent
                    </div>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed font-medium text-foreground">
                      {selectedRun.userIntent}
                    </p>
                  </CardContent>
                </Card>

                {/* Event Timeline Stream */}
                <div className="space-y-3 pt-1">
                  {selectedRun.events.length > 0 ? (
                    selectedRun.events.map((event, index) => {
                      const Icon = getEventIcon(event);
                      return (
                        <article className="grid grid-cols-[36px_20px_minmax(0,1fr)] gap-3 items-start" key={event.id}>
                          <div className="pt-1.5 text-right font-mono text-[11px] text-muted-foreground font-medium">
                            {index + 1}
                          </div>
                          <div className="flex flex-col items-center h-full">
                            <div className="flex size-5.5 items-center justify-center rounded-full border border-border/70 bg-control text-muted-foreground shrink-0 mt-1">
                              <HugeiconsIcon icon={Icon} className="size-3" />
                            </div>
                            {index < selectedRun.events.length - 1 && (
                              <div className="w-px flex-1 bg-border/50 my-1" />
                            )}
                          </div>
                          <Card className="control-surface rounded-2xl border border-border/70 bg-card text-card-foreground shadow-none hover:border-border transition-colors">
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between gap-3">
                                <h2 className="text-[13px] font-semibold text-foreground tracking-tight">{getSemanticEventLabel(event)}</h2>
                                <span className={cn("px-2.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider rounded-full border", statusBadgeTone(event.status === "error" ? "failed" : event.status === "active" ? "running" : "completed"))}>
                                  {event.status}
                                </span>
                              </div>
                              <div className="mt-1.5 text-[13px] font-medium text-foreground">{event.label}</div>
                              {renderEventDetail(event.detail)}
                            </CardContent>
                          </Card>
                        </article>
                      );
                    })
                  ) : (
                    <Empty>
                      <EmptyTitle>No tool timeline captured</EmptyTitle>
                      <EmptyDescription>No events were recorded for this assistant turn.</EmptyDescription>
                    </Empty>
                  )}
                </div>
              </div>
            </ScrollArea>
          </main>

          {/* Right Sidebar: Run Evidence */}
          <aside className="shrink-0 w-full md:w-[280px] xl:w-[300px] border-t md:border-t-0 md:border-l border-border/60 flex flex-col min-h-[380px] md:min-h-0 bg-transparent">
            <div className="sticky top-0 z-10 border-b border-border/60 px-4 py-3 bg-transparent">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Run Evidence
              </div>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-4 space-y-4">
                <div>
                  <h2 className="text-[13px] font-semibold text-foreground">{selectedRun.title}</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{selectedRun.threadTitle}</p>
                </div>

                <Separator className="bg-border/50" />

                <dl className="space-y-3.5 text-[12px]">
                  <Detail label="Initial state" value={selectedRun.record ? `${selectedRun.record.initialState.workspaceName}\n${selectedRun.record.initialState.workspacePath}\nbranch ${selectedRun.record.initialState.branch}` : "Legacy run inferred"} />
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Decisions</dt>
                    <dd className="mt-1.5 flex flex-col gap-1.5">
                      {decisionTrail.map((decision) => (
                        <Card key={`${decision.label}:${decision.detail}`} className="control-surface rounded-xl border border-border/70 bg-card text-card-foreground shadow-none">
                          <CardContent className="p-3">
                            <div className="text-[12.5px] font-semibold text-foreground">{decision.label}</div>
                            <div className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground break-words">{decision.detail}</div>
                          </CardContent>
                        </Card>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Integrity</dt>
                    <dd className="mt-1.5">
                      <Card className="control-surface rounded-xl border border-border/70 bg-card text-card-foreground shadow-none">
                        <CardContent className="p-3">
                          {selectedRun.record?.integrity ? (
                            <>
                              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5" />
                                Sealed run
                              </div>
                              <div className="mt-1.5 font-mono text-[10.5px] text-muted-foreground break-all rounded-lg bg-secondary/40 p-2 border border-border/50">
                                {selectedRun.record.integrity.rootHash}
                              </div>
                              <div className="mt-1.5 text-[10.5px] text-muted-foreground">Exportable proof receipt · replay preserved</div>
                            </>
                          ) : (
                            <>
                              <div className="text-[12.5px] font-semibold text-primary">Sealing pending</div>
                              <div className="mt-1 text-[11.5px] text-muted-foreground">
                                Run active or legacy. Final export seals artifact.
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
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Commands</dt>
                    <dd className="mt-1.5 flex flex-col gap-1.5">
                      {commandEvidence.length > 0 ? (
                        commandEvidence.map((command) => (
                          <Card key={`${command.tool}:${command.target}:${command.result}`} className="control-surface rounded-xl border border-border/70 bg-card text-card-foreground shadow-none">
                            <CardContent className="p-3">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[11.5px] font-semibold text-foreground">{command.tool}</span>
                                <span className="rounded-full border border-border/60 bg-secondary/50 px-2 py-0.5 font-mono text-[9.5px] text-muted-foreground">{command.result}</span>
                              </div>
                              <div className="mt-1 text-[11.5px] text-muted-foreground">{command.action}</div>
                              <div className="mt-1 font-mono text-[10.5px] text-muted-foreground/80 truncate rounded-md bg-secondary/30 px-1.5 py-0.5">{command.target}</div>
                            </CardContent>
                          </Card>
                        ))
                      ) : (
                        <div className="rounded-xl border border-border/60 bg-secondary/30 p-2.5 text-[11px] text-muted-foreground">
                          No command artifacts reported.
                        </div>
                      )}
                    </dd>
                  </div>
                </dl>

                <Separator className="bg-border/50 my-4" />

                <Card className="control-surface rounded-2xl border border-border/70 bg-card text-card-foreground shadow-none">
                  <CardContent className="p-3.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-3.5 text-primary" />
                      Final Result
                    </div>
                    <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">
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
              <HugeiconsIcon icon={Activity01Icon} />
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
    <Card className="rounded-xl border border-border/60 bg-control/20 shadow-none">
      <CardContent className="px-3.5 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</div>
        <div className="mt-0.5 truncate text-[15px] font-semibold tabular-nums text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-[12px] font-medium text-foreground">{value}</dd>
    </div>
  );
}
