import { useCallback, useEffect, useState } from "react";
import { Outlet } from "@tanstack/react-router";
import {
  ActivityIcon,
  GitBranchIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { SidebarProvider } from "../../components/ui/sidebar";
import type { GitStatus } from "../../contracts/git";
import type { RepoGraphImpactedFile } from "../../contracts/repo-graph";
import type { WorkspaceHealthProfile } from "../../contracts/workspace";
import { useTheme } from "../../hooks/use-theme";
import {
  applyRendererSettings,
  getAppSettings,
} from "../../services/settings-client";
import { useChatStore } from "../../store/chat-store";
import { AppSidebar } from "./components/app-sidebar";

export function DesktopShell() {
  const workspaces = useChatStore((state) => state.workspaces);
  const workspace = useChatStore((state) => state.workspace);
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const threadsByWorkspace = useChatStore((state) => state.threadsByWorkspace);
  const activeThreadIds = useChatStore((state) => state.activeThreadIds);
  const runStatus = useChatStore((state) => state.runStatus);
  const bootstrap = useChatStore((state) => state.bootstrap);
  const importWorkspace = useChatStore((state) => state.importWorkspace);
  const activateWorkspace = useChatStore((state) => state.activateWorkspace);
  const removeWorkspace = useChatStore((state) => state.removeWorkspace);
  const createThread = useChatStore((state) => state.createThread);
  const selectThread = useChatStore((state) => state.selectThread);
  const renameThread = useChatStore((state) => state.renameThread);
  const threads = activeWorkspaceId
    ? (threadsByWorkspace[activeWorkspaceId] ?? [])
    : [];
  const activeThreadId = activeWorkspaceId
    ? (activeThreadIds[activeWorkspaceId] ?? "")
    : "";
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    let cancelled = false;
    void getAppSettings()
      .then((settings) => {
        if (!cancelled) {
          setTheme(settings.theme);
          applyRendererSettings(settings);
        }
      })
      .catch(() => {
        // Keep renderer defaults when settings are unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [setTheme]);

  return (
    <SidebarProvider defaultOpen>
      <main className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <div className="flex h-full w-full overflow-hidden bg-background">
          <AppSidebar
            activeWorkspaceId={activeWorkspaceId}
            activeThreadId={activeThreadId}
            onActivateWorkspace={activateWorkspace}
            onCreateThread={createThread}
            onImportWorkspace={importWorkspace}
            onRemoveWorkspace={removeWorkspace}
            onSelectThread={selectThread}
            onRenameThread={renameThread}
            theme={theme}
            threads={threads}
            workspaces={workspaces}
            workspace={workspace}
            runStatus={runStatus}
          />

          <div className="relative flex min-w-0 flex-1">
            <Outlet />
            <RepoHealthCard health={workspace?.health ?? null} />
            <ChangeImpactPanel workspaceId={activeWorkspaceId} />
          </div>
        </div>
      </main>
    </SidebarProvider>
  );
}

function ChangeImpactPanel({
  workspaceId,
}: {
  workspaceId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [impactedFiles, setImpactedFiles] = useState<RepoGraphImpactedFile[]>([]);
  const [tests, setTests] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGitStatus(null);
    setImpactedFiles([]);
    setTests([]);
    setError(null);
  }, [workspaceId]);

  const analyzeImpact = useCallback(async () => {
    if (!workspaceId) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const status = await window.mate.git.getStatus();
      const changedFiles = getChangedFiles(status);
      await window.mate.repo.graph.refresh();
      const [impact, testLists] = await Promise.all([
        changedFiles.length > 0
          ? window.mate.repo.graph.getImpactedFiles(changedFiles)
          : Promise.resolve([]),
        Promise.all(
          changedFiles.map((file) => window.mate.repo.graph.getTestsForFile(file)),
        ),
      ]);
      setGitStatus(status);
      setImpactedFiles(impact);
      setTests([...new Set(testLists.flat())].slice(0, 8));
    } catch (graphError) {
      setError((graphError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    const openPanel = () => {
      setOpen(true);
      void analyzeImpact();
    };

    window.addEventListener("mate:open-impact-panel", openPanel);
    return () => window.removeEventListener("mate:open-impact-panel", openPanel);
  }, [analyzeImpact]);

  if (!workspaceId) {
    return null;
  }

  const changedFiles = gitStatus ? getChangedFiles(gitStatus) : [];
  const summary = summarizeImpact(changedFiles, impactedFiles);
  const riskTone =
    summary.risk === "High"
      ? "border-destructive/50 text-destructive"
      : summary.risk === "Medium"
        ? "border-amber-500/60 text-amber-600"
        : "border-emerald-500/60 text-emerald-600";

  if (!open) {
    return null;
  }

  return (
    <aside className="absolute right-4 bottom-4 z-30 w-[380px] max-w-[calc(100%-2rem)] rounded-lg border border-border bg-background/95 p-3 shadow-sm backdrop-blur">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheckIcon className="size-4 shrink-0 text-primary" />
          <h2 className="truncate font-semibold text-sm">Change Impact</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent disabled:opacity-50"
            disabled={loading}
            onClick={analyzeImpact}
          >
            <GitBranchIcon className="size-3.5" />
            Analyze
          </button>
          <button
            type="button"
            className="h-7 rounded-md border px-2 text-xs hover:bg-accent"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-[11px]">
        <ImpactMetric label="Changed" value={changedFiles.length} />
        <ImpactMetric label="Affected" value={summary.affectedCount} />
        <div className={`rounded border px-2 py-1 ${riskTone}`}>
          <dt>Risk</dt>
          <dd className="font-semibold">{summary.risk}</dd>
        </div>
      </dl>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div className="min-w-0">
          <p className="mb-1 text-muted-foreground text-[10px] uppercase tracking-[0.08em]">
            Changed Files
          </p>
          <ul className="space-y-1">
            {changedFiles.slice(0, 5).map((file) => (
              <li
                key={file}
                className="truncate rounded border bg-muted/30 px-1.5 py-0.5"
                title={file}
              >
                {file}
              </li>
            ))}
            {changedFiles.length === 0 ? (
              <li className="text-muted-foreground">Analyze git changes</li>
            ) : null}
          </ul>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-muted-foreground text-[10px] uppercase tracking-[0.08em]">
            Affected Surface
          </p>
          <p className="rounded border bg-muted/30 px-1.5 py-0.5">
            Services: {summary.serviceCount}
          </p>
          <p className="mt-1 rounded border bg-muted/30 px-1.5 py-0.5">
            Tool fan-out: {summary.toolFanoutCount}
          </p>
        </div>
      </div>

      <div className="mt-3 border-t pt-3">
        <p className="text-muted-foreground text-[10px] uppercase tracking-[0.08em]">
          Impacted Files
        </p>
        <ul className="mt-2 max-h-28 space-y-1 overflow-auto text-[11px]">
          {impactedFiles.slice(0, 8).map((entry) => (
            <li
              key={`${entry.file}:${entry.distance}`}
              className="flex gap-2 rounded border bg-muted/30 px-1.5 py-0.5"
              title={entry.reason}
            >
              <span className="shrink-0 text-muted-foreground">d{entry.distance}</span>
              <span className="min-w-0 flex-1 truncate">{entry.group ?? entry.file}</span>
              {entry.hiddenCount ? (
                <span className="shrink-0 text-muted-foreground">+{entry.hiddenCount}</span>
              ) : null}
            </li>
          ))}
          {impactedFiles.length === 0 ? (
            <li className="text-muted-foreground">No impact calculated yet</li>
          ) : null}
        </ul>
      </div>

      <div className="mt-3 border-t pt-3">
        <p className="text-muted-foreground text-[10px] uppercase tracking-[0.08em]">
          Suggested Tests
        </p>
        <ul className="mt-2 space-y-1 text-[11px]">
          {tests.map((test) => (
            <li
              key={test}
              className="truncate rounded border bg-muted/30 px-1.5 py-0.5"
              title={test}
            >
              {test}
            </li>
          ))}
          {tests.length === 0 ? (
            <li className="text-muted-foreground">No direct test mapping found</li>
          ) : null}
        </ul>
      </div>

      {error ? (
        <p className="mt-2 rounded border border-destructive/40 px-2 py-1 text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </aside>
  );
}

function ImpactMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-muted/30 px-2 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function getChangedFiles(status: GitStatus) {
  return [
    ...new Set([
      ...status.files.map((file) => file.path),
      ...status.modified,
      ...status.created,
      ...status.staged,
      ...status.renamed.map((file) => file.to),
    ]),
  ].filter(Boolean).sort();
}

function summarizeImpact(
  changedFiles: string[],
  impactedFiles: RepoGraphImpactedFile[],
) {
  const concreteImpacts = impactedFiles.filter((entry) => !entry.group);
  const serviceCount = concreteImpacts.filter((entry) =>
    entry.file.startsWith("src/electron/") && !entry.file.includes("/tools/"),
  ).length;
  const toolFanoutCount = impactedFiles.reduce(
    (total, entry) =>
      total +
      (entry.group === "tool ecosystem"
        ? (entry.hiddenCount ?? 1)
        : entry.file.includes("/tools/")
          ? 1
          : 0),
    0,
  );
  const affectedCount =
    concreteImpacts.length +
    impactedFiles.reduce((total, entry) => total + (entry.hiddenCount ?? 0), 0);
  const risk =
    affectedCount >= 20 || serviceCount >= 6 || toolFanoutCount >= 10
      ? "High"
      : affectedCount >= 6 || serviceCount >= 3
        ? "Medium"
        : changedFiles.length > 0
          ? "Low"
          : "None";

  return {
    affectedCount,
    serviceCount,
    toolFanoutCount,
    risk,
  };
}

function RepoHealthCard({
  health,
}: {
  health: WorkspaceHealthProfile | null;
}) {
  if (!health) {
    return null;
  }

  const fields = [
    ["Stack", health.stack.join(", ")],
    ["PM", health.packageManager],
    ["Test", health.testCommand],
    ["Lint", health.lintCommand],
    ["Build", health.buildCommand],
    ["Git", health.gitDirtyState],
    ["Deps", String(health.dependencyWarningCount)],
    ["Secrets", String(health.secretWarningCount)],
  ];

  return (
    <aside className="pointer-events-none absolute top-3 right-4 z-20 w-[320px] max-w-[calc(100%-2rem)] rounded-lg border border-border/80 bg-background/95 p-3 shadow-sm backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ActivityIcon className="size-4 shrink-0 text-primary" />
          <h2 className="truncate font-semibold text-sm">Repo Health</h2>
        </div>
        <span className="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {health.framework}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] leading-4">
        {fields.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate font-medium" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-2 border-t pt-2">
        <p className="text-muted-foreground text-[10px] uppercase tracking-[0.08em]">
          Next action
        </p>
        <p className="truncate font-medium text-xs" title={health.recommendedNextAction}>
          {health.recommendedNextAction}
        </p>
      </div>
    </aside>
  );
}
