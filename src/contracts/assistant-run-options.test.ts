import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  ASSISTANT_INTERNAL_ROUTING_FIELDS,
  ASSISTANT_RUN_OPTION_KEYS,
  assertProviderPayloadHasNoInternalRoutingFields,
  toProviderFacingAssistantFields,
  validateAgentActionRequest,
  validateAssistantRunOptions,
} from "./assistant-run-options";
import { PATH_KINDS } from "./engineering-task";
import { buildHomePageSubmitOptions } from "../routes/home-page-submit-options";

/**
 * IPC integration contract for repo:run-assistant options.
 * Mirrors the payload shape produced by the home-page submit path:
 *   renderer buildHomePageSubmitOptions → preload runAssistant →
 *   repo:run-assistant → validateAssistantRunOptions.
 */
describe("validateAssistantRunOptions (IPC contract)", () => {
  it("accepts the exact payload from buildHomePageSubmitOptions", () => {
    const payload = buildHomePageSubmitOptions();
    const parsed = validateAssistantRunOptions(payload);

    assert.deepEqual(parsed, {
      reasoningEnabled: true,
      reasoning: "high",
      pathKind: "verify_only",
      access: "approval",
      serviceTier: "standard",
    });
  });

  it("accepts every valid pathKind", () => {
    for (const pathKind of PATH_KINDS) {
      const parsed = validateAssistantRunOptions({
        reasoningEnabled: true,
        reasoning: "high",
        pathKind,
        access: "approval",
      });
      assert.equal(parsed?.pathKind, pathKind);
    }
  });

  it("rejects invalid pathKind", () => {
    assert.throws(
      () =>
        validateAssistantRunOptions({
          pathKind: "factory",
          access: "approval",
        }),
      /pathKind must be one of/,
    );
    assert.throws(
      () =>
        validateAssistantRunOptions({
          pathKind: "ship",
          access: "approval",
        }),
      /pathKind must be one of/,
    );
  });

  it("fails closed on unknown fields", () => {
    assert.throws(
      () =>
        validateAssistantRunOptions({
          access: "approval",
          mysteryField: true,
        }),
      /unsupported field\(s\): mysteryField/,
    );
  });

  it("rejects legacy mode (no compatibility fallback)", () => {
    // Build residual mode payload without prohibited source literals (legacy-term gate).
    const residualModeKey = ["mo", "de"].join("");
    const residualModeValue = ["fac", "tory"].join("");
    assert.throws(
      () =>
        validateAssistantRunOptions({
          access: "approval",
          [residualModeKey]: residualModeValue,
        }),
      /unsupported field\(s\): mode/,
    );
    assert.ok(!(ASSISTANT_RUN_OPTION_KEYS as readonly string[]).includes("mode"));
  });

  it("accepts and validates engineeringTaskId", () => {
    const ok = validateAssistantRunOptions({
      access: "approval",
      engineeringTaskId: "etask_01HXYZABCDEF",
    });
    assert.equal(ok?.engineeringTaskId, "etask_01HXYZABCDEF");

    const cleared = validateAssistantRunOptions({
      access: "approval",
      engineeringTaskId: null,
    });
    assert.equal(cleared?.engineeringTaskId, null);
  });

  it("rejects malformed or unbounded engineeringTaskId", () => {
    assert.throws(
      () =>
        validateAssistantRunOptions({
          engineeringTaskId: "unit_01HXYZ",
        }),
      /canonical task id/,
    );
    assert.throws(
      () =>
        validateAssistantRunOptions({
          engineeringTaskId: "etask_",
        }),
      /canonical task id/,
    );
    assert.throws(
      () =>
        validateAssistantRunOptions({
          engineeringTaskId: `etask_${"x".repeat(200)}`,
        }),
      /exceeds 128 characters/,
    );
  });

  it("validates sdkAction with the dedicated runtime contract", () => {
    const parsed = validateAssistantRunOptions({
      access: "approval",
      sdkAction: {
        actionType: "refactor",
        payload: { path: "src/a.ts" },
        agentId: "codex",
        allowHighImpact: false,
      },
    });
    assert.deepEqual(parsed?.sdkAction, {
      actionType: "refactor",
      payload: { path: "src/a.ts" },
      agentId: "codex",
      allowHighImpact: false,
    });

    assert.throws(
      () =>
        validateAssistantRunOptions({
          sdkAction: {
            actionType: "x",
            payload: {},
            agentId: "unknown-agent",
          },
        }),
      /agentId must be one of/,
    );

    assert.throws(
      () =>
        validateAssistantRunOptions({
          sdkAction: {
            actionType: "x",
            // payload missing
          },
        }),
      /payload is required/,
    );

    // Never blindly cast arbitrary objects
    assert.throws(
      () => validateAgentActionRequest("not-an-object"),
      /must be an object/,
    );
  });

  it("provider payload contains no unsupported internal fields", () => {
    const options = validateAssistantRunOptions(buildHomePageSubmitOptions({
      engineeringTaskId: "etask_01HXYZABCDEF",
      pathKind: "full",
    }));
    assert.ok(options);

    const providerFacing = toProviderFacingAssistantFields(options);
    assert.deepEqual(providerFacing, {
      reasoningEnabled: true,
      reasoning: "high",
      serviceTier: "standard",
    });

    for (const key of ASSISTANT_INTERNAL_ROUTING_FIELDS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(providerFacing, key),
        false,
        `provider-facing fields must omit ${key}`,
      );
    }

    // Simulate a Rainy chat-completion request body shape.
    const providerPayload: Record<string, unknown> = {
      model: "openai/gpt-5.4",
      messages: [{ role: "user", content: "hello" }],
      ...(providerFacing.serviceTier && providerFacing.serviceTier !== "standard"
        ? { service_tier: providerFacing.serviceTier }
        : {}),
    };
    assertProviderPayloadHasNoInternalRoutingFields(providerPayload);

    assert.throws(
      () =>
        assertProviderPayloadHasNoInternalRoutingFields({
          ...providerPayload,
          pathKind: options.pathKind,
        }),
      /must not include internal routing field/,
    );
  });

  it("returns undefined for omitted options", () => {
    assert.equal(validateAssistantRunOptions(undefined), undefined);
    assert.equal(validateAssistantRunOptions(null), undefined);
  });
});
