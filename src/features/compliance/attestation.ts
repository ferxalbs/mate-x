import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, platform, release } from "node:os";
import { dirname, join, relative } from "node:path";

import type { EvidencePack } from "../../contracts/chat";
import type { AgentRunIdentity } from "./agentIdentity";

export const MATE_X_SLSA_PREDICATE_TYPE = "https://slsa.dev/provenance/v1";
export const MATE_X_BUILDER_ID = "mate-x-desktop-electron-42";
export const MATE_X_RAINY_API_VERSION = "3.5";

export interface AttestationSubject {
  name: string;
  digest: Record<"sha256", string>;
}

export interface MateXAgentRunStatement {
  _type: "https://in-toto.io/Statement/v1";
  subject: AttestationSubject[];
  predicateType: typeof MATE_X_SLSA_PREDICATE_TYPE;
  predicate: {
    builder: { id: typeof MATE_X_BUILDER_ID };
    recipe: {
      type: "agent-task";
      config: {
        taskId: string;
        verifiedScore: number | null;
        policyApplied: string;
      };
    };
    materials: AttestationSubject[];
    environment: {
      os: string;
      electronVersion: string;
      rainyApiVersion: typeof MATE_X_RAINY_API_VERSION;
    };
    invocation: {
      config: {
        userId: string;
        workspacePath: string;
      };
    };
    agentIdentity?: AgentRunIdentity;
    metadata: {
      buildStartedOn: string;
      buildFinishedOn: string;
    };
  };
}

export interface SignedMateXAttestation {
  statement: MateXAgentRunStatement;
  signature: {
    keyid: string;
    sig: string;
    algorithm: "Ed25519";
  };
}

export interface PrivacyScanGate {
  hasSecrets: boolean;
  reason?: string;
}

export interface GenerateEvidenceAttestationParams {
  evidencePack: EvidencePack;
  workspacePath: string;
  taskId: string;
  userId?: string;
  policyApplied?: string;
  electronVersion?: string;
  keyDirectory?: string;
  privacyScan?: (payload: string) => Promise<PrivacyScanGate>;
  agentIdentity?: AgentRunIdentity;
  now?: Date;
}

export interface GenerateEvidenceAttestationResult {
  evidencePack: EvidencePack;
  attestation?: SignedMateXAttestation;
}

interface LocalSigningKey {
  privateKeyPem: string;
  publicKeyPem: string;
  keyid: string;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForCanonicalJson(value)) ?? "null";
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hasSensitiveEvidenceSignal(evidencePack: EvidencePack) {
  const text = [
    ...(evidencePack.warnings ?? []),
    ...(evidencePack.unresolvedRisks ?? []),
    evidencePack.verdict.summary,
  ].join("\n");

  return /\b(privacy firewall|secret|credential|token|api[_ -]?key|password)\b/i.test(text);
}

export async function generateEvidenceAttestation(
  params: GenerateEvidenceAttestationParams,
): Promise<GenerateEvidenceAttestationResult> {
  const generatedAt = (params.now ?? new Date()).toISOString();
  const unsignedEvidencePack: EvidencePack = {
    ...params.evidencePack,
    attestation: undefined,
  };
  const evidencePayload = canonicalJson(unsignedEvidencePack);
  const privacyGate = params.privacyScan
    ? await params.privacyScan(evidencePayload)
    : { hasSecrets: hasSensitiveEvidenceSignal(unsignedEvidencePack) };

  if (privacyGate.hasSecrets) {
    return {
      evidencePack: withAttestationStatus(params.evidencePack, {
        status: "blocked",
        taskId: params.taskId,
        reason:
          privacyGate.reason ??
          "Privacy Firewall detected sensitive material in Evidence Pack payload.",
        generatedAt,
      }),
    };
  }

  try {
    const materials = await hashModifiedFiles(
      params.workspacePath,
      unsignedEvidencePack.filesModified ?? [],
    );
    const evidenceHash = sha256Hex(evidencePayload);
    const statement: MateXAgentRunStatement = {
      _type: "https://in-toto.io/Statement/v1",
      subject: [
        {
          name: "evidence-pack.json",
          digest: { sha256: evidenceHash },
        },
        ...materials,
      ],
      predicateType: MATE_X_SLSA_PREDICATE_TYPE,
      predicate: {
        builder: { id: MATE_X_BUILDER_ID },
        recipe: {
          type: "agent-task",
          config: {
            taskId: params.taskId,
            verifiedScore: unsignedEvidencePack.verifiedTaskScore?.score ?? null,
            policyApplied: params.policyApplied ?? "workspace-trust-contract",
          },
        },
        materials,
        environment: {
          os: `${platform()} ${release()}`,
          electronVersion: params.electronVersion ?? process.versions.electron ?? "unknown",
          rainyApiVersion: MATE_X_RAINY_API_VERSION,
        },
        invocation: {
          config: {
            userId: params.userId ?? "local-user",
            workspacePath: params.workspacePath,
          },
        },
        agentIdentity: params.agentIdentity ?? unsignedEvidencePack.agentIdentity,
        metadata: {
          buildStartedOn: unsignedEvidencePack.generatedAt,
          buildFinishedOn: generatedAt,
        },
      },
    };
    const signingKey = await loadOrCreateLocalSigningKey(params.keyDirectory);
    const signature = sign(null, Buffer.from(canonicalJson(statement)), signingKey.privateKeyPem);
    const attestation: SignedMateXAttestation = {
      statement,
      signature: {
        keyid: signingKey.keyid,
        sig: signature.toString("base64"),
        algorithm: "Ed25519",
      },
    };
    const evidenceDirectory = join(params.workspacePath, ".matex", "evidence", params.taskId);
    const evidencePackPath = join(evidenceDirectory, "evidence-pack.json");
    const attestationPath = join(evidenceDirectory, "attestation.intoto.json");

    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(evidencePackPath, `${canonicalJson(unsignedEvidencePack)}\n`, "utf8");
    await writeFile(attestationPath, `${canonicalJson(attestation)}\n`, "utf8");

    return {
      evidencePack: withAttestationStatus(params.evidencePack, {
        status: "signed",
        taskId: params.taskId,
        path: relative(params.workspacePath, attestationPath),
        statementDigest: sha256Hex(canonicalJson(statement)),
        keyId: signingKey.keyid,
        generatedAt,
      }),
      attestation,
    };
  } catch (error) {
    return {
      evidencePack: withAttestationStatus(params.evidencePack, {
        status: "failed",
        taskId: params.taskId,
        reason: error instanceof Error ? error.message : "Attestation generation failed.",
        generatedAt,
      }),
    };
  }
}

async function hashModifiedFiles(
  workspacePath: string,
  files: NonNullable<EvidencePack["filesModified"]>,
): Promise<AttestationSubject[]> {
  const subjects = await Promise.all(
    files
      .filter((file) => file.changeType !== "deleted")
      .map(async (file) => {
        const absolutePath = join(workspacePath, file.path);
        const fileStat = await stat(absolutePath).catch(() => null);
        if (!fileStat?.isFile()) return null;
        const payload = await readFile(absolutePath);
        return {
          name: file.path,
          digest: { sha256: sha256Hex(payload) },
        };
      }),
  );

  return subjects.filter((subject): subject is AttestationSubject => subject !== null);
}

async function loadOrCreateLocalSigningKey(keyDirectory = defaultKeyDirectory()): Promise<LocalSigningKey> {
  const privateKeyPath = join(keyDirectory, "mate-x-attestation-ed25519.pem");
  const publicKeyPath = join(keyDirectory, "mate-x-attestation-ed25519.pub.pem");
  const existingPrivateKey = await readFile(privateKeyPath, "utf8").catch(() => null);
  const existingPublicKey = await readFile(publicKeyPath, "utf8").catch(() => null);

  if (existingPrivateKey && existingPublicKey) {
    return {
      privateKeyPem: existingPrivateKey,
      publicKeyPem: existingPublicKey,
      keyid: `sha256:${sha256Hex(existingPublicKey)}`,
    };
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  await mkdir(dirname(privateKeyPath), { recursive: true });
  await writeFile(privateKeyPath, privateKey, { encoding: "utf8", mode: 0o600 });
  await writeFile(publicKeyPath, publicKey, { encoding: "utf8", mode: 0o644 });

  return {
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    keyid: `sha256:${sha256Hex(publicKey)}`,
  };
}

function defaultKeyDirectory() {
  return join(homedir(), ".matex", "keys");
}

function withAttestationStatus(
  evidencePack: EvidencePack,
  attestation: NonNullable<EvidencePack["attestation"]>,
): EvidencePack {
  return {
    ...evidencePack,
    attestation,
    warnings:
      attestation.status === "failed" || attestation.status === "blocked"
        ? [
            ...(evidencePack.warnings ?? []),
            `Compliance attestation ${attestation.status}: ${attestation.reason}`,
          ].slice(0, 6)
        : evidencePack.warnings,
  };
}

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortForCanonicalJson(entry)]),
  );
}
