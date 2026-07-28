import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  resolveRainyApiBaseUrl,
  resolveRainyPrivateRuntimeConfig,
} from "./rainy";

describe("private Rainy runtime configuration", () => {
  it("fails closed without a configured endpoint", () => {
    assert.throws(
      () => resolveRainyApiBaseUrl({}),
      /RAINY_API_BASE_URL is required/,
    );
  });

  it("accepts only credential-free HTTPS endpoints", () => {
    assert.equal(
      resolveRainyApiBaseUrl({
        RAINY_API_BASE_URL: "https://collector.example.test/",
      }),
      "https://collector.example.test",
    );
    assert.throws(() =>
      resolveRainyApiBaseUrl({
        RAINY_API_BASE_URL: "http://localhost:3000",
      }),
    );
    assert.throws(() =>
      resolveRainyApiBaseUrl({
        RAINY_API_BASE_URL: "https://user:secret@collector.example.test",
      }),
    );
  });

  it("prefers private persisted credentials without exposing them in endpoint", () => {
    assert.deepEqual(
      resolveRainyPrivateRuntimeConfig({
        env: {
          RAINY_API_BASE_URL: "https://collector.example.test",
          RAINY_API_KEY: "environment-secret",
        },
        storedApiKey: "persisted-secret",
      }),
      {
        endpoint: "https://collector.example.test",
        apiKey: "persisted-secret",
      },
    );
  });
});
