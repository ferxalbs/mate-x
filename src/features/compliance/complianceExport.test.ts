import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { EvidencePack } from "../../contracts/chat";
import { generateEvidenceAttestation } from "./attestation";
import {
  buildAuditLog,
  buildComplianceReportPdf,
  buildPolicyAppliedMarkdown,
  buildZip,
  generateComplianceExport,
  packageDisplayName,
  sanitizeComplianceTaskId,
} from "./complianceExport";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("compliance export unit", () => {
  it("builds audit log with SOC 2 and AI governance controls", () => {
    const log = buildAuditLog({ evidencePack: evidencePack(), workspacePath: "/repo" }, "2026-05-10T10:00:00.000Z");
    assert.equal(log.schema, "mate-x.siem.audit-log.v1");
    assert.deepEqual(log.controls.map((control) => control.id), ["CC6.1", "PI1.2", "AI-GOVERNANCE"]);
  });

  it("builds policy markdown with procurement controls", () => {
    const markdown = buildPolicyAppliedMarkdown(
      { evidencePack: evidencePack(), workspacePath: "/repo", policyApplied: "policy-a" },
      "2026-05-10T10:00:00.000Z",
    );
    assert.match(markdown, /SOC 2 CC6\.1/);
    assert.match(markdown, /Policy: policy-a/);
  });

  it("builds a PDF buffer with expected header", () => {
    const pdf = buildComplianceReportPdf(evidencePack(), "2026-05-10T10:00:00.000Z");
    assert.equal(pdf.subarray(0, 8).toString("utf8"), "%PDF-1.4");
    assert.match(pdf.toString("utf8"), /MaTE X Compliance Report/);
  });

  it("builds a ZIP containing all local headers", () => {
    const zip = buildZip([
      { path: "evidence-pack.json", content: Buffer.from("{}"), date: new Date("2026-05-11T00:01:02.000Z") },
      { path: "manifest.json", content: Buffer.from("{}"), date: new Date("2026-05-11T00:01:02.000Z") },
    ]);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.notEqual(zip.readUInt16LE(10), 0);
    assert.notEqual(zip.readUInt16LE(12), 0);
    assert.match(zip.toString("latin1"), /evidence-pack\.json/);
    assert.match(zip.toString("latin1"), /manifest\.json/);
  });

  it("exports fixed package structure and manifest hashes", async () => {
    const workspacePath = await workspace();
    await mkdir(join(workspacePath, ".mate-x", "evidence", "task-1"), { recursive: true });
    await writeFile(join(workspacePath, ".mate-x", "evidence", "task-1", "attestation.intoto.json"), "{}");
    const result = await generateComplianceExport({
      evidencePack: evidencePack(),
      workspacePath,
      now: new Date("2026-05-10T10:00:00.000Z"),
    });
    const zip = await readFile(result.zipPath);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      status: string;
      files: Record<string, string>;
    };

    assert.equal(result.status, "ready");
    assert.equal(manifest.status, "ready");
    assert.match(zip.toString("latin1"), /compliance-report\.pdf/);
    assert.deepEqual(Object.keys(manifest.files), [
      "agent-runbook.json",
      "agent-runbook.md",
      "attestation.intoto.json",
      "audit-log.json",
      "compliance-report.pdf",
      "evidence-pack.json",
      "policy-applied.md",
    ]);
  });

  it("blocks procurement-ready export when signed attestation is missing", async () => {
    const workspacePath = await workspace();
    const result = await generateComplianceExport({
      evidencePack: evidencePack({ attestation: undefined }),
      workspacePath,
    });
    const zip = await readFile(result.zipPath);
    assert.equal(result.status, "blocked");
    assert.match(result.blockingReasons.join("\n"), /Signed attestation/);
    assert.match(zip.toString("latin1"), /Signed attestation missing/);
  });

  it("rejects unsafe compliance task ids", () => {
    assert.equal(sanitizeComplianceTaskId("task-2026.05.29_1"), "task-2026.05.29_1");
    assert.throws(() => sanitizeComplianceTaskId("../task-1"), /not safe/);
    assert.throws(() => sanitizeComplianceTaskId("task/1"), /not safe/);
  });

  it("delivers encrypted package to enabled native report sinks", async () => {
    const workspacePath = await workspace();
    await mkdir(join(workspacePath, ".mate-x", "evidence", "task-1"), { recursive: true });
    await writeFile(join(workspacePath, ".mate-x", "evidence", "task-1", "attestation.intoto.json"), "{}");
    let encryptedBytes = 0;
    const result = await generateComplianceExport({
      evidencePack: evidencePack(),
      workspacePath,
      autoReportSinks: [
        {
          name: "slack",
          enabled: true,
          sendEncryptedZip: async (payload) => {
            encryptedBytes = payload.ciphertext.byteLength;
            assert.ok(payload.iv);
            assert.ok(payload.authTag);
          },
        },
      ],
    });

    assert.deepEqual(result.deliveredTo, ["slack"]);
    assert.ok(encryptedBytes > 0);
  });

  it("formats package display name from export result", () => {
    assert.equal(
      packageDisplayName({ fileName: "mate-x-compliance-task-1.zip", zipPath: "/tmp/x.zip" }),
      "mate-x-compliance-task-1.zip",
    );
  });
});

describe("compliance export e2e", () => {
  it("exports Feature 1 attestation into Feature 2 package", async () => {
    const workspacePath = await workspace();
    await writeFile(join(workspacePath, "src.ts"), "export const ok = true;\n", "utf8");
    const signed = await generateEvidenceAttestation({
      evidencePack: evidencePack({ filesModified: [{ path: "src.ts", changeType: "modified" }] }),
      workspacePath,
      taskId: "task-e2e-1",
      keyDirectory: join(workspacePath, "keys"),
      privacyScan: async () => ({ hasSecrets: false }),
    });

    const result = await generateComplianceExport({
      evidencePack: signed.evidencePack,
      workspacePath,
      now: new Date("2026-05-10T10:00:00.000Z"),
    });
    const zip = await readFile(result.zipPath);

    assert.match(zip.toString("latin1"), /attestation\.intoto\.json/);
    assert.match(zip.toString("latin1"), /agent-runbook\.json/);
    assert.match(zip.toString("latin1"), /https:\/\/slsa\.dev\/provenance\/v1/);
  });

  it("exports SIEM audit evidence for failed sandbox runs", async () => {
    const workspacePath = await workspace();
    const result = await generateComplianceExport({
      evidencePack: evidencePack({
        status: "partial",
        commandsExecuted: [{ command: 'sandbox_run {"command":"bun test"}', exitCode: 1 }],
        unresolvedRisks: ["Validation failed before procurement package generation."],
      }),
      workspacePath,
    });
    const zip = await readFile(result.zipPath);

    assert.match(zip.toString("latin1"), /compliance\.package\.generated/);
    assert.match(zip.toString("latin1"), /sandbox_run/);
  });
});

function evidencePack(overrides: Partial<EvidencePack> = {}): EvidencePack {
  return {
    status: "complete",
    verdict: {
      label: "Completed",
      summary: "Run completed with procurement-ready evidence.",
      confidence: "high",
    },
    verifiedTaskScore: {
      score: 92,
      status: "verified",
      missingEvidence: [],
      signals: [],
      generatedAt: "2026-05-10T09:00:00.000Z",
    },
    attestation: {
      status: "signed",
      taskId: "task-1",
      path: ".mate-x/evidence/task-1/attestation.intoto.json",
      statementDigest: "sha256:abc",
      keyId: "sha256:key",
      generatedAt: "2026-05-10T09:00:01.000Z",
    },
    commandsExecuted: [{ command: 'sandbox_run {"command":"bun test"}', exitCode: 0 }],
    filesModified: [{ path: "src.ts", changeType: "modified" }],
    generatedAt: "2026-05-10T09:00:00.000Z",
    ...overrides,
  };
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "mate-x-compliance-export-"));
  tempRoots.push(root);
  return root;
}
