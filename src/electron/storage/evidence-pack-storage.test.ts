import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "bun:test";

import { canonicalJson, sha256Hex } from "../../features/compliance/attestation";
import { MaTeXStorageAdapter } from "./adapter";
import { EvidencePackIntegrityError, EvidencePackStorage } from "./evidence-pack-storage";
import type { FilesSdkClient, StorageEvent } from "../../contracts/storage-adapter.types";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("EvidencePackStorage", () => {
  it("verifies and publishes a complete Evidence Pack through the storage adapter", async () => {
    const pack = await createPack();
    const memory = new MemoryFilesSdkClient();
    const storage = new EvidencePackStorage(adapter(memory));

    const published = await storage.publish({
      workspaceId: "workspace-1",
      evidencePackDirectory: pack.directory,
      publicKeyPem: pack.publicKeyPem,
      uploadedAt: new Date("2026-05-31T10:00:00.000Z"),
    });

    assert.equal(published.backendType, "local");
    assert.equal(published.sha256, pack.zipDigest);
    assert.match(published.storageUrl, /^local:\/\/evidence-packs\/workspace-1\/20260531T100000000Z-/);
    assert.match(published.verifyCommand, /curl -fsSL/);
    assert.equal(memory.uploads.size, 5);
  });

  it("blocks upload when manifest hashes do not match ZIP contents", async () => {
    const pack = await createPack({ corruptManifest: true });
    const memory = new MemoryFilesSdkClient();
    const storage = new EvidencePackStorage(adapter(memory));

    await assert.rejects(
      storage.publish({
        workspaceId: "workspace-1",
        evidencePackDirectory: pack.directory,
        publicKeyPem: pack.publicKeyPem,
      }),
      EvidencePackIntegrityError,
    );
    assert.equal(memory.uploads.size, 0);
  });

  it("blocks upload when the Ed25519 attestation signature is invalid", async () => {
    const pack = await createPack({ corruptSignature: true });
    const memory = new MemoryFilesSdkClient();
    const storage = new EvidencePackStorage(adapter(memory));

    await assert.rejects(
      storage.publish({
        workspaceId: "workspace-1",
        evidencePackDirectory: pack.directory,
        publicKeyPem: pack.publicKeyPem,
      }),
      EvidencePackIntegrityError,
    );
    assert.equal(memory.uploads.size, 0);
  });

  it("lists published packs newest first", async () => {
    const oldPack = await createPack();
    const newPack = await createPack();
    const memory = new MemoryFilesSdkClient();
    const storage = new EvidencePackStorage(adapter(memory));
    await storage.publish({
      workspaceId: "workspace-1",
      evidencePackDirectory: oldPack.directory,
      publicKeyPem: oldPack.publicKeyPem,
      uploadedAt: new Date("2026-05-30T10:00:00.000Z"),
    });
    await storage.publish({
      workspaceId: "workspace-1",
      evidencePackDirectory: newPack.directory,
      publicKeyPem: newPack.publicKeyPem,
      uploadedAt: new Date("2026-05-31T10:00:00.000Z"),
    });

    const packs = await storage.list("workspace-1");

    assert.equal(packs.length, 2);
    assert.equal(packs[0]?.uploadedAt, "2026-05-31T10:00:00.000Z");
    assert.equal(packs[1]?.uploadedAt, "2026-05-30T10:00:00.000Z");
  });

  it("uses adapter lifecycle events for every uploaded file", async () => {
    const pack = await createPack();
    const events: StorageEvent[] = [];
    const storage = new EvidencePackStorage(adapter(new MemoryFilesSdkClient(), events));

    await storage.publish({
      workspaceId: "workspace-1",
      evidencePackDirectory: pack.directory,
      publicKeyPem: pack.publicKeyPem,
    });

    assert.equal(events.filter((event) => event.operation === "upload" && event.status === "success").length, 5);
  });
});

function adapter(files: MemoryFilesSdkClient, events: StorageEvent[] = []) {
  return new MaTeXStorageAdapter({
    workspaceId: "workspace-1",
    backend: { backend: "local", bucket: "local" },
    files,
    privacySentinel: {
      scan: async () => ({ hasSecrets: false, categories: [] }),
    },
    evidenceRecorder: {
      appendStorageEvent: async (event) => {
        events.push(event);
      },
    },
    failureMemory: {
      recordFailure: async () => undefined,
    },
    approvalGate: {
      requireApproval: async () => undefined,
    },
    rateLimiter: {
      check: async () => true,
    },
    now: () => new Date("2026-05-31T10:00:00.000Z"),
  });
}

async function createPack(options: { corruptManifest?: boolean; corruptSignature?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "matex-evidence-storage-"));
  tempRoots.push(directory);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const evidencePack = Buffer.from('{"status":"complete"}\n', "utf8");
  const report = Buffer.from("%PDF-1.4\n", "utf8");
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: "evidence-pack.json", digest: { sha256: sha256Hex(evidencePack) } }],
  };
  const signature = sign(null, Buffer.from(canonicalJson(statement)), privateKey).toString("base64");
  const attestation = Buffer.from(`${canonicalJson({
    statement,
    signature: {
      keyid: "test-key",
      sig: options.corruptSignature ? Buffer.alloc(64).toString("base64") : signature,
      algorithm: "Ed25519",
    },
  })}\n`, "utf8");
  const manifestDraft = {
    files: {
      "evidence-pack.json": options.corruptManifest ? "0".repeat(64) : sha256Hex(evidencePack),
      "attestation.intoto.json": sha256Hex(attestation),
      "compliance-report.pdf": sha256Hex(report),
    },
  };
  const manifestWithoutZip = Buffer.from(`${canonicalJson(manifestDraft)}\n`, "utf8");
  const zipWithoutDigest = buildStoredZip({
    "evidence-pack.json": evidencePack,
    "attestation.intoto.json": attestation,
    "manifest.json": manifestWithoutZip,
    "compliance-report.pdf": report,
  });
  const manifest = Buffer.from(`${canonicalJson({
    ...manifestDraft,
    zipDigest: sha256Hex(zipWithoutDigest),
  })}\n`, "utf8");
  const zip = buildStoredZip({
    "evidence-pack.json": evidencePack,
    "attestation.intoto.json": attestation,
    "manifest.json": manifest,
    "compliance-report.pdf": report,
  });
  const zipDigest = sha256Hex(zip);
  const finalManifest = Buffer.from(`${canonicalJson({
    ...manifestDraft,
    zipDigest,
  })}\n`, "utf8");
  const finalZip = buildStoredZip({
    "evidence-pack.json": evidencePack,
    "attestation.intoto.json": attestation,
    "manifest.json": finalManifest,
    "compliance-report.pdf": report,
  });

  await writeFile(join(directory, "evidence-pack.json"), evidencePack);
  await writeFile(join(directory, "attestation.intoto.json"), attestation);
  await writeFile(join(directory, "manifest.json"), finalManifest);
  await writeFile(join(directory, "compliance-report.pdf"), report);
  await writeFile(join(directory, "evidence-pack.zip"), finalZip);

  return {
    directory,
    publicKeyPem,
    zipDigest: sha256Hex(finalZip),
  };
}

function buildStoredZip(entries: Record<string, Buffer>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.byteLength, 18);
    local.writeUInt32LE(content.byteLength, 22);
    local.writeUInt16LE(nameBuffer.byteLength, 26);
    localParts.push(local, nameBuffer, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.byteLength, 20);
    central.writeUInt32LE(content.byteLength, 24);
    central.writeUInt16LE(nameBuffer.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.byteLength + nameBuffer.byteLength + content.byteLength;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
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

class MemoryFilesSdkClient implements FilesSdkClient {
  readonly uploads = new Map<string, Buffer>();

  async upload(key: string, body: string | Uint8Array | ArrayBuffer | Blob): Promise<{ url: string }> {
    this.uploads.set(key, Buffer.from(body instanceof ArrayBuffer ? new Uint8Array(body) : body as Uint8Array));
    return { url: `local://${key}` };
  }

  async download(key: string): Promise<Uint8Array> {
    const value = this.uploads.get(key);
    if (!value) throw new Error(`missing ${key}`);
    return value;
  }

  async delete(): Promise<void> {}

  async list(options?: Record<string, unknown>): Promise<Array<{ key: string; size: number }>> {
    const prefix = typeof options?.prefix === "string" ? options.prefix : "";
    return Array.from(this.uploads.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, size: value.byteLength }));
  }
}
