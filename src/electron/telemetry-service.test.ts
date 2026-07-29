import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import { DEFAULT_APP_SETTINGS } from "../contracts/settings";
import {
  MateTelemetryService,
  parseRendererTelemetryMessage,
  sanitizeApplicationError,
  type TelemetryClient,
} from "./telemetry-service";

function initialization(enabled = true) {
  return {
    enabled,
    endpoint: "https://telemetry.example.test",
    apiKey: "test-secret",
    clientId: "matex-install-00000000-0000-4000-8000-000000000000",
    appVersion: "0.1.3",
    osFamily: "macos" as const,
  };
}

function fakeClient(input?: {
  observe?: <T>(operation: () => T | PromiseLike<T>) => Promise<T>;
  destroy?: () => Promise<unknown>;
}) {
  const tracked: Array<{ name: string; attributes?: Record<string, unknown> }> = [];
  const errors: unknown[] = [];
  const client: TelemetryClient = {
    telemetry: {
      track: (name, attributes) => tracked.push({ name, attributes }),
      captureError: (error) => errors.push(error),
      observe: async <T>(_name: string, operation: () => T | PromiseLike<T>) =>
        input?.observe ? input.observe(operation) : await operation(),
    },
    destroy: input?.destroy ?? (async () => undefined),
  };
  return { client, tracked, errors };
}

describe("MateTelemetryService", () => {
  it("defaults telemetry off until the user opts in", () => {
    assert.equal(DEFAULT_APP_SETTINGS.telemetryEnabled, false);
  });

  it("constructs no SDK client and sends nothing after explicit opt-out", async () => {
    let constructions = 0;
    const service = new MateTelemetryService({
      createClient: () => {
        constructions += 1;
        return fakeClient().client;
      },
    });

    await service.initialize(initialization(false));
    service.track("mate.app.startup", { feature: "application" });
    await service.observe("mate.analysis.run", async () => "ok");
    service.captureError(new Error("ignored"), { operation: "mate.analysis.run" });
    await service.shutdown();

    assert.equal(constructions, 0);
  });

  it("creates only one SDK and enables remote automatic session tracking", async () => {
    const options: unknown[] = [];
    const service = new MateTelemetryService({
      createClient: (value) => {
        options.push(value);
        return fakeClient().client;
      },
    });

    await Promise.all([
      service.initialize(initialization()),
      service.initialize(initialization()),
      service.initialize(initialization()),
    ]);

    assert.equal(options.length, 1);
    assert.equal((options[0] as { delivery: string }).delivery, "remote");
    assert.equal(
      (options[0] as { telemetry: { sessionTracking: boolean } }).telemetry.sessionTracking,
      true,
    );
  });

  it("uses SDK destroy lifecycle during graceful shutdown and isolates failure", async () => {
    let destroys = 0;
    const service = new MateTelemetryService({
      createClient: () =>
        fakeClient({
          destroy: async () => {
            destroys += 1;
            throw new Error("collector unavailable");
          },
        }).client,
    });

    await service.initialize(initialization());
    await assert.doesNotReject(() => service.shutdown());
    assert.equal(destroys, 1);
  });

  it("collector initialization failure never breaks operations", async () => {
    const service = new MateTelemetryService({
      createClient: () => {
        throw new Error("collector unavailable");
      },
    });

    await assert.doesNotReject(() => service.initialize(initialization()));
    assert.equal(
      await service.observe("mate.analysis.run", async () => "preserved"),
      "preserved",
    );
  });

  it("collector observation failures never replace product results", async () => {
    let calls = 0;
    const service = new MateTelemetryService({
      createClient: () =>
        fakeClient({
          observe: async (operation) => {
            await operation();
            throw new Error("telemetry delivery failed");
          },
        }).client,
    });
    await service.initialize(initialization());

    assert.equal(
      await service.observe("mate.analysis.run", async () => {
        calls += 1;
        return "product-result";
      }),
      "product-result",
    );
    assert.equal(calls, 1);
  });

  it("observe preserves values and exact thrown errors", async () => {
    const service = new MateTelemetryService({
      createClient: () => fakeClient().client,
    });
    await service.initialize(initialization());

    const value = { stable: true };
    assert.equal(
      await service.observe("mate.agent.task", async () => value),
      value,
    );

    const failure = new TypeError("operation failed");
    await assert.rejects(
      () => service.observe("mate.agent.task", async () => {
        throw failure;
      }),
      (error) => error === failure,
    );
  });

  it("sanitizes secrets, content, prompts, responses, and paths before capture", async () => {
    const fake = fakeClient();
    const service = new MateTelemetryService({
      createClient: () => fake.client,
    });
    await service.initialize(initialization());

    const raw = Object.assign(
      new Error(
        "prompt=secret response=private source=const x=1 /Users/alice/repo/src/app.ts token=abc",
      ),
      { code: "PROVIDER_FAILED" },
    );
    service.captureError(raw, { operation: "mate.provider.request" });

    assert.equal(fake.errors.length, 1);
    const serialized = JSON.stringify(fake.errors[0]);
    assert.doesNotMatch(
      serialized,
      /secret|private|const x|Users|alice|repo|app\.ts|token|prompt|response/i,
    );
    assert.match(serialized, /PROVIDER_FAILED/);

    const sanitized = sanitizeApplicationError(raw);
    assert.equal(sanitized.stack, undefined);
    assert.equal(
      sanitized.fingerprint,
      sanitizeApplicationError(raw).fingerprint,
    );
  });
});

describe("renderer telemetry validation", () => {
  it("accepts only allowlisted names and bounded safe metadata", () => {
    assert.deepEqual(
      parseRendererTelemetryMessage({
        name: "mate.settings.update",
        attributes: {
          feature: "privacy",
          status: "success",
          fileCountBucket: "1-10",
        },
      }),
      {
        name: "mate.settings.update",
        attributes: {
          feature: "privacy",
          status: "success",
          fileCountBucket: "1-10",
        },
      },
    );

    assert.throws(() =>
      parseRendererTelemetryMessage({
        name: "arbitrary.exfiltrate",
        attributes: { prompt: "secret" },
      }),
    );
    assert.throws(() =>
      parseRendererTelemetryMessage({
        name: "mate.analysis.run",
        attributes: { feature: "x".repeat(121) },
      }),
    );
    assert.throws(() =>
      parseRendererTelemetryMessage({
        name: "mate.analysis.run",
        attributes: { durationMs: 42 },
      }),
    );
  });
});
