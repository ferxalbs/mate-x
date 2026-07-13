import crypto from "node:crypto";
import { app, safeStorage } from "electron";

import type { PrivacySpan } from "./privacy-types";
import { tursoService } from "../turso-service";

/**
 * Local privacy-span key material.
 *
 * Prefer MATE_X_PRIVACY_VAULT_KEY in production/shared machines. The baked-in
 * default is intentionally weak and is only acceptable for single-user local
 * installs; the userData path scopes ciphertext to this profile, but does not
 * replace a strong secret. Changing this derivation invalidates existing spans.
 */
function deriveVaultKey() {
  const secret = process.env.MATE_X_PRIVACY_VAULT_KEY?.trim() || "mate-x-local-privacy-vault";
  const localScope = `${app.getPath("userData")}:${safeStorage.isEncryptionAvailable() ? "safe-storage" : "fallback"}`;
  return crypto.createHash("sha256").update(`${secret}:${localScope}`).digest();
}

export async function storePrivacySpans(params: {
  workspaceId?: string;
  runId?: string;
  spans: PrivacySpan[];
}) {
  if (params.spans.length === 0) {
    return;
  }

  const key = deriveVaultKey();
  const createdAt = new Date().toISOString();

  await Promise.all(
    params.spans.map((span) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(span.text, "utf8"),
        cipher.final(),
      ]).toString("base64");
      const authTag = cipher.getAuthTag().toString("base64");

      return tursoService.storePrivacySecret({
        id: span.id,
        workspaceId: params.workspaceId ?? "",
        runId: params.runId ?? null,
        label: span.label,
        replacement: span.replacement,
        hash: span.hash,
        ciphertext,
        iv: iv.toString("base64"),
        authTag,
        source: span.source.join(","),
        createdAt,
      });
    }),
  );
}
