import { createHash, randomBytes } from 'node:crypto';

import { ID_PREFIX, type IdNamespace } from '../../contracts/engineering-task';

/** ULID-like sortable id body (Crockford base32, 26 chars). Not a full ULID lib. */
function ulidBody(): string {
  const time = Date.now().toString(32).toUpperCase().padStart(10, '0').slice(-10);
  const rand = randomBytes(10).toString('hex').toUpperCase().slice(0, 16);
  return `${time}${rand}`;
}

export function newNamespacedId(namespace: IdNamespace): string {
  return `${ID_PREFIX[namespace]}${ulidBody()}`;
}

export function newEngineeringTaskId(): string {
  return newNamespacedId('engineeringTask');
}

export function newEventId(): string {
  return `evt_${ulidBody()}`;
}

export function newCommandId(): string {
  return `cmd_${ulidBody()}`;
}

export function newProofHandle(): string {
  // Opaque unguessable handle (not the proofId)
  return `ph_${randomBytes(24).toString('base64url')}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function nowIso(): string {
  return new Date().toISOString();
}
