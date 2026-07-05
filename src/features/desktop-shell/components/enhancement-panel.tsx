import { useCallback, useEffect, useState } from "react";
import { ClipboardCheckIcon } from "lucide-react";

import { Card, CardContent } from "../../../components/ui/card";
import { ScrollArea } from "../../../components/ui/scroll-area";
import type { Conversation, RunStatus } from "../../../contracts/chat";
import type { RepoGraphImpactedFile } from "../../../contracts/repo-graph";
import type { WorkspaceSummary } from "../../../contracts/workspace";
import { PanelHeader, PanelTabs } from "./enhancement-panel-chrome";
import {
  EvidencePackSection,
  type EnhancementView,
  ImpactSection,
  RepoHealthSection,
  ValidationSection,
} from "./enhancement-panel-sections";
import { TraceSection } from "./enhancement-trace-section";
import {
  getChangedFiles,
  getEvidenceCommands,
  getEvidenceFiles,
  getPanelRuntimeSnapshot,
  getRepoHealthSignals,
  getVerifiedEvidenceScore,
  getVerificationCommands,
  hasVerifiedEvidenceSignals,
  summarizeImpact,
} from "./enhancement-panel-utils";

interface EnhancementPanelProps {
  conversation: Conversation | null;
  runStatus: RunStatus;
  workspace: WorkspaceSummary | null;
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
  runStatus,
  workspace,
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
  const health = workspace?.health ?? null;
  const summary = summarizeImpact(changedFiles, impactedFiles);
  const repoSignals = getRepoHealthSignals(health, workspace);
  const evidenceCommands = getEvidenceCommands(runtime.evidencePack);
  const evidenceFiles = getEvidenceFiles(runtime.evidencePack);
  const verifiedScore = getVerifiedEvidenceScore(runtime.evidencePack);
  const verdictLabel = runtime.evidencePack?.verdict.label ?? "";
  const cleanVerdictLabel = verdictLabel.replace(/\*/g, "").trim();
  const runFailed = /fail|error|blocked/i.test(verdictLabel);
  const needsEvidence =
    runtime.evidencePack !== null && !hasVerifiedEvidenceSignals(runtime.evidencePack);
  const lowConfidence =
    verifiedScore !== null && verifiedScore < 50 && runtime.evidencePack !== null;
  const panelState = error
    ? "Needs attention"
    : runFailed
      ? verdictLabel
      : needsEvidence
        ? "Needs evidence"
      : lowConfidence
        ? `Low confidence: ${cleanVerdictLabel || "review incomplete"}`
      : loading || runtime.isRunning
        ? scanPhase ?? "Processing"
        : health
        ? runtime.statusLabel
        : "Local trace active";
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
    <aside className="hidden h-full w-[292px] shrink-0 border-l border-[var(--panel-border)]/45 bg-[var(--mate-panel-bg)] backdrop-blur-2xl lg:flex 2xl:w-[316px]">
      <div className="flex min-h-0 w-full flex-col">
        <div className="border-b border-[var(--panel-border)]/45 px-4 py-4">
          <PanelHeader
            activeRunTitle={runtime.activeRunTitle}
            eventCount={runtime.events.length}
            hasError={Boolean(error)}
            hasHealth={Boolean(health)}
            isLoading={loading}
            isRunning={runtime.isRunning}
            onCollapse={() => setCollapsed(true)}
            onScan={runEnhancementScan}
            panelState={panelState}
            runFailed={runFailed}
          />
          {loading ? (
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--mate-control-bg)]">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-primary/70" />
            </div>
          ) : null}
          <PanelTabs activeView={activeView} onChange={setActiveView} tabs={views} />
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-4 py-4">
          {activeView === "trace" ? (
            <TraceSection
              changedFiles={changedFiles}
              commands={commands}
              evidencePack={runtime.evidencePack}
              events={runtime.events}
              hasHealth={Boolean(health)}
              impactedFiles={impactedFiles}
              isLoading={loading || runtime.isRunning}
              isRunning={runtime.isRunning}
              scanPhase={scanPhase}
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

          <Card className="mt-4 border-border/70 shadow-none bg-[var(--mate-control-bg)] backdrop-blur-md">
            <CardContent className="p-3">
              <RepoHealthSection
                hasWorkspace={Boolean(workspace)}
                hasProfile={Boolean(health)}
                workspace={workspace}
                signals={repoSignals}
                nextAction={health?.recommendedNextAction}
              />
            </CardContent>
          </Card>

          {error ? (
            <Card className="mt-3 border-destructive/40 shadow-none bg-destructive/5">
              <CardContent className="px-3 py-2 text-[11px] text-destructive">
                {error}
              </CardContent>
            </Card>
          ) : !runtime.evidencePack && activeView === "evidence" ? (
            <Card className="mt-3 border-border/70 shadow-none bg-[var(--mate-control-bg)] backdrop-blur-md">
              <CardContent className="px-3 py-2 text-[11px] text-muted-foreground">
                <ClipboardCheckIcon className="mr-1 inline size-3.5" />
                Evidence Pack appears after verified run completes.
              </CardContent>
            </Card>
          ) : null}
          </div>
        </ScrollArea>
      </div>
    </aside>
  );
}
