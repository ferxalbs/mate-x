import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { EvidencePack } from "../../contracts/chat";
import { canonicalJson, sha256Hex } from "./attestation";

export interface AgentRunIdentity {
  id: string;
  createdAt: string;
  boundToUser: boolean;
  policyHash: string;
}

export interface AgentRunbook {
  schema: "mate-x.agent-runbook.v1";
  generatedAt: string;
  agentIdentity: AgentRunIdentity;
  taskId: string;
  policyApplied: string;
  approvals: AgentRunbookApproval[];
  traceability: {
    status: EvidencePack["status"];
    verdict: EvidencePack["verdict"];
    verifiedTaskScore: EvidencePack["verifiedTaskScore"] | null;
    attestationPath: string | null;
    filesModified: NonNullable<EvidencePack["filesModified"]>;
    commandsExecuted: NonNullable<EvidencePack["commandsExecuted"]>;
    toolsUsed: NonNullable<EvidencePack["toolsUsed"]>;
    unresolvedRisks: NonNullable<EvidencePack["unresolvedRisks"]>;
  };
}

export interface AgentRunbookApproval {
  id: string;
  at: string;
  decision: "approved" | "blocked" | "not_required" | "unknown";
  summary: string;
}

export interface ResolveAgentIdentityParams {
  workspacePath: string;
  policySources?: Array<{ path: string; content: string }>;
  now?: Date;
}

export async function resolveAgentRunIdentity(
  params: ResolveAgentIdentityParams,
): Promise<AgentRunIdentity> {
  const identityPath = agentIdentityPath(params.workspacePath);
  const existing = await readIdentity(identityPath);
  const policyHash = hashPolicySources(params.policySources ?? []);

  if (existing) {
    const updated = { ...existing, policyHash };
    if (updated.policyHash !== existing.policyHash) {
      await writeIdentity(identityPath, updated);
    }
    return updated;
  }

  const identity: AgentRunIdentity = {
    id: randomUUID(),
    createdAt: (params.now ?? new Date()).toISOString(),
    boundToUser: false,
    policyHash,
  };
  await writeIdentity(identityPath, identity);
  return identity;
}

export function attachAgentIdentity(
  evidencePack: EvidencePack,
  agentIdentity: AgentRunIdentity,
): EvidencePack {
  return {
    ...evidencePack,
    agentIdentity,
  };
}

export function hashPolicySources(sources: Array<{ path: string; content: string }>) {
  return `sha256:${sha256Hex(
    canonicalJson(
      sources
        .map((source) => ({ path: source.path, sha256: sha256Hex(source.content) }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    ),
  )}`;
}

export function buildAgentRunbook(params: {
  evidencePack: EvidencePack;
  agentIdentity: AgentRunIdentity;
  policyApplied?: string;
  approvals?: AgentRunbookApproval[];
  generatedAt: string;
}): AgentRunbook {
  return {
    schema: "mate-x.agent-runbook.v1",
    generatedAt: params.generatedAt,
    agentIdentity: params.agentIdentity,
    taskId: params.evidencePack.attestation?.taskId ?? "unknown",
    policyApplied: params.policyApplied ?? "workspace-trust-contract",
    approvals: params.approvals ?? [
      {
        id: "local-policy",
        at: params.generatedAt,
        decision: params.evidencePack.status === "blocked" ? "blocked" : "not_required",
        summary: "Local Workspace Trust Contract handled run without cloud identity binding.",
      },
    ],
    traceability: {
      status: params.evidencePack.status,
      verdict: params.evidencePack.verdict,
      verifiedTaskScore: params.evidencePack.verifiedTaskScore ?? null,
      attestationPath: params.evidencePack.attestation?.path ?? null,
      filesModified: params.evidencePack.filesModified ?? [],
      commandsExecuted: params.evidencePack.commandsExecuted ?? [],
      toolsUsed: params.evidencePack.toolsUsed ?? [],
      unresolvedRisks: params.evidencePack.unresolvedRisks ?? [],
    },
  };
}

export function renderAgentRunbookMarkdown(runbook: AgentRunbook) {
  const score = runbook.traceability.verifiedTaskScore?.score ?? "unknown";
  const files = runbook.traceability.filesModified.map((file) => `- ${file.path} (${file.changeType ?? "modified"})`);
  const commands = runbook.traceability.commandsExecuted.map((command) => `- ${command.command}`);
  const approvals = runbook.approvals.map(
    (approval) => `- ${approval.decision}: ${approval.summary} (${approval.at})`,
  );

  return [
    "# MaTE X Agent Runbook",
    "",
    `Generated: ${runbook.generatedAt}`,
    `Task: ${runbook.taskId}`,
    `Agent Identity: ${runbook.agentIdentity.id}`,
    `Identity Created: ${runbook.agentIdentity.createdAt}`,
    `Bound To User: ${String(runbook.agentIdentity.boundToUser)}`,
    `Policy Hash: ${runbook.agentIdentity.policyHash}`,
    `Policy Applied: ${runbook.policyApplied}`,
    `Verified Task Score: ${score}`,
    `Attestation: ${runbook.traceability.attestationPath ?? "missing"}`,
    "",
    "## Approvals",
    "",
    ...(approvals.length ? approvals : ["- unknown"]),
    "",
    "## Files Modified",
    "",
    ...(files.length ? files : ["- none"]),
    "",
    "## Commands Executed",
    "",
    ...(commands.length ? commands : ["- none"]),
    "",
    "## Verdict",
    "",
    `${runbook.traceability.verdict.label}: ${runbook.traceability.verdict.summary}`,
    "",
  ].join("\n");
}

function agentIdentityPath(workspacePath: string) {
  return join(workspacePath, ".matex", "config", "agent-identity.json");
}

async function readIdentity(path: string): Promise<AgentRunIdentity | null> {
  const payload = await readFile(path, "utf8").catch(() => null);
  if (!payload) return null;
  const parsed = JSON.parse(payload) as Partial<AgentRunIdentity>;
  if (!parsed.id || !parsed.createdAt || !parsed.policyHash) return null;
  return {
    id: parsed.id,
    createdAt: parsed.createdAt,
    boundToUser: parsed.boundToUser === true,
    policyHash: parsed.policyHash,
  };
}

async function writeIdentity(path: string, identity: AgentRunIdentity) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${canonicalJson(identity)}\n`, { encoding: "utf8", mode: 0o600 });
}
