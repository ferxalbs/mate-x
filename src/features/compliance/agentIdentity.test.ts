import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { EvidencePack } from "../../contracts/chat";
import {
  attachAgentIdentity,
  buildAgentRunbook,
  hashPolicySources,
  renderAgentRunbookMarkdown,
  resolveAgentRunIdentity,
} from "./agentIdentity";
import { generateEvidenceAttestation } from "./attestation";
import { generateComplianceExport } from "./complianceExport";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent run identity", () => {
  it("creates persistent local identity", async () => {
    const workspacePath = await workspace();
    const identity = await resolveAgentRunIdentity({
      workspacePath,
      policySources: [{ path: "AGENTS.md", content: "policy" }],
      now: new Date("2026-05-11T00:00:00.000Z"),
    });
    const saved = await readFile(join(workspacePath, ".matex", "config", "agent-identity.json"), "utf8");

    assert.match(identity.id, /^[0-9a-f-]{36}$/);
    assert.equal(identity.boundToUser, false);
    assert.match(saved, /policyHash/);
  });

  it("reuses identity id across runs", async () => {
    const workspacePath = await workspace();
    const first = await resolveAgentRunIdentity({ workspacePath });
    const second = await resolveAgentRunIdentity({ workspacePath });

    assert.equal(second.id, first.id);
    assert.equal(second.createdAt, first.createdAt);
  });

  it("updates policy hash without rotating identity", async () => {
    const workspacePath = await workspace();
    const first = await resolveAgentRunIdentity({
      workspacePath,
      policySources: [{ path: "AGENTS.md", content: "a" }],
    });
    const second = await resolveAgentRunIdentity({
      workspacePath,
      policySources: [{ path: "AGENTS.md", content: "b" }],
    });

    assert.equal(second.id, first.id);
    assert.notEqual(second.policyHash, first.policyHash);
  });

  it("hashes policy sources deterministically", () => {
    assert.equal(
      hashPolicySources([
        { path: "RULES.md", content: "rules" },
        { path: "AGENTS.md", content: "agents" },
      ]),
      hashPolicySources([
        { path: "AGENTS.md", content: "agents" },
        { path: "RULES.md", content: "rules" },
      ]),
    );
  });

  it("attaches identity to Evidence Pack", () => {
    const identity = identityFixture();
    const withIdentity = attachAgentIdentity(evidencePack(), identity);

    assert.deepEqual(withIdentity.agentIdentity, identity);
  });

  it("builds JSON runbook with traceability", () => {
    const runbook = buildAgentRunbook({
      evidencePack: evidencePack(),
      agentIdentity: identityFixture(),
      generatedAt: "2026-05-11T00:00:00.000Z",
    });

    assert.equal(runbook.schema, "mate-x.agent-runbook.v1");
    assert.equal(runbook.traceability.commandsExecuted.length, 1);
  });

  it("renders Markdown runbook for procurement review", () => {
    const markdown = renderAgentRunbookMarkdown(
      buildAgentRunbook({
        evidencePack: evidencePack(),
        agentIdentity: identityFixture(),
        generatedAt: "2026-05-11T00:00:00.000Z",
      }),
    );

    assert.match(markdown, /Agent Identity: agent-1/);
    assert.match(markdown, /Verified Task Score: 93/);
  });
});

describe("agent identity integration", () => {
  it("flows into signed attestation predicate", async () => {
    const workspacePath = await workspace();
    const identity = identityFixture();
    const result = await generateEvidenceAttestation({
      evidencePack: attachAgentIdentity(evidencePack(), identity),
      workspacePath,
      taskId: "task-agent-1",
      keyDirectory: join(workspacePath, "keys"),
      agentIdentity: identity,
      privacyScan: async () => ({ hasSecrets: false }),
    });

    assert.equal(result.attestation?.statement.predicate.agentIdentity?.id, identity.id);
  });

  it("flows into compliance ZIP manifest and runbook artifacts", async () => {
    const workspacePath = await workspace();
    const result = await generateComplianceExport({
      evidencePack: attachAgentIdentity(evidencePack(), identityFixture()),
      workspacePath,
      now: new Date("2026-05-11T00:00:00.000Z"),
    });
    const zip = await readFile(result.zipPath);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      agentIdentity: { id: string };
      files: Record<string, string>;
    };

    assert.equal(manifest.agentIdentity.id, "agent-1");
    assert.ok(manifest.files["agent-runbook.json"]);
    assert.match(zip.toString("latin1"), /agent-runbook\.md/);
  });
});

function identityFixture() {
  return {
    id: "agent-1",
    createdAt: "2026-05-11T00:00:00.000Z",
    boundToUser: false,
    policyHash: "sha256:policy",
  };
}

function evidencePack(overrides: Partial<EvidencePack> = {}): EvidencePack {
  return {
    status: "complete",
    verdict: {
      label: "Completed",
      summary: "Run completed with identity-bound evidence.",
      confidence: "high",
    },
    verifiedTaskScore: {
      score: 93,
      status: "verified",
      missingEvidence: [],
      signals: [],
      generatedAt: "2026-05-11T00:00:00.000Z",
    },
    attestation: {
      status: "signed",
      taskId: "task-1",
      path: ".matex/evidence/task-1/attestation.intoto.json",
      generatedAt: "2026-05-11T00:00:00.000Z",
    },
    commandsExecuted: [{ command: "sandbox_run", exitCode: 0 }],
    filesModified: [{ path: "src.ts", changeType: "modified" }],
    generatedAt: "2026-05-11T00:00:00.000Z",
    ...overrides,
  };
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "mate-x-agent-identity-"));
  tempRoots.push(root);
  return root;
}
