import type { StorageBackendType } from "./storage-adapter.types";

export interface EvidencePackStoragePublishInput {
  workspaceId: string;
  evidencePackDirectory: string;
  publicKeyPem: string;
  prefix?: string;
  uploadedAt?: Date;
}

export interface PublishedEvidencePack {
  storageUrl: string;
  sha256: string;
  uploadedAt: string;
  backendType: StorageBackendType;
  verifyCommand: string;
}

export interface EvidencePackManifest {
  zipDigest?: string;
  files: Record<string, string>;
}

export interface EvidencePackAttestation {
  statement: unknown;
  signature: {
    keyid: string;
    sig: string;
    algorithm: "Ed25519";
  };
}
