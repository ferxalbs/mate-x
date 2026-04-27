import type {
  RainyModelCapabilities,
  RainyModelCatalogEntry,
} from "../contracts/rainy";

type CapabilitySource = RainyModelCatalogEntry | RainyModelCapabilities | null | undefined;

const DEFAULT_REASONING_EFFORTS = ["low", "medium", "high"] as const;

export function supportsReasoning(model: CapabilitySource) {
  return getCapabilities(model)?.reasoning?.supported === true;
}

export function supportsReasoningEffort(model: CapabilitySource) {
  return getReasoningEffortValues(model).length > 0;
}

export function getReasoningEffortValues(model: CapabilitySource) {
  const capabilities = getCapabilities(model);
  const controls = capabilities?.reasoning?.controls;
  const profileValues = capabilities?.reasoning?.profiles
    ?.filter((profile) => profile.parameter_path === "reasoning.effort")
    .flatMap((profile) => profile.values ?? [])
    .filter(isNonEmptyString);

  if (profileValues && profileValues.length > 0) {
    return Array.from(new Set(profileValues));
  }

  const controlValues = controls?.effort?.filter(isNonEmptyString) ?? [];
  if (controlValues.length > 0) {
    return Array.from(new Set(controlValues));
  }

  return controls?.reasoning_effort === true ? [...DEFAULT_REASONING_EFFORTS] : [];
}

export function supportsImageInput(model: CapabilitySource) {
  const catalogEntry = getCatalogEntry(model);
  const capabilities = getCapabilities(model);
  return (
    capabilities?.multimodal?.input?.includes("image") === true ||
    catalogEntry?.architecture?.input_modalities?.includes("image") === true
  );
}

export function supportsImageOutput(model: CapabilitySource) {
  const catalogEntry = getCatalogEntry(model);
  const capabilities = getCapabilities(model);
  return (
    capabilities?.multimodal?.output?.includes("image") === true ||
    catalogEntry?.architecture?.output_modalities?.includes("image") === true
  );
}

export function supportsTools(model: CapabilitySource) {
  return getAcceptedParameters(model).includes("tools");
}

export function supportsStructuredOutput(model: CapabilitySource) {
  const accepted = getAcceptedParameters(model);
  return accepted.includes("response_format") || accepted.includes("structured_outputs");
}

export function getAcceptedParameters(model: CapabilitySource) {
  const catalogEntry = getCatalogEntry(model);
  const capabilities = getCapabilities(model);
  const accepted = capabilities?.parameters?.accepted ?? catalogEntry?.supportedParameters ?? [];
  return Array.from(new Set(accepted.filter(isNonEmptyString)));
}

function getCatalogEntry(model: CapabilitySource): RainyModelCatalogEntry | null {
  if (model && "id" in model) {
    return model;
  }

  return null;
}

function getCapabilities(model: CapabilitySource): RainyModelCapabilities | undefined {
  if (!model) {
    return undefined;
  }

  if ("id" in model) {
    return model.capabilities;
  }

  return model;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
