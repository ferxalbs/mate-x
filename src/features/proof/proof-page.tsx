import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangleIcon, CheckCircle2Icon, LockIcon, ShieldCheckIcon } from "lucide-react";

import {
  demoProofCapsule,
  generateProofCapsule,
  type ProofCapsule,
  type ProofChangedFile,
} from "../../../packages/proof-core/src";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { useChatStore } from "../../store/chat-store";
import { getProofEntitlementForWorkspace } from "./proof-entitlements";
import { createMateXGitHubIntegration } from "./proof-github-boundary";
import { serverProofStorageAdapter } from "./proof-storage";

export function ProofPage({ mode = "workspace" }: { mode?: "workspace" | "demo" | "detail" }) {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { capsuleId?: string };
  const workspace = useChatStore((state) => state.workspace);
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const repoFiles = useChatStore((state) => state.repoFiles);
  const entitlement = getProofEntitlementForWorkspace(activeWorkspaceId);
  const github = useMemo(() => createMateXGitHubIntegration(workspace), [workspace]);
  const [capsules, setCapsules] = useState<ProofCapsule[]>([]);
  const [selectedCapsule, setSelectedCapsule] = useState<ProofCapsule | null>(mode === "demo" ? demoProofCapsule : null);
  const [transcript, setTranscript] = useState("");
  const [ciOutput, setCiOutput] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId || mode === "demo") return;
    void serverProofStorageAdapter.listCapsules(activeWorkspaceId).then((result) => {
      if (result.ok) setCapsules(result.value);
    });
  }, [activeWorkspaceId, mode]);

  useEffect(() => {
    if (mode !== "detail" || !activeWorkspaceId || !params.capsuleId) return;
    void serverProofStorageAdapter.getCapsule(activeWorkspaceId, params.capsuleId).then((result) => {
      setSelectedCapsule(result.ok ? result.value : null);
      if (!result.ok) setMessage(result.message);
    });
  }, [activeWorkspaceId, mode, params.capsuleId]);

  const generate = async () => {
    setMessage(null);
    if (!entitlement.proofMode.enabled || !activeWorkspaceId || !workspace) {
      setMessage("Select MaTE X workspace before generating Proof Capsule.");
      return;
    }

    const repos = await github.listWorkspaceRepos(activeWorkspaceId);
    const repositoryId = repos.ok && repos.value[0] ? repos.value[0].id : workspace.id;
    const changedFiles: ProofChangedFile[] = repoFiles.slice(0, 40).map((path) => ({ path, status: "modified" }));
    const capsule = generateProofCapsule({
      sourceType: "manual",
      workspaceId: activeWorkspaceId,
      projectId: workspace.id,
      repositoryId,
      createdByUserId: "matex-local-user",
      visibility: entitlement.proofCapsules.private ? "private" : "workspace",
      planSnapshot: {
        planId: "alpha-local",
        proofModeEnabled: entitlement.proofMode.enabled,
        privateCapsules: entitlement.proofCapsules.private,
        monthlyLimit: entitlement.proofCapsules.monthlyLimit,
        githubChecksEnabled: entitlement.githubChecks.enabled,
      },
      sourceIntegration: {
        provider: "manual",
        mode: "matex-server",
        installationState: "not_configured",
      },
      privacyPreflightResult: { status: "passed", redactedCount: 0 },
      validationStatus: ciOutput ? "passed" : "missing_evidence",
      changedFiles,
      transcript,
      ciOutput,
      manualNotes: "Generated inside MaTE X workspace flow.",
    });
    const saved = await serverProofStorageAdapter.saveCapsule(capsule);
    if (!saved.ok) {
      setMessage(saved.message);
      return;
    }
    setCapsules((current) => [saved.value, ...current.filter((item) => item.id !== saved.value.id)]);
    void navigate({ to: "/proof/$capsuleId", params: { capsuleId: saved.value.id } });
  };

  const activeCapsule = selectedCapsule ?? capsules[0] ?? (mode === "demo" ? demoProofCapsule : null);

  return (
    <section className="flex h-full min-w-0 flex-1 overflow-auto bg-transparent px-6 py-6">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/65">
              MaTE X Proof
            </p>
            <h1 className="text-2xl font-semibold tracking-normal text-foreground">Proof Capsules</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void navigate({ to: "/proof/demo" })}>Demo</Button>
            <Button onClick={() => void navigate({ to: "/proof" })}>Workspace</Button>
          </div>
        </header>

        {mode === "demo" ? (
          <StatusPanel tone="info" text="Demo-only preview. No GitHub credentials. No production storage." />
        ) : null}
        {!activeWorkspaceId && mode !== "demo" ? (
          <StatusPanel tone="warn" text="Import or select workspace to use production Proof Mode." />
        ) : null}
        {message ? <StatusPanel tone="warn" text={message} /> : null}

        <div className="grid gap-5 lg:grid-cols-[390px_1fr]">
          <div className="rounded-[32px] border border-[var(--panel-border)]/45 bg-[var(--panel)]/92 p-5 backdrop-blur-xl">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheckIcon className="size-4 text-foreground/70" />
              <h2 className="text-sm font-semibold">Generate From Workspace</h2>
            </div>
            <div className="space-y-3 text-sm">
              <InfoRow label="Workspace" value={workspace?.name ?? "None selected"} />
              <InfoRow label="Repository" value={workspace?.path ?? "Connect through MaTE X workspace"} />
              <InfoRow label="Entitlement" value={entitlement.proofMode.enabled ? "Proof enabled" : "Proof disabled"} />
              <InfoRow label="GitHub App" value="Not configured" />
            </div>
            <label className="mt-5 block text-xs text-muted-foreground">
              Agent transcript
              <textarea
                className="mt-2 min-h-24 w-full resize-y rounded-[24px] border border-[var(--panel-border)]/45 bg-background/35 p-3 text-sm text-foreground outline-none"
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
              />
            </label>
            <label className="mt-3 block text-xs text-muted-foreground">
              CI or validation output
              <textarea
                className="mt-2 min-h-24 w-full resize-y rounded-[24px] border border-[var(--panel-border)]/45 bg-background/35 p-3 text-sm text-foreground outline-none"
                value={ciOutput}
                onChange={(event) => setCiOutput(event.target.value)}
              />
            </label>
            <Button className="mt-4 w-full" onClick={generate} disabled={mode === "demo"}>
              Generate Proof Capsule
            </Button>
          </div>

          <CapsulePanel capsule={activeCapsule} />
        </div>
      </div>
    </section>
  );
}

function CapsulePanel({ capsule }: { capsule: ProofCapsule | null }) {
  if (!capsule) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-[32px] border border-[var(--panel-border)]/45 bg-[var(--panel)]/70 p-6 text-sm text-muted-foreground">
        No Proof Capsule yet.
      </div>
    );
  }

  return (
    <article className="rounded-[32px] border border-[var(--panel-border)]/45 bg-[var(--panel)]/92 p-5 backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/65">{capsule.repositoryId}</p>
          <h2 className="mt-1 text-xl font-semibold">{capsule.prTitle ?? "Workspace Proof Capsule"}</h2>
        </div>
        <span className={cn("rounded-full px-3 py-1 text-xs font-medium", badgeClass(capsule.finalVerdict))}>
          {capsule.finalVerdict}
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Metric label="Risk" value={capsule.riskLevel} />
        <Metric label="Validation" value={capsule.validationStatus} />
        <Metric label="Redactions" value={String(capsule.privacyPreflightResult.redactedCount)} />
      </div>

      <section className="mt-5 space-y-3">
        <h3 className="text-sm font-semibold">Decision</h3>
        <p className="text-sm text-muted-foreground">{capsule.recommendedNextAction}</p>
        {capsule.missingEvidence.length > 0 ? (
          <ul className="space-y-2 text-sm text-muted-foreground">
            {capsule.missingEvidence.map((item) => <li key={item}>- {item}</li>)}
          </ul>
        ) : null}
      </section>

      <section className="mt-5">
        <h3 className="text-sm font-semibold">Risk Findings</h3>
        <div className="mt-3 space-y-2">
          {[...capsule.detectedSensitiveFiles, ...capsule.detectedRiskyPaths, ...capsule.detectedDependencyChanges, ...capsule.detectedWorkflowChanges].slice(0, 8).map((finding, index) => (
            <div key={`${finding.path ?? "repo"}-${index}`} className="rounded-2xl border border-[var(--panel-border)]/35 bg-background/25 p-3 text-sm">
              <div className="font-medium">{finding.reason}</div>
              <div className="mt-1 text-xs text-muted-foreground">{finding.path ?? "repository"} · {finding.severity}</div>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}

function StatusPanel({ tone, text }: { tone: "info" | "warn"; text: string }) {
  const Icon = tone === "warn" ? AlertTriangleIcon : LockIcon;
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-[var(--panel-border)]/45 bg-[var(--panel)]/80 px-4 py-3 text-sm text-muted-foreground">
      <Icon className="size-4" />
      <span>{text}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right text-foreground/85">{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--panel-border)]/35 bg-background/25 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2Icon className="size-4 text-foreground/70" />
        {value}
      </div>
    </div>
  );
}

function badgeClass(verdict: ProofCapsule["finalVerdict"]) {
  if (verdict === "passed") return "bg-emerald-500/15 text-emerald-500";
  if (verdict === "blocked" || verdict === "failed") return "bg-red-500/15 text-red-500";
  if (verdict === "risky") return "bg-amber-500/15 text-amber-500";
  return "bg-muted text-muted-foreground";
}
