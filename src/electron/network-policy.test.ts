import assert from "node:assert/strict";
import { describe, test } from "bun:test";

import {
  assertNetworkUrlAllowed,
  fetchWithNetworkPolicy,
  isBlockedIp,
  validateNetworkTargetForToolCall,
} from "./network-policy";

const contract = {
  allowedDomains: ["example.com"],
} as import("../contracts/workspace").WorkspaceTrustContract;

describe("central network policy", () => {
  test("blocks localhost, private, link-local, and metadata literals", async () => {
    for (const url of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
    ]) {
      await assert.rejects(
        () => assertNetworkUrlAllowed(url, contract),
        /blocked|private|metadata/i,
      );
    }
  });

  test("blocks a public hostname that resolves to a private address", async () => {
    await assert.rejects(
      () =>
        assertNetworkUrlAllowed("https://example.com/", contract, {
          resolveHost: async () => ["192.168.1.25"],
        }),
      /private|metadata|public/i,
    );
  });

  test("requires allowedDomains and permits a public resolved target", async () => {
    await assertNetworkUrlAllowed("https://api.example.com/v1", contract, {
      resolveHost: async () => ["93.184.216.34"],
    });
    await assert.rejects(
      () =>
        assertNetworkUrlAllowed("https://not-allowed.test/", contract, {
          resolveHost: async () => ["93.184.216.34"],
        }),
      /allowedDomains/i,
    );
  });

  test("rejects embedded credentials and sensitive headers for generic fetches", async () => {
    await assert.rejects(
      () => assertNetworkUrlAllowed("https://user:pass@example.com/", contract),
      /credentials/i,
    );
    await assert.rejects(
      () =>
        fetchWithNetworkPolicy(
          "https://example.com/",
          { headers: { Authorization: "Bearer secret" } },
          contract,
          { resolveHost: async () => ["93.184.216.34"] },
        ),
      /Sensitive request header/i,
    );
  });

  test("network tools are statically constrained to the workspace policy", () => {
    assert.match(
      validateNetworkTargetForToolCall(
        "http_prober",
        { url: "http://localhost:3000" },
        contract,
      ) ?? "",
      /blocked|localhost/i,
    );
    assert.equal(
      validateNetworkTargetForToolCall(
        "creds_validator",
        { provider: "github", token: "redacted" },
        { ...contract, allowedDomains: ["api.github.com"] },
      ),
      null,
    );
  });

  test("covers the private address ranges used by SSRF payloads", () => {
    assert.equal(isBlockedIp("172.16.0.1"), true);
    assert.equal(isBlockedIp("192.168.0.1"), true);
    assert.equal(isBlockedIp("169.254.169.254"), true);
    assert.equal(isBlockedIp("8.8.8.8"), false);
  });
});
