import { z } from 'zod';
import { parseWorkspaceId, parseEvidencePackDirectory, parsePublicKeyPem, parseStoragePrefix } from './src/electron/ipc/guards';
import type { EvidencePackStoragePublishInput } from './src/contracts';

const evidencePackPublishSchema = z.object({
  workspaceId: z.string().transform(parseWorkspaceId),
  evidencePackDirectory: z.string().transform(parseEvidencePackDirectory),
  publicKeyPem: z.string().transform(parsePublicKeyPem),
  prefix: z.string().max(256).transform(parseStoragePrefix).optional(),
  uploadedAt: z.coerce.date().optional(),
}) satisfies z.ZodType<EvidencePackStoragePublishInput, any, any>;

console.log(evidencePackPublishSchema);
