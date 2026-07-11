import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RainyModelCatalogEntry } from "../contracts/rainy";
import { applyEffectiveServiceTier, routeVerificationModel } from "./model-profiles";

const catalog: RainyModelCatalogEntry[] = [
  { id: "openai/gpt-5.6-luna", label: "Luna", description: null, ownedBy: "openai", supportedApiModes: ["responses"], preferredApiMode: "responses", contextLength: 128000 },
  { id: "openai/gpt-5.6-terra", label: "Terra", description: null, ownedBy: "openai", supportedApiModes: ["responses"], preferredApiMode: "responses", contextLength: 256000 },
  { id: "openai/gpt-5.6-sol", label: "Sol", description: null, ownedBy: "openai", supportedApiModes: ["responses"], preferredApiMode: "responses", contextLength: 512000 },
  { id: "openai/gpt-5.6-sol-pro", label: "Sol Pro", description: null, ownedBy: "openai", supportedApiModes: ["responses"], preferredApiMode: "responses", contextLength: 512000 },
];

describe("model runtime profiles", () => {
  it("defaults to Balanced/Terra without Pro", () => {
    const profile = routeVerificationModel({}, catalog);
    assert.equal(profile.verificationProfile, "balanced");
    assert.equal(profile.family, "terra");
    assert.equal(profile.reasoningEffort, "medium");
    assert.equal(profile.capabilityVariant, "standard");
  });

  it("uses Fast/Luna for small latency-sensitive diffs", () => {
    const profile = routeVerificationModel({ userProfile: "balanced", diffFiles: 2, latencyPreference: "low" }, catalog);
    assert.equal(profile.verificationProfile, "fast");
    assert.equal(profile.family, "luna");
    assert.equal(profile.reasoningEffort, "low");
  });

  it("escalates sensitive changes to Critical and only uses declared Pro variants", () => {
    const profile = routeVerificationModel({ riskSurfaces: ["auth ipc shell boundary"] }, catalog);
    assert.equal(profile.verificationProfile, "critical");
    assert.equal(profile.family, "sol");
    assert.equal(profile.reasoningEffort, "max");
    assert.equal(profile.providerModelId, "openai/gpt-5.6-sol-pro");
  });

  it("does not guess a -pro suffix when the catalog lacks a declared Pro variant", () => {
    const profile = routeVerificationModel({ riskSurfaces: ["billing"] }, catalog.filter((entry) => !entry.id.includes("pro")));
    assert.equal(profile.capabilityVariant, "standard");
    assert.equal(profile.providerModelId, "openai/gpt-5.6-sol");
  });

  it("records high-context pricing disclosure and effective tier separately", () => {
    const routed = routeVerificationModel({ contextTokens: 300000 }, catalog);
    const applied = applyEffectiveServiceTier(routed, "flex");
    assert.match(applied.pricingLimitNotice ?? "", /272K input tokens/);
    assert.equal(applied.requestedServiceTier, "standard");
    assert.equal(applied.effectiveServiceTier, "flex");
  });
});
