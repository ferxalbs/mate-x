import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { describe, mock, test } from "bun:test";

process.env.RAINY_API_BASE_URL ??= "https://rainy.test";

(mock as any).module("electron", () => ({
  app: {
    getPath: () => tmpdir(),
  },
  safeStorage: {
    decryptString: (value: Buffer) => value.toString("utf8"),
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    isEncryptionAvailable: () => false,
  },
  powerSaveBlocker: {
    isStarted: () => false,
    start: () => 1,
    stop: () => undefined,
  },
}));

const {
  createRainyOperationRequestOptions,
} = await import("../../rainy-service");
const {
  createProviderFailurePublicEvent,
  createProviderFailureResult,
  recordProviderFailure,
} = await import(
  "./model-tools-unavailable"
);
const { InMemoryEngineeringRepository } = await import(
  "../../engineering/in-memory-repository"
);
const { AgentExecutionSession } = await import(
  "../../run-trace/agent-execution-session"
);

describe("provider failure regression", () => {
  test("builds one stable billing operation ID for every retry of a request", () => {
    const operationId = "b79d85fa-d23e-48f2-813c-76f9b9c67ae2";
    const options = createRainyOperationRequestOptions(
      { timeout: 90_000 },
      operationId,
    );

    assert.equal(options.idempotencyKey, operationId);
    assert.equal(options.headers["X-Idempotency-Key"], operationId);
    assert.equal(options.headers["X-Request-Id"], operationId);
    assert.equal(options.timeout, 90_000);
  });

  test("turns the billing failure into a precise typed outcome", () => {
    const result = createProviderFailureResult(
      [],
      new Error("500 A stable billing operation ID is required"),
    );

    assert.equal(result.outcome.status, "failed");
    if (result.outcome.status !== "failed") {
      throw new Error("Expected a typed provider failure.");
    }
    assert.equal(
      result.outcome.diagnostic?.code,
      "PROVIDER_BILLING_OPERATION_ID_REQUIRED",
    );
    assert.match(result.content, /billing operation identifier was missing/i);
    assert.doesNotMatch(result.content, /provider stopped/i);
  });

  test("records the precise provider failure in the local diagnostic ledger", () => {
    const repository = new InMemoryEngineeringRepository();
    const session = new AgentExecutionSession(
      "run-provider-billing-regression",
      "execute",
      null,
      null,
      repository,
    );
    session.start();

    recordProviderFailure(
      session.runId,
      new Error("500 A stable billing operation ID is required"),
      1,
    );

    const diagnostic = session
      .getEvents()
      .find((event) => event.kind === "provider.failed");
    assert.equal(diagnostic?.visibility, "local_diagnostic");
    assert.deepEqual(diagnostic?.payload, {
      toolClass: "rainy",
      code: "PROVIDER_BILLING_OPERATION_ID_REQUIRED",
      attempt: 1,
    });
  });

  test("keeps a safe provider failure visible after streaming state is replaced", () => {
    const event = createProviderFailurePublicEvent({
      runId: "run-provider-billing-regression",
      attempt: 1,
      summary:
        "The provider rejected the request because its billing operation identifier was missing.",
    });

    assert.equal(event.visibility, "public");
    assert.equal(event.segmentKind, "error");
    assert.equal(event.status, "failed");
    assert.doesNotMatch(event.detail, /500|request id|stack|api key/i);
  });
});
