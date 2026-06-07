import { app } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const WORKSPACE_ID_RE = /^[A-Za-z0-9._:-]+$/;
const STORAGE_PREFIX_MAX = 256;
const PEM_PUBLIC_KEY_RE = /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/;
const EVIDENCE_PACK_DIR_RE = /(?:^|\/)\.mate-?x\/evidence\/[^/]+(?:\/|$)/;
const TEMP_EVIDENCE_PACK_RE = /(?:^|\/)matex-evidence-(?:storage-)?[^/]+(?:\/|$)/;

export function assertTrustedRendererSender(event: IpcMainInvokeEvent) {
  if (event.sender.isDestroyed()) {
    throw new Error('Untrusted IPC sender.');
  }

  const senderUrl = event.sender.getURL();
  if (senderUrl.startsWith('devtools://')) {
    throw new Error('Untrusted IPC sender.');
  }
}

export function parseWorkspaceId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || !WORKSPACE_ID_RE.test(trimmed)) {
    throw new Error('Invalid workspaceId.');
  }

  return trimmed;
}

export function parseStoragePrefix(value: string): string {
  const normalized = value.replaceAll('\\', '/').trim();
  if (normalized.length > STORAGE_PREFIX_MAX) {
    throw new Error('Storage prefix exceeds maximum length.');
  }

  if (
    normalized.includes('..') ||
    normalized.startsWith('/') ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.includes('\0')
  ) {
    throw new Error('Storage prefix must be a safe relative key prefix.');
  }

  return normalized;
}

export function parseFailureMemoryImportPath(value: string): string {
  const resolved = resolve(value);
  const tmpRoot = resolve(tmpdir());
  const userRoot = resolve(app.getPath('userData'));
  const inTmp = resolved === tmpRoot || resolved.startsWith(`${tmpRoot}${sep}`);
  const inUser = resolved === userRoot || resolved.startsWith(`${userRoot}${sep}`);

  if (!inTmp && !inUser) {
    throw new Error('Failure memory import path must stay within temp or app data.');
  }

  if (!resolved.toLowerCase().endsWith('.zip')) {
    throw new Error('Failure memory import path must be a .zip archive.');
  }

  return resolved;
}

export function parseEvidencePackDirectory(value: string): string {
  const resolved = resolve(value);
  const normalized = resolved.replaceAll('\\', '/');

  if (normalized.includes('\0')) {
    throw new Error('Evidence pack directory is invalid.');
  }

  if (!EVIDENCE_PACK_DIR_RE.test(normalized) && !TEMP_EVIDENCE_PACK_RE.test(normalized)) {
    throw new Error('Evidence pack directory must be a workspace .mate-x/evidence task folder.');
  }

  return resolved;
}

export function parsePublicKeyPem(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 8_192 || !PEM_PUBLIC_KEY_RE.test(trimmed)) {
    throw new Error('Invalid public key PEM.');
  }

  return trimmed;
}