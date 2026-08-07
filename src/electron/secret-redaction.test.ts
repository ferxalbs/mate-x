import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import {
  REDACTED_SECRET,
  redactSecretPayload,
  redactSecretPayloadWithReport,
  redactSensitiveText,
} from "./secret-redaction";

describe("typed secret redaction", () => {
  test("redacts typed secret fields recursively without retaining values", () => {
    const payload = {
      token: "not-a-provider-shaped-token",
      credentials: {
        password: "correct horse battery staple",
        headers: { Authorization: "Bearer ghp_1234567890abcdef" },
      },
      message: "normal repository evidence",
    };

    const result = redactSecretPayloadWithReport(payload);
    assert.equal(result.payload.credentials.password, REDACTED_SECRET);
    assert.equal(result.payload.credentials.headers.Authorization, REDACTED_SECRET);
    assert.equal(result.payload.token, REDACTED_SECRET);
    assert.equal(result.payload.message, payload.message);
    assert.equal(JSON.stringify(result.payload).includes("correct horse"), false);
    assert.equal(JSON.stringify(result.payload).includes("ghp_123"), false);
    assert.ok(result.findings.some((finding) => finding.kind === "password"));
    assert.ok(result.findings.some((finding) => finding.kind === "authorization"));
  });

  test("redacts short secrets and JSON-serialized secret fields in text", () => {
    const redacted = redactSensitiveText(
      '{"password":"x","token":"abc","Authorization":"Bearer short"}',
    );
    assert.doesNotMatch(redacted, /"password":"x"|"token":"abc"|Bearer short/);
    assert.match(redacted, /REDACTED_SECRET/);
  });

  test("redacts common token formats and authorization text", () => {
    const text = [
      "Authorization: Bearer ghp_1234567890abcdef",
      "OPENAI_API_KEY=sk_live_1234567890abcdef",
      "jwt=eyJaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc",
    ].join("\n");
    const redacted = redactSensitiveText(text);
    assert.doesNotMatch(redacted, /ghp_|sk_live_|eyJaaaaaaaaaa|Bearer\s+ghp_/);
    assert.match(redacted, /REDACTED_SECRET/);
  });

  test("does not alter ordinary non-secret evidence", () => {
    const payload = { summary: "Tests passed", path: "src/security.ts", count: 2 };
    assert.deepEqual(redactSecretPayload(payload), payload);
  });
});
