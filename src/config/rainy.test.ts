import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  RAINY_API_BASE_URL,
  resolveRainyApiBaseUrl,
  resolveRainyPrivateRuntimeConfig,
} from "./rainy";

describe("private Rainy runtime configuration", () => {
  it("uses the public app-owned Rainy endpoint", () => {
    assert.equal(
      resolveRainyApiBaseUrl(),
      "https://rainy-api-v3-us-160298401329.us-east4.run.app",
    );
    assert.equal(resolveRainyApiBaseUrl(), RAINY_API_BASE_URL);
  });

  it("does not allow runtime environment variables to redirect Rainy traffic", () => {
    assert.equal(
      resolveRainyPrivateRuntimeConfig({
        env: {
          RAINY_API_BASE_URL: "https://redirect.example.test",
          RAINY_API_KEY: "environment-secret",
        },
      }).endpoint,
      RAINY_API_BASE_URL,
    );
  });

  it("prefers private persisted credentials without exposing them in endpoint", () => {
    assert.deepEqual(
      resolveRainyPrivateRuntimeConfig({
        env: {
          RAINY_API_KEY: "environment-secret",
        },
        storedApiKey: "persisted-secret",
      }),
      {
        endpoint: RAINY_API_BASE_URL,
        apiKey: "persisted-secret",
      },
    );
  });
});
