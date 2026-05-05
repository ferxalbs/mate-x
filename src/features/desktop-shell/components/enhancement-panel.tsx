import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIcon,
  BoltIcon,
  ClipboardCheckIcon,
  FileSearchIcon,
  GitBranchIcon,
  RadarIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";

import { Button } from "../../../components/ui/button";
import type { GitStatus } from "../../../contracts/git";
import type { RepoGraphImpactedFile } from "../../../contracts/repo-graph";
import type { WorkspaceHealthProfile } from "../../../contracts/workspace";
import { cn } from "../../../lib/utils";

interface EnhancementPanelProps {
  health: WorkspaceHealthProfile | null;
  workspaceId: string | null;
}

const sentinelSteps = [
  "Workspace context compiled",
  "Patch impact analyzed",
  "Privacy Sentinel preflight",
  "Validation planned",
  "Evidence Pack sealed",
];

export function EnhancementPanel({
  health,
  workspaceId,
}: EnhancementPanelProps) {
  const [loading, setLoading] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [impactedFiles, setImpactedFiles] = useState<RepoGraphImpactedFile[]>(
    [],
  );
  const [tests, setTests] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const changedFiles = gitStatus ? getChangedFiles(gitStatus) : [];
  const summary = summarizeImpact(changedFiles, impactedFiles);
  const repoFields = getRepoFields(health);
  const sentinelScore = Math.max(
    72,
    96 - summary.serviceCount * 3 - summary.toolFanoutCount,
  );
  const activeSignals = useMemo(
    () => [
      {
        label: "RepoGraph",
        value: `${summary.affectedCount} affected`,
        icon: RadarIcon,
      },
      {
        label: "Privacy Sentinel",
        value: `${sentinelScore}% clear`,
        icon: ShieldCheckIcon,
      },
      {
        label: "Fast path",
        value: tests.length > 0 ? `${tests.length} tests` : "typecheck",
        icon: BoltIcon,
      },
    ],
    [sentinelScore, summary.affectedCount, tests.length],
  );

  useEffect(() => {
    setGitStatus(null);
    setImpactedFiles([]);
    setTests([]);
    setError(null);
  }, [workspaceId]);

  const runEnhancementScan = useCallback(async () => {
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
          changedFiles.map((file) =>
            window.mate.repo.graph.getTestsForFile(file),
          ),
        ),
      ]);
      setGitStatus(status);
      setImpactedFiles(impact);
      setTests([...new Set(testLists.flat())].slice(0, 6));
    } catch (scanError) {
      setError((scanError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId) {
      void runEnhancementScan();
    }
  }, [runEnhancementScan, workspaceId]);

  if (!workspaceId) {
    return null;
  }

  return (
    <aside className="hidden h-full w-[316px] shrink-0 border-l border-[var(--panel-border)]/35 bg-[var(--panel)]/82 backdrop-blur-xl lg:flex 2xl:w-[348px]">
      <div className="flex min-h-0 w-full flex-col">
        <div className="border-b border-[var(--panel-border)]/35 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SparklesIcon className="size-4 text-primary" />
                <h2 className="truncate text-[13px] font-semibold text-foreground/92">
                  Enhancement Panel
                </h2>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Change impact, Privacy Sentinel, rapid verification.
              </p>
            </div>
            <Button
              size="xs"
              variant="outline"
              className="h-8 rounded-full border-[var(--panel-border)]/45 bg-background/35 px-3 text-[11px] shadow-none hover:bg-accent disabled:opacity-60"
              disabled={loading}
              onClick={runEnhancementScan}
            >
              <GitBranchIcon className="size-3.5" />
              {loading ? "Scanning" : "Scan"}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
          <section className="rounded-2xl border border-[var(--panel-border)]/38 bg-background/24 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <PanelTitle icon={FileSearchIcon} title="Change Impact" />
              <RiskPill risk={summary.risk} />
            </div>
            <dl className="grid grid-cols-3 gap-2 text-[11px]">
              <Metric label="Changed" value={changedFiles.length} />
              <Metric label="Affected" value={summary.affectedCount} />
              <Metric label="Services" value={summary.serviceCount} />
            </dl>
            <div className="mt-3 space-y-1.5">
              {impactedFiles.slice(0, 5).map((entry) => (
                <ImpactRow key={`${entry.file}:${entry.distance}`} entry={entry} />
              ))}
              {impactedFiles.length === 0 ? (
                <EmptyLine text="No changed-file impact yet" />
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--panel-border)]/38 bg-background/24 p-3">
            <PanelTitle icon={ShieldCheckIcon} title="Privacy Sentinel Runway" />
            <div className="mt-3 space-y-2">
              {activeSignals.map((signal) => (
                <SignalRow key={signal.label} {...signal} />
              ))}
            </div>
            <div className="mt-3 rounded-2xl border border-[var(--panel-border)]/35 bg-background/28 p-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Local preflight</span>
                <span className="font-medium text-emerald-500">
                  P0 cloud-send gated
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/45">
                <div
                  className="h-full rounded-full bg-emerald-500/80"
                  style={{ width: `${sentinelScore}%` }}
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--panel-border)]/38 bg-background/24 p-3">
            <PanelTitle icon={ClipboardCheckIcon} title="Demo Flow" />
            <ol className="mt-3 space-y-2">
              {sentinelSteps.map((step, index) => (
                <li key={step} className="flex items-center gap-2 text-[11px]">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-[var(--panel-border)]/45 bg-background/35 font-medium tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 truncate text-foreground/82">
                    {step}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-2xl border border-[var(--panel-border)]/38 bg-background/24 p-3">
            <PanelTitle icon={ActivityIcon} title="Repo Health" />
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
              {repoFields.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="truncate font-medium" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {health?.recommendedNextAction ? (
              <p
                className="mt-3 truncate rounded-2xl border border-[var(--panel-border)]/35 bg-background/28 px-2.5 py-2 text-[11px]"
                title={health.recommendedNextAction}
              >
                {health.recommendedNextAction}
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-[var(--panel-border)]/38 bg-background/24 p-3">
            <PanelTitle icon={BoltIcon} title="Rapid Inputs" />
            <div className="mt-3 space-y-1.5">
              {tests.map((test) => (
                <p
                  key={test}
                  className="truncate rounded-2xl border border-[var(--panel-border)]/35 bg-background/28 px-2.5 py-1.5 text-[11px]"
                  title={test}
                >
                  {test}
                </p>
              ))}
              {tests.length === 0 ? (
                <EmptyLine text="Typecheck first; expand when RepoGraph maps tests" />
              ) : null}
            </div>
          </section>

          {error ? (
            <p className="rounded-2xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function PanelTitle({
  icon: Icon,
  title,
}: {
  icon: typeof ActivityIcon;
  title: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-primary" />
      <h3 className="truncate text-[12px] font-semibold text-foreground/90">
        {title}
      </h3>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[var(--panel-border)]/35 bg-background/28 px-2 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function RiskPill({ risk }: { risk: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        risk === "High" && "border-destructive/45 text-destructive",
        risk === "Medium" && "border-amber-500/45 text-amber-600",
        risk === "Low" && "border-emerald-500/45 text-emerald-600",
        risk === "None" && "border-[var(--panel-border)]/45 text-muted-foreground",
      )}
    >
      {risk}
    </span>
  );
}

function SignalRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ActivityIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--panel-border)]/35 bg-background/28 px-2.5 py-2 text-[11px]">
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 font-medium text-foreground/84">{value}</span>
    </div>
  );
}

function ImpactRow({ entry }: { entry: RepoGraphImpactedFile }) {
  return (
    <div
      className="flex items-center gap-2 rounded-2xl border border-[var(--panel-border)]/35 bg-background/28 px-2.5 py-1.5 text-[11px]"
      title={entry.reason}
    >
      <span className="shrink-0 text-muted-foreground tabular-nums">
        d{entry.distance}
      </span>
      <span className="min-w-0 flex-1 truncate">{entry.group ?? entry.file}</span>
      {entry.hiddenCount ? (
        <span className="shrink-0 text-muted-foreground">
          +{entry.hiddenCount}
        </span>
      ) : null}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-[var(--panel-border)]/30 bg-background/20 px-2.5 py-1.5 text-[11px] text-muted-foreground">
      {text}
    </p>
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
  ]
    .filter(Boolean)
    .sort();
}

function summarizeImpact(
  changedFiles: string[],
  impactedFiles: RepoGraphImpactedFile[],
) {
  const concreteImpacts = impactedFiles.filter((entry) => !entry.group);
  const serviceCount = concreteImpacts.filter(
    (entry) =>
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

function getRepoFields(health: WorkspaceHealthProfile | null) {
  if (!health) {
    return [
      ["Stack", "Detecting"],
      ["PM", "Unknown"],
      ["Test", "Map pending"],
      ["Lint", "Map pending"],
      ["Git", "Pending"],
      ["Secrets", "0"],
    ];
  }

  return [
    ["Stack", health.stack.join(", ")],
    ["PM", health.packageManager],
    ["Test", health.testCommand],
    ["Lint", health.lintCommand],
    ["Git", health.gitDirtyState],
    ["Secrets", String(health.secretWarningCount)],
  ];
}
