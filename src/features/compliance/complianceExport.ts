import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { EvidencePack } from "../../contracts/chat";
import { canonicalJson, sha256Hex } from "./attestation";
import {
  buildAgentRunbook,
  renderAgentRunbookMarkdown,
  resolveAgentRunIdentity,
} from "./agentIdentity";

export interface ComplianceExportRequest {
  evidencePack: EvidencePack;
  workspacePath: string;
  userId?: string;
  policyApplied?: string;
  autoReportSinks?: ComplianceReportSink[];
  now?: Date;
}

export interface ComplianceExportResult {
  zipPath: string;
  manifestPath: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  generatedAt: string;
  deliveredTo: string[];
}

export interface ComplianceReportSink {
  name: "slack" | "whatsapp" | "linear" | "telegram";
  enabled: boolean;
  sendEncryptedZip?: (packageInfo: EncryptedCompliancePackage) => Promise<void>;
}

export interface EncryptedCompliancePackage {
  fileName: string;
  ciphertext: Buffer;
  iv: string;
  authTag: string;
  sha256: string;
}

interface ZipEntry {
  path: string;
  content: Buffer;
  date?: Date;
}

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

export async function generateComplianceExport(
  request: ComplianceExportRequest,
): Promise<ComplianceExportResult> {
  const generatedAt = (request.now ?? new Date()).toISOString();
  const taskId = request.evidencePack.attestation?.taskId ?? `task-${Date.now()}`;
  const evidenceDirectory = join(request.workspacePath, ".mate-x", "evidence", taskId);
  const fileName = `mate-x-compliance-${taskId}.zip`;
  const zipPath = join(evidenceDirectory, fileName);
  const manifestPath = join(evidenceDirectory, "manifest.json");

  await mkdir(evidenceDirectory, { recursive: true });

  const evidencePackJson = Buffer.from(`${canonicalJson(request.evidencePack)}\n`, "utf8");
  const attestationJson = await loadAttestation(request.workspacePath, request.evidencePack);
  const auditLogJson = Buffer.from(`${canonicalJson(buildAuditLog(request, generatedAt))}\n`, "utf8");
  const policyAppliedMd = Buffer.from(buildPolicyAppliedMarkdown(request, generatedAt), "utf8");
  const agentIdentity =
    request.evidencePack.agentIdentity ??
    (await resolveAgentRunIdentity({
      workspacePath: request.workspacePath,
      now: request.now,
    }));
  const agentRunbook = buildAgentRunbook({
    evidencePack: request.evidencePack,
    agentIdentity,
    policyApplied: request.policyApplied,
    generatedAt,
  });
  const agentRunbookJson = Buffer.from(`${canonicalJson(agentRunbook)}\n`, "utf8");
  const agentRunbookMd = Buffer.from(renderAgentRunbookMarkdown(agentRunbook), "utf8");
  const complianceReportPdf = buildComplianceReportPdf(request.evidencePack, generatedAt);

  const manifestDraft = {
    packageType: "mate-x/soc2-procurement-package",
    generatedAt,
    taskId,
    userId: request.userId ?? "local-user",
    workspacePath: request.workspacePath,
    agentIdentity,
    controls: ["SOC2_CC6.1", "SOC2_PI1.2", "AI_GOVERNANCE"],
    files: {
      "evidence-pack.json": sha256Hex(evidencePackJson),
      "attestation.intoto.json": sha256Hex(attestationJson),
      "compliance-report.pdf": sha256Hex(complianceReportPdf),
      "audit-log.json": sha256Hex(auditLogJson),
      "policy-applied.md": sha256Hex(policyAppliedMd),
      "agent-runbook.json": sha256Hex(agentRunbookJson),
      "agent-runbook.md": sha256Hex(agentRunbookMd),
    },
  };
  const manifestJson = Buffer.from(`${canonicalJson(manifestDraft)}\n`, "utf8");
  const zipDate = new Date(generatedAt);
  const entries: ZipEntry[] = [
    { path: "evidence-pack.json", content: evidencePackJson, date: zipDate },
    { path: "attestation.intoto.json", content: attestationJson, date: zipDate },
    { path: "compliance-report.pdf", content: complianceReportPdf, date: zipDate },
    { path: "audit-log.json", content: auditLogJson, date: zipDate },
    { path: "policy-applied.md", content: policyAppliedMd, date: zipDate },
    { path: "agent-runbook.json", content: agentRunbookJson, date: zipDate },
    { path: "agent-runbook.md", content: agentRunbookMd, date: zipDate },
    { path: "manifest.json", content: manifestJson, date: zipDate },
  ];
  const zipBuffer = buildZip(entries);
  await writeFile(manifestPath, manifestJson);
  await writeFile(zipPath, zipBuffer);

  const deliveredTo = await deliverEncryptedPackage(
    {
      fileName,
      ciphertext: zipBuffer,
      iv: "",
      authTag: "",
      sha256: sha256Hex(zipBuffer),
    },
    request.autoReportSinks ?? [],
  );

  return {
    zipPath,
    manifestPath,
    fileName,
    sizeBytes: zipBuffer.byteLength,
    sha256: sha256Hex(zipBuffer),
    generatedAt,
    deliveredTo,
  };
}

export function buildAuditLog(request: ComplianceExportRequest, generatedAt: string) {
  const evidencePack = request.evidencePack;
  return {
    schema: "mate-x.siem.audit-log.v1",
    generatedAt,
    event: {
      action: "compliance.package.generated",
      outcome: evidencePack.attestation?.status === "signed" ? "success" : "warning",
      taskId: evidencePack.attestation?.taskId ?? "unknown",
      userId: request.userId ?? "local-user",
      workspacePath: request.workspacePath,
      verifiedTaskScore: evidencePack.verifiedTaskScore?.score ?? null,
      attestationStatus: evidencePack.attestation?.status ?? "missing",
      agentIdentity: evidencePack.agentIdentity ?? null,
    },
    controls: [
      {
        id: "CC6.1",
        name: "Logical access and audit accountability",
        evidence: "commandsExecuted, toolsUsed, signed attestation, append-only package manifest",
      },
      {
        id: "PI1.2",
        name: "Processing integrity",
        evidence: "Verified Task Score, file hashes, in-toto/SLSA provenance",
      },
      {
        id: "AI-GOVERNANCE",
        name: "Agentic action traceability",
        evidence: "Evidence Pack verdict, policy-applied.md, local-first signature chain",
      },
    ],
    commands: evidencePack.commandsExecuted ?? [],
    filesModified: evidencePack.filesModified ?? [],
    unresolvedRisks: evidencePack.unresolvedRisks ?? [],
  };
}

export function buildPolicyAppliedMarkdown(request: ComplianceExportRequest, generatedAt: string) {
  const score = request.evidencePack.verifiedTaskScore?.score ?? "unknown";
  const attestation = request.evidencePack.attestation;

  return [
    "# MaTE X Policy Applied",
    "",
    `Generated: ${generatedAt}`,
    `Policy: ${request.policyApplied ?? "workspace-trust-contract"}`,
    `Task: ${attestation?.taskId ?? "unknown"}`,
    `Verified Task Score: ${score}`,
    "",
    "## Controls",
    "",
    "- SOC 2 CC6.1: command, tool, and Evidence Pack audit evidence preserved.",
    "- SOC 2 PI1.2: file digests and Verified Task Score preserve processing-integrity evidence.",
    "- AI Governance: agent run output is bound to in-toto/SLSA provenance when attestation is signed.",
    "- Agent Identity: persistent local identity and policy hash bind the run to workspace policy.",
    "",
    "## Applied MaTE X Rules",
    "",
    "- Local-first export; no cloud upload required.",
    "- Privacy Firewall blocks signing before secret-bearing payloads are trusted.",
    "- Rainy API v3.5 orchestration remains required for managed agent runs.",
    "- Evidence Pack and attestation hashes included in manifest.json.",
    "- Agent Runbook exported as Markdown and JSON for procurement review.",
    "",
  ].join("\n");
}

export function buildComplianceReportPdf(evidencePack: EvidencePack, generatedAt: string): Buffer {
  const lines = [
    "MaTE X Compliance Report",
    `Generated: ${generatedAt}`,
    `Status: ${evidencePack.status}`,
    `Verdict: ${evidencePack.verdict.label}`,
    `Verified Task Score: ${evidencePack.verifiedTaskScore?.score ?? "unknown"}/100`,
    `Attestation: ${evidencePack.attestation?.status ?? "missing"}`,
    "",
    "Executive Summary",
    evidencePack.verdict.summary,
    "",
    "Risk Table",
    ...(evidencePack.unresolvedRisks?.length
      ? evidencePack.unresolvedRisks.map((risk, index) => `${index + 1}. ${risk}`)
      : ["No unresolved risks recorded."]),
    "",
    "SOC 2 Ready Controls",
    "CC6.1: Audit log and command evidence included.",
    "PI1.2: File hashes and Verified Task Score included.",
    "AI Governance: Agent action provenance included.",
    `Agent Identity: ${evidencePack.agentIdentity?.id ?? "unbound"}`,
  ];

  return createMinimalPdf(lines);
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const crc = crc32(entry.content);
    const local = Buffer.alloc(30);
    const dos = dosDateTime(entry.date ?? new Date());
    local.writeUInt32LE(ZIP_LOCAL_FILE_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dos.time, 10);
    local.writeUInt16LE(dos.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.content.byteLength, 18);
    local.writeUInt32LE(entry.content.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dos.time, 12);
    central.writeUInt16LE(dos.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.content.byteLength, 20);
    central.writeUInt32LE(entry.content.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.byteLength + name.byteLength + entry.content.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_EOCD_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function loadAttestation(workspacePath: string, evidencePack: EvidencePack) {
  const attestationPath = evidencePack.attestation?.path
    ? join(workspacePath, evidencePack.attestation.path)
    : null;
  if (!attestationPath) {
    return Buffer.from('{"status":"missing","reason":"No attestation attached to Evidence Pack."}\n', "utf8");
  }

  return readFile(attestationPath).catch(() =>
    Buffer.from(
      `${canonicalJson({
        status: "missing",
        expectedPath: evidencePack.attestation?.path,
        reason: "Attestation file could not be read.",
      })}\n`,
      "utf8",
    ),
  );
}

async function deliverEncryptedPackage(packageInfo: EncryptedCompliancePackage, sinks: ComplianceReportSink[]) {
  const deliveredTo: string[] = [];
  const enabledSinks = sinks.filter((sink) => sink.enabled && sink.sendEncryptedZip);
  if (enabledSinks.length === 0) return deliveredTo;

  const encrypted = encryptPackage(packageInfo);
  for (const sink of enabledSinks) {
    await sink.sendEncryptedZip?.(encrypted);
    deliveredTo.push(sink.name);
  }

  return deliveredTo;
}

function encryptPackage(packageInfo: EncryptedCompliancePackage): EncryptedCompliancePackage {
  const key = createHash("sha256").update("mate-x-local-compliance-export").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(packageInfo.ciphertext), cipher.final()]);

  return {
    ...packageInfo,
    ciphertext,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function createMinimalPdf(lines: string[]) {
  const escapedLines = lines.map((line) => escapePdfText(line).slice(0, 110));
  const text = escapedLines
    .map((line, index) => `BT /F1 10 Tf 50 ${760 - index * 16} Td (${line}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(chunks.join("")));
    chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  for (const offset of offsets.slice(1)) {
    chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.from(chunks.join(""), "utf8");
}

function escapePdfText(value: string) {
  return value.replace(/[\\()]/g, (match) => `\\${match}`).replace(/[^\x20-\x7E]/g, " ");
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

export function packageDisplayName(result: Pick<ComplianceExportResult, "zipPath" | "fileName">) {
  return basename(result.fileName || result.zipPath);
}
