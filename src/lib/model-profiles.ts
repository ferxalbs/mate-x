import type { RainyModelCatalogEntry, RainyServiceTier } from "../contracts/rainy";

export type VerificationProfile = "fast" | "balanced" | "deep" | "critical";
export type ModelFamily = "luna" | "terra" | "sol";
export type ReasoningEffort = "low" | "medium" | "high" | "max";
export type ReasoningMode = "disabled" | "summary" | "full";

export interface ModelRuntimeProfile {
  verificationProfile: VerificationProfile;
  family: ModelFamily;
  capabilityVariant: "standard" | "pro";
  providerModelId: string;
  reasoningEffort: ReasoningEffort;
  reasoningMode: ReasoningMode;
  requestedServiceTier: RainyServiceTier;
  effectiveServiceTier: RainyServiceTier | null;
  contextLimit: number | null;
  pricingLimitNotice: string | null;
  escalationReasons: string[];
}

export interface RoutingContext {
  diffFiles?: number;
  runtimeSurfaces?: string[];
  riskSurfaces?: string[];
  missingEvidence?: string[];
  conflictingEvidence?: boolean;
  contextTokens?: number;
  latencyPreference?: "low" | "normal";
  budget?: "low" | "normal" | "high";
  userProfile?: VerificationProfile;
}

const HIGH_CONTEXT_THRESHOLD = 272_000;
const SENSITIVE_SURFACE = /auth|billing|payment|infra|deploy|secret|crypto|migration|database|sql|concurrency|worker|queue|destructive|delete|permission|ipc|electron|preload|shell|git/i;

const FAMILY_MODEL_IDS: Record<ModelFamily, string[]> = {
  luna: ["openai/gpt-5.6-luna", "rainy/luna", "luna"],
  terra: ["openai/gpt-5.6-terra", "rainy/terra", "terra"],
  sol: ["openai/gpt-5.6-sol", "rainy/sol", "sol"],
};

const PROFILE_DEFAULTS: Record<VerificationProfile, Pick<ModelRuntimeProfile, "family" | "reasoningEffort" | "reasoningMode" | "requestedServiceTier" | "capabilityVariant">> = {
  fast: { family: "luna", reasoningEffort: "low", reasoningMode: "summary", requestedServiceTier: "standard", capabilityVariant: "standard" },
  balanced: { family: "terra", reasoningEffort: "medium", reasoningMode: "summary", requestedServiceTier: "standard", capabilityVariant: "standard" },
  deep: { family: "sol", reasoningEffort: "high", reasoningMode: "summary", requestedServiceTier: "standard", capabilityVariant: "standard" },
  critical: { family: "sol", reasoningEffort: "max", reasoningMode: "full", requestedServiceTier: "priority", capabilityVariant: "standard" },
};

export function routeVerificationModel(
  context: RoutingContext,
  catalog: RainyModelCatalogEntry[],
): ModelRuntimeProfile {
  const escalationReasons: string[] = [];
  let profile = context.userProfile ?? "balanced";

  if ((context.diffFiles ?? 0) <= 3 && context.latencyPreference === "low" && !hasSensitiveContext(context)) {
    profile = minProfile(profile, "fast");
  }
  if ((context.diffFiles ?? 0) > 12 || (context.runtimeSurfaces?.length ?? 0) > 3) {
    profile = maxProfile(profile, "deep");
    escalationReasons.push("Diff size or runtime surface count requires deeper verification.");
  }
  if (hasSensitiveContext(context)) {
    profile = maxProfile(profile, "critical");
    escalationReasons.push("Sensitive runtime surface requires critical verification.");
  }
  if ((context.missingEvidence?.length ?? 0) > 0 || context.conflictingEvidence) {
    profile = maxProfile(profile, "deep");
    escalationReasons.push("Missing or conflicting evidence requires stronger reasoning.");
  }
  if ((context.contextTokens ?? 0) > HIGH_CONTEXT_THRESHOLD) {
    profile = maxProfile(profile, "deep");
    escalationReasons.push("High-context input requires explicit pricing disclosure.");
  }
  if (context.budget === "low" && profile === "critical" && !hasSensitiveContext(context)) {
    profile = "deep";
    escalationReasons.push("Budget constraint prevented non-critical Pro escalation.");
  }

  const defaults = PROFILE_DEFAULTS[profile];
  const proAllowed = profile === "critical" && context.budget !== "low" && hasDeclaredProVariant(defaults.family, catalog);
  const capabilityVariant = proAllowed ? "pro" : defaults.capabilityVariant;
  if (proAllowed) escalationReasons.push("Declared Pro variant selected for critical verification.");

  const providerModelId = pickProviderModelId(defaults.family, capabilityVariant, catalog);
  const catalogEntry = catalog.find((entry) => entry.id === providerModelId);

  return {
    verificationProfile: profile,
    family: defaults.family,
    capabilityVariant,
    providerModelId,
    reasoningEffort: defaults.reasoningEffort,
    reasoningMode: defaults.reasoningMode,
    requestedServiceTier: proAllowed ? "priority" : defaults.requestedServiceTier,
    effectiveServiceTier: null,
    contextLimit: catalogEntry?.contextLength ?? null,
    pricingLimitNotice:
      (context.contextTokens ?? 0) > HIGH_CONTEXT_THRESHOLD
        ? "High-context pricing may apply above 272K input tokens."
        : null,
    escalationReasons: escalationReasons.length > 0 ? escalationReasons : ["Balanced profile is the default for ordinary verification."],
  };
}

export function applyEffectiveServiceTier(
  profile: ModelRuntimeProfile,
  effectiveServiceTier: RainyServiceTier | null,
): ModelRuntimeProfile {
  return { ...profile, effectiveServiceTier };
}

function hasSensitiveContext(context: RoutingContext) {
  return [...(context.runtimeSurfaces ?? []), ...(context.riskSurfaces ?? [])].some((surface) => SENSITIVE_SURFACE.test(surface));
}

function hasDeclaredProVariant(family: ModelFamily, catalog: RainyModelCatalogEntry[]) {
  return catalog.some((entry) => isFamilyModel(entry.id, family) && /(^|[-_/])pro($|[-_/])/i.test(entry.id));
}

function pickProviderModelId(family: ModelFamily, variant: "standard" | "pro", catalog: RainyModelCatalogEntry[]) {
  const declared = catalog.find((entry) => isFamilyModel(entry.id, family) && (variant === "pro" ? /(^|[-_/])pro($|[-_/])/i.test(entry.id) : !/(^|[-_/])pro($|[-_/])/i.test(entry.id)));
  return declared?.id ?? FAMILY_MODEL_IDS[family][0];
}

function isFamilyModel(id: string, family: ModelFamily) {
  return FAMILY_MODEL_IDS[family].some((candidate) => id.toLowerCase().includes(candidate.toLowerCase())) || id.toLowerCase().includes(family);
}

const ORDER: VerificationProfile[] = ["fast", "balanced", "deep", "critical"];
function maxProfile(a: VerificationProfile, b: VerificationProfile) {
  return ORDER[Math.max(ORDER.indexOf(a), ORDER.indexOf(b))];
}
function minProfile(a: VerificationProfile, b: VerificationProfile) {
  return ORDER[Math.min(ORDER.indexOf(a), ORDER.indexOf(b))];
}
