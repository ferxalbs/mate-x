import { verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import { inflateRawSync } from "node:zlib";

import { canonicalJson, sha256Hex } from "../../features/compliance/attestation";
import type { MaTeXStorageAdapter } from "./adapter";
import type {
  EvidencePackAttestation,
  EvidencePackManifest,
  EvidencePackStoragePublishInput,
  PublishedEvidencePack,
} from "../../contracts/evidence-pack-storage.types";

const DEFAULT_PREFIX = "evidence-packs/";
const REQUIRED_FILES = [
  "evidence-pack.json",
  "attestation.intoto.json",
  "manifest.json",
  "compliance-report.pdf",
  "evidence-pack.zip",
] as const;

export class EvidencePackIntegrityError extends Error {
  readonly code = "EVIDENCE_PACK_INTEGRITY_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "EvidencePackIntegrityError";
  }
}

export class EvidencePackStorage {
  constructor(private readonly adapter: MaTeXStorageAdapter) {}

  async publish(input: EvidencePackStoragePublishInput): Promise<PublishedEvidencePack> {
    const uploadedAt = input.uploadedAt ?? new Date();
    const prefix = normalizePrefix(input.prefix ?? DEFAULT_PREFIX);
    const localFiles = await readRequiredFiles(input.evidencePackDirectory);
    const zipEntries = readZipEntries(localFiles["evidence-pack.zip"]);
    const manifest = parseManifest(localFiles["manifest.json"]);
    const attestation = parseAttestation(localFiles["attestation.intoto.json"]);

    verifyManifest(manifest, zipEntries, localFiles["evidence-pack.zip"]);
    verifyAttestation(attestation, input.publicKeyPem);

    const zipHash = sha256Hex(localFiles["evidence-pack.zip"]);
    const shortHash = zipHash.slice(0, 12);
    const uploadedAtIso = uploadedAt.toISOString();
    const remoteDirectory = posix.join(
      prefix,
      input.workspaceId,
      `${formatTimestamp(uploadedAt)}-${shortHash}`,
    );

    await this.adapter.uploadFile(posix.join(remoteDirectory, "evidence-pack.json"), localFiles["evidence-pack.json"]);
    await this.adapter.uploadFile(posix.join(remoteDirectory, "attestation.intoto.json"), localFiles["attestation.intoto.json"]);
    await this.adapter.uploadFile(posix.join(remoteDirectory, "manifest.json"), localFiles["manifest.json"]);
    await this.adapter.uploadFile(posix.join(remoteDirectory, "compliance-report.pdf"), localFiles["compliance-report.pdf"]);
    await this.adapter.uploadFile(posix.join(remoteDirectory, "evidence-pack.zip"), localFiles["evidence-pack.zip"]);

    return this.toPublishedPack({
      remoteDirectory,
      sha256: zipHash,
      uploadedAt: uploadedAtIso,
    });
  }

  async list(workspaceId: string, prefix = DEFAULT_PREFIX): Promise<PublishedEvidencePack[]> {
    const normalizedPrefix = posix.join(normalizePrefix(prefix), workspaceId);
    const files = await this.adapter.listFiles({ prefix: normalizedPrefix });
    const zipFiles = files
      .map((file) => file.key)
      .filter((key) => basename(key) === "evidence-pack.zip");

    const packs = await Promise.all(zipFiles.map(async (zipKey) => {
      const remoteDirectory = posix.dirname(zipKey);
      const zipBytes = await this.adapter.downloadFile(zipKey);
      return this.toPublishedPack({
        remoteDirectory,
        sha256: sha256Hex(toBuffer(zipBytes)),
        uploadedAt: uploadedAtFromDirectory(remoteDirectory),
      });
    }));

    return packs
      .filter((pack) => pack.sha256.length > 0)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  private toPublishedPack(input: {
    remoteDirectory: string;
    sha256: string;
    uploadedAt: string;
  }): PublishedEvidencePack {
    const storageUrl = `${this.adapter.backendType}://${input.remoteDirectory}`;
    return {
      storageUrl,
      sha256: input.sha256,
      uploadedAt: input.uploadedAt,
      backendType: this.adapter.backendType,
      verifyCommand: buildVerifyCommand(`${storageUrl}/evidence-pack.zip`, input.sha256),
    };
  }
}

async function readRequiredFiles(directory: string): Promise<Record<(typeof REQUIRED_FILES)[number], Buffer>> {
  const entries = await Promise.all(REQUIRED_FILES.map(async (fileName) => {
    const content = await readFile(join(directory, fileName));
    return [fileName, content] as const;
  }));
  return Object.fromEntries(entries) as Record<(typeof REQUIRED_FILES)[number], Buffer>;
}

function verifyManifest(
  manifest: EvidencePackManifest,
  zipEntries: Map<string, Buffer>,
  zipBuffer: Buffer,
) {
  for (const requiredFile of REQUIRED_FILES.filter((fileName) => fileName !== "evidence-pack.zip")) {
    if (!zipEntries.has(requiredFile)) {
      throw new EvidencePackIntegrityError(`Evidence Pack ZIP is missing ${requiredFile}.`);
    }
  }

  for (const [fileName, expectedHash] of Object.entries(manifest.files)) {
    const content = zipEntries.get(fileName);
    if (!content) {
      throw new EvidencePackIntegrityError(`Manifest references missing file ${fileName}.`);
    }
    const actualHash = sha256Hex(content);
    if (actualHash !== expectedHash) {
      throw new EvidencePackIntegrityError(`Manifest hash mismatch for ${fileName}.`);
    }
  }

  sha256Hex(zipBuffer);
}

function verifyAttestation(attestation: EvidencePackAttestation, publicKeyPem: string) {
  if (attestation.signature.algorithm !== "Ed25519") {
    throw new EvidencePackIntegrityError("Attestation signature algorithm must be Ed25519.");
  }
  const valid = verify(
    null,
    Buffer.from(canonicalJson(attestation.statement)),
    publicKeyPem,
    Buffer.from(attestation.signature.sig, "base64"),
  );
  if (!valid) {
    throw new EvidencePackIntegrityError("Attestation Ed25519 signature is invalid.");
  }
}

function parseManifest(buffer: Buffer): EvidencePackManifest {
  const value = parseJson(buffer, "manifest.json");
  if (!isRecord(value) || !isRecord(value.files)) {
    throw new EvidencePackIntegrityError("manifest.json must include a files object.");
  }
  const files: Record<string, string> = {};
  for (const [key, hash] of Object.entries(value.files)) {
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/i.test(hash)) {
      throw new EvidencePackIntegrityError(`manifest.json has an invalid SHA-256 hash for ${key}.`);
    }
    files[key] = hash.toLowerCase();
  }
  return {
    files,
    zipDigest: typeof value.zipDigest === "string" ? value.zipDigest.toLowerCase() : undefined,
  };
}

function parseAttestation(buffer: Buffer): EvidencePackAttestation {
  const value = parseJson(buffer, "attestation.intoto.json");
  if (!isRecord(value) || !isRecord(value.signature) || !("statement" in value)) {
    throw new EvidencePackIntegrityError("attestation.intoto.json has an invalid shape.");
  }
  if (
    typeof value.signature.keyid !== "string" ||
    typeof value.signature.sig !== "string" ||
    value.signature.algorithm !== "Ed25519"
  ) {
    throw new EvidencePackIntegrityError("attestation.intoto.json has an invalid signature.");
  }
  return value as unknown as EvidencePackAttestation;
}

function parseJson(buffer: Buffer, fileName: string): unknown {
  try {
    return JSON.parse(buffer.toString("utf8")) as unknown;
  } catch {
    throw new EvidencePackIntegrityError(`${fileName} is not valid JSON.`);
  }
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buffer.byteLength) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;

    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const dataStart = fileNameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.byteLength) {
      throw new EvidencePackIntegrityError("Evidence Pack ZIP has a truncated local file entry.");
    }

    const fileName = buffer.subarray(fileNameStart, fileNameEnd).toString("utf8");
    const compressed = buffer.subarray(dataStart, dataEnd);
    const content = method === 0
      ? Buffer.from(compressed)
      : method === 8
        ? inflateRawSync(compressed)
        : unsupportedCompression(fileName);
    entries.set(fileName, content);
    offset = dataEnd;
  }

  if (entries.size === 0) {
    throw new EvidencePackIntegrityError("Evidence Pack ZIP contains no readable entries.");
  }
  return entries;
}

function unsupportedCompression(fileName: string): never {
  throw new EvidencePackIntegrityError(`Evidence Pack ZIP uses unsupported compression for ${fileName}.`);
}

function buildVerifyCommand(zipUrl: string, sha256: string) {
  const quotedUrl = shellQuote(zipUrl);
  const quotedHash = shellQuote(sha256);
  return [
    "tmp=${TMPDIR:-/tmp}/matex-evidence-pack-$$",
    "mkdir -p \"$tmp\"",
    `curl -fsSL ${quotedUrl} -o "$tmp/evidence-pack.zip"`,
    "actual=$(openssl dgst -sha256 \"$tmp/evidence-pack.zip\")",
    "actual=${actual##* }",
    `test "$actual" = ${quotedHash}`,
  ].join(" && ");
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function normalizePrefix(prefix: string) {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function formatTimestamp(date: Date) {
  return date.toISOString().replace(/[-:.]/g, "").replace("T", "T");
}

function uploadedAtFromDirectory(remoteDirectory: string) {
  const folderName = basename(remoteDirectory);
  const timestamp = folderName.split("-")[0] ?? "";
  const match = /^(\d{8})T(\d{6})(\d{3})Z$/.exec(timestamp);
  if (!match) return new Date(0).toISOString();
  const [, date, time, millis] = match;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}.${millis}Z`;
}

function toBuffer(value: string | Uint8Array) {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
