import { verify } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { EvidencePack } from "../../contracts/chat";
import {
  canonicalJson,
  generateEvidenceAttestation,
  hasSensitiveEvidenceSignal,
  MATE_X_BUILDER_ID,
  MATE_X_RAINY_API_VERSION,
  MATE_X_SLSA_PREDICATE_TYPE,
  sha256Hex,
} from "./attestation";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("compliance attestation", () => {
  it("canonicalizes JSON with stable key ordering", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  });

  it("hashes values with sha256 hex", () => {
    assert.equal(
      sha256Hex("mate-x"),
      "d4b740610a03c36f2ba94916cb9f1de0d8712c7517b0ceadc66fd2d91e9524ec",
    );
  });

  it("detects secret-like evidence before signing fallback", () => {
    assert.equal(
      hasSensitiveEvidenceSignal(evidencePack({ warnings: ["Privacy Firewall detected secret"] })),
      true,
    );
  });

  it("signs SLSA provenance for an evidence pack", async () => {
    const workspacePath = await workspace();
    await writeFile(join(workspacePath, "src.ts"), "export const ok = true;\n", "utf8");

    const result = await generateEvidenceAttestation({
      evidencePack: evidencePack({ filesModified: [{ path: "src.ts", changeType: "modified" }] }),
      workspacePath,
      taskId: "task-1",
      userId: "user-1",
      keyDirectory: join(workspacePath, "keys"),
      privacyScan: async () => ({ hasSecrets: false }),
      now: new Date("2026-05-10T10:00:00.000Z"),
    });

    assert.equal(result.evidencePack.attestation?.status, "signed");
    assert.equal(result.attestation?.statement.predicateType, MATE_X_SLSA_PREDICATE_TYPE);
    assert.equal(result.attestation?.statement.predicate.builder.id, MATE_X_BUILDER_ID);
    assert.equal(result.attestation?.statement.predicate.environment.rainyApiVersion, MATE_X_RAINY_API_VERSION);
    assert.equal(result.attestation?.statement.predicate.recipe.config.verifiedScore, 91);
  });

  it("writes evidence and intoto files under task evidence directory", async () => {
    const workspacePath = await workspace();
    await writeFile(join(workspacePath, "src.ts"), "export const ok = true;\n", "utf8");

    const result = await generateEvidenceAttestation({
      evidencePack: evidencePack({ filesModified: [{ path: "src.ts", changeType: "modified" }] }),
      workspacePath,
      taskId: "task-2",
      keyDirectory: join(workspacePath, "keys"),
      privacyScan: async () => ({ hasSecrets: false }),
    });

    const attestation = await readFile(join(workspacePath, result.evidencePack.attestation?.path ?? ""), "utf8");
    const evidence = await readFile(join(workspacePath, ".matex", "evidence", "task-2", "evidence-pack.json"), "utf8");
    assert.match(attestation, /"predicateType":"https:\/\/slsa\.dev\/provenance\/v1"/);
    assert.match(evidence, /"verifiedTaskScore"/);
  });

  it("creates verifiable Ed25519 signatures with local key material", async () => {
    const workspacePath = await workspace();
    const keyDirectory = join(workspacePath, "keys");
    await writeFile(join(workspacePath, "src.ts"), "export const ok = true;\n", "utf8");

    const result = await generateEvidenceAttestation({
      evidencePack: evidencePack({ filesModified: [{ path: "src.ts", changeType: "modified" }] }),
      workspacePath,
      taskId: "task-3",
      keyDirectory,
      privacyScan: async () => ({ hasSecrets: false }),
    });

    assert.ok(result.attestation);
    const publicKey = await readFile(join(keyDirectory, "mate-x-attestation-ed25519.pub.pem"), "utf8");
    assert.equal(
      verify(
        null,
        Buffer.from(canonicalJson(result.attestation.statement)),
        publicKey,
        Buffer.from(result.attestation.signature.sig, "base64"),
      ),
      true,
    );
  });

  it("blocks signing when Privacy Firewall gate reports secrets", async () => {
    const workspacePath = await workspace();
    const result = await generateEvidenceAttestation({
      evidencePack: evidencePack({ warnings: ["Privacy Firewall found repo_secret"] }),
      workspacePath,
      taskId: "task-4",
      keyDirectory: join(workspacePath, "keys"),
      privacyScan: async () => ({ hasSecrets: true, reason: "secret detected" }),
    });

    assert.equal(result.evidencePack.attestation?.status, "blocked");
    assert.equal(result.attestation, undefined);
    assert.match(result.evidencePack.warnings?.join("\n") ?? "", /secret detected/);
  });

  it("marks attestation failed when key directory is unavailable", async () => {
    const workspacePath = await workspace();
    const keyFile = join(workspacePath, "not-a-directory");
    await writeFile(keyFile, "occupied", "utf8");

    const result = await generateEvidenceAttestation({
      evidencePack: evidencePack(),
      workspacePath,
      taskId: "task-5",
      keyDirectory: keyFile,
      privacyScan: async () => ({ hasSecrets: false }),
    });

    assert.equal(result.evidencePack.attestation?.status, "failed");
  });

  it("still signs failed sandbox evidence when no secret is present", async () => {
    const workspacePath = await workspace();
    const result = await generateEvidenceAttestation({
      evidencePack: evidencePack({
        status: "partial",
        commandsExecuted: [{ command: 'sandbox_run {"command":"bun test"}', exitCode: 1 }],
        warnings: ["sandbox_run exited 1"],
      }),
      workspacePath,
      taskId: "task-6",
      keyDirectory: join(workspacePath, "keys"),
      privacyScan: async () => ({ hasSecrets: false }),
    });

    assert.equal(result.evidencePack.attestation?.status, "signed");
  });

  it("handles large modified file sets without missing material hashes", async () => {
    const workspacePath = await workspace();
    const filesModified = [];
    for (let index = 0; index < 120; index += 1) {
      const path = `file-${index}.ts`;
      filesModified.push({ path, changeType: "modified" as const });
      await writeFile(join(workspacePath, path), `export const value${index} = ${index};\n`, "utf8");
    }

    const result = await generateEvidenceAttestation({
      evidencePack: evidencePack({ filesModified }),
      workspacePath,
      taskId: "task-7",
      keyDirectory: join(workspacePath, "keys"),
      privacyScan: async () => ({ hasSecrets: false }),
    });

    assert.equal(result.attestation?.statement.predicate.materials.length, 120);
  });
});

function evidencePack(overrides: Partial<EvidencePack> = {}): EvidencePack {
  return {
    status: "complete",
    verdict: {
      label: "Completed",
      summary: "Run completed.",
      confidence: "high",
    },
    verifiedTaskScore: {
      score: 91,
      status: "verified",
      missingEvidence: [],
      signals: [],
      generatedAt: "2026-05-10T09:00:00.000Z",
    },
    generatedAt: "2026-05-10T09:00:00.000Z",
    ...overrides,
  };
}

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "mate-x-attestation-"));
  tempRoots.push(root);
  return root;
}
