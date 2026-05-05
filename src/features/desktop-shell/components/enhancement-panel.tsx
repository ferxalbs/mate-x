import { useCallback, useEffect, useState } from "react";
import {
  ChevronRightIcon,
  ClipboardCheckIcon,
  GitBranchIcon,
  PanelRightIcon,
} from "lucide-react";

import { Button } from "../../../components/ui/button";
import type { Conversation, RunStatus } from "../../../contracts/chat";
import type { RepoGraphImpactedFile } from "../../../contracts/repo-graph";
import type { WorkspaceHealthProfile } from "../../../contracts/workspace";
import { cn } from "../../../lib/utils";
import {
  EvidencePackSection,
  type EnhancementView,
  ImpactSection,
  RepoHealthSection,
  TraceSection,
  ValidationSection,
} from "./enhancement-panel-sections";
import {
  getChangedFiles,
  getEvidenceCommands,
  getEvidenceFiles,
  getPanelRuntimeSnapshot,
  getRepoHealthSignals,
  getVerificationCommands,
  getVerifiedScore,
  summarizeImpact,
} from "./enhancement-panel-utils";

interface EnhancementPanelProps {
  conversation: Conversation | null;
  health: WorkspaceHealthProfile | null;
  runStatus: RunStatus;
  workspaceId: string | null;
}

const views: { id: EnhancementView; label: string }[] = [
  { id: "trace", label: "TRACE" },
  { id: "impact", label: "Impact" },
  { id: "validation", label: "Validation" },
  { id: "evidence", label: "Evidence" },
];

export function EnhancementPanel({
  conversation,
  health,
  runStatus,
  workspaceId,
}: EnhancementPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [activeView, setActiveView] = useState<EnhancementView>("trace");
  const [loading, setLoading] = useState(false);
  const [changedFiles, setChangedFiles] = useState<string[]>([]);
  const [impactedFiles, setImpactedFiles] = useState<RepoGraphImpactedFile[]>(
    [],
  );
  const [tests, setTests] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanPhase, setScanPhase] = useState<string | null>(null);

  const runtime = getPanelRuntimeSnapshot(conversation, runStatus);
  const summary = summarizeImpact(changedFiles, impactedFiles);
  const repoSignals = getRepoHealthSignals(health);
  const evidenceCommands = getEvidenceCommands(runtime.evidencePack);
  const evidenceFiles = getEvidenceFiles(runtime.evidencePack);
  const verifiedScore = getVerifiedScore(runtime.evidencePack);
  const verdictLabel = runtime.evidencePack?.verdict.label ?? "";
  const cleanVerdictLabel = verdictLabel.replace(/\*/g, "").trim();
  const runFailed = /fail|error|blocked/i.test(verdictLabel);
  const lowConfidence =
    verifiedScore !== null && verifiedScore < 50 && runtime.evidencePack !== null;
  const panelState = error
    ? "Needs attention"
    : runFailed
      ? verdictLabel
      : lowConfidence
        ? `Low confidence: ${cleanVerdictLabel || "review incomplete"}`
      : loading || runtime.isRunning
        ? scanPhase ?? "Processing"
        : health
        ? runtime.statusLabel
        : "Awaiting workspace profile";
  const commands =
    evidenceCommands.length > 0
      ? evidenceCommands
      : getVerificationCommands(tests, health);

  useEffect(() => {
    setChangedFiles([]);
    setImpactedFiles([]);
    setTests([]);
    setError(null);
    setScanPhase(null);
    setActiveView("trace");
  }, [workspaceId]);

  const runEnhancementScan = useCallback(async () => {
    if (!workspaceId) {
      return;
    }

    setLoading(true);
    setError(null);
    setScanPhase("Reading git status");
    try {
      const status = await window.mate.git.getStatus();
      const files = getChangedFiles(status);
      setScanPhase("Refreshing RepoGraph");
      await window.mate.repo.graph.refresh();
      setScanPhase(
        files.length > 0 ? "Mapping changed paths" : "Checking workspace graph",
      );
      const [impact, testLists] = await Promise.all([
        files.length > 0
          ? window.mate.repo.graph.getImpactedFiles(files)
          : Promise.resolve([]),
        Promise.all(
          files.map((file) => window.mate.repo.graph.getTestsForFile(file)),
        ),
      ]);
      setScanPhase("Classifying repo signals");
      setChangedFiles(files);
      setImpactedFiles(impact);
      setTests([...new Set(testLists.flat())].slice(0, 6));
      setActiveView(files.length > 0 ? "impact" : "trace");
    } catch (scanError) {
      setError((scanError as Error).message);
    } finally {
      setLoading(false);
      setScanPhase(null);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId) {
      void runEnhancementScan();
    }
  }, [runEnhancementScan, workspaceId]);

  useEffect(() => {
    const handleToggle = () => setCollapsed((current) => !current);
    window.addEventListener("mate:toggle-enhancement-panel", handleToggle);
    return () => {
      window.removeEventListener("mate:toggle-enhancement-panel", handleToggle);
    };
  }, []);

  useEffect(() => {
    const handleCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: "open" | "scan"; view?: EnhancementView }>).detail;
      if (detail?.view) {
        setActiveView(detail.view);
        setCollapsed(false);
      }
      if (detail?.action === "open") {
        setCollapsed(false);
      }
      if (detail?.action === "scan") {
        setCollapsed(false);
        void runEnhancementScan();
      }
    };
    window.addEventListener("mate:enhancement-panel-command", handleCommand);
    return () => {
      window.removeEventListener("mate:enhancement-panel-command", handleCommand);
    };
  }, [runEnhancementScan]);

  if (!workspaceId) {
    return null;
  }

  if (collapsed) {
    return null;
  }

  return (
    <aside className="hidden h-full w-[292px] shrink-0 border-l border-[var(--panel-border)]/45 bg-[var(--panel)]/88 backdrop-blur-xl lg:flex 2xl:w-[316px]">
      <div className="flex min-h-0 w-full flex-col">
        <div className="border-b border-[var(--panel-border)]/45 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[13px] font-semibold text-foreground">
                  Live
                </h2>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                {runtime.activeRunTitle ?? panelState}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                aria-label="Hide enhancement panel"
                className="flex size-8 items-center justify-center rounded-full border border-[var(--panel-border)]/55 bg-background/55 text-muted-foreground hover:border-primary/40 hover:bg-primary/12 hover:text-primary"
                onClick={() => setCollapsed(true)}
                type="button"
              >
                <ChevronRightIcon className="size-4" />
              </button>
              <Button
                className="h-8 rounded-full border-[var(--panel-border)]/55 bg-background/55 px-3 text-[11px] shadow-none hover:border-primary/40 hover:bg-primary/12 hover:text-primary disabled:opacity-60"
                disabled={loading}
                onClick={runEnhancementScan}
                size="xs"
                variant="outline"
              >
                <GitBranchIcon className="size-3.5" />
                {loading ? "Processing" : "Scan"}
              </Button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-2xl border border-[var(--panel-border)]/45 bg-background/42 px-3 py-2 text-[11px]">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <PanelRightIcon className="size-3.5 shrink-0" />
              <span className="truncate">{panelState}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  error
                    ? "bg-destructive"
                    : runFailed
                    ? "bg-destructive"
                    : loading || runtime.isRunning
                      ? "animate-pulse bg-blue-500"
                      : health
                        ? "bg-emerald-500"
                        : "bg-muted-foreground",
                )}
              />
              {runtime.events.length} events
            </span>
          </div>
          {loading ? (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-background/35">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-primary/70" />
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-4 gap-1 rounded-full border border-[var(--panel-border)]/45 bg-background/42 p-1">
            {views.map((view) => (
              <button
                className={cn(
                  "h-7 rounded-full px-1 text-[10px] font-medium transition-colors",
                  activeView === view.id
                    ? "bg-primary/18 text-primary"
                    : "text-muted-foreground hover:bg-accent/55 hover:text-foreground",
                )}
                key={view.id}
                onClick={() => setActiveView(view.id)}
                type="button"
              >
                {view.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          {activeView === "trace" ? (
            <TraceSection
              changedFiles={changedFiles}
              events={runtime.events}
              impactedFiles={impactedFiles}
              isLoading={loading || runtime.isRunning}
              summary={summary}
            />
          ) : null}
          {activeView === "impact" ? (
            <ImpactSection
              changedFiles={changedFiles}
              impactedFiles={impactedFiles}
              isLoading={loading}
              summary={summary}
            />
          ) : null}
          {activeView === "validation" ? (
            <ValidationSection
              commands={commands}
              evidencePack={runtime.evidencePack}
              isLoading={runtime.isRunning}
              tests={tests}
            />
          ) : null}
          {activeView === "evidence" ? (
            <EvidencePackSection
              changedFiles={changedFiles}
              commands={commands}
              evidenceFiles={evidenceFiles}
              evidencePack={runtime.evidencePack}
              impactedFiles={impactedFiles}
              score={verifiedScore}
              summary={summary}
            />
          ) : null}

          <div className="mt-4 rounded-2xl border border-[var(--panel-border)]/38 bg-background/24 p-3">
            <RepoHealthSection
              hasProfile={Boolean(health)}
              signals={repoSignals}
              nextAction={health?.recommendedNextAction}
            />
          </div>

          {error ? (
            <p className="mt-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              {error}
            </p>
          ) : !runtime.evidencePack && activeView === "evidence" ? (
            <p className="mt-3 rounded-2xl border border-[var(--panel-border)]/35 bg-background/24 px-3 py-2 text-[11px] text-muted-foreground">
              <ClipboardCheckIcon className="mr-1 inline size-3.5" />
              Evidence Pack appears after verified run completes.
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
