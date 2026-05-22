export type RainyApiMode = 'chat_completions' | 'responses';
export type RainyServiceTier = 'standard' | 'flex' | 'priority';

export interface RainyServiceTierPricing {
  tier: RainyServiceTier;
  input?: string | number | null;
  output?: string | number | null;
  prompt?: string | number | null;
  completion?: string | number | null;
  [key: string]: unknown;
}

export interface RainyModelPricing {
  input?: string | number | null;
  output?: string | number | null;
  prompt?: string | number | null;
  completion?: string | number | null;
  service_tiers?: RainyServiceTierPricing[];
  [key: string]: unknown;
}

export interface RainyModelCapabilities {
  multimodal?: {
    input?: string[];
    output?: string[];
  };
  reasoning?: {
    supported?: boolean;
    controls?: {
      reasoning_toggle?: boolean;
      reasoning_effort?: boolean;
      effort?: string[];
      thinking_level?: string[];
    };
    profiles?: Array<{
      id?: string;
      label?: string;
      parameter_path?: string;
      values?: string[];
      options?: string[];
      enum?: string[];
      allowed_values?: string[];
    }>;
    toggle?: boolean;
  };
  parameters?: {
    accepted?: string[];
  };
}

export interface RainyModelCatalogEntry {
  id: string;
  label: string;
  description: string | null;
  ownedBy: string | null;
  contextLength?: number;
  supportedApiModes: RainyApiMode[];
  preferredApiMode: RainyApiMode | null;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  topProvider?: {
    max_completion_tokens?: number;
    max_tokens?: number;
  };
  perRequestLimits?: {
    max_completion_tokens?: number;
    max_output_tokens?: number;
    completion_tokens?: number;
    output_tokens?: number;
  };
  pricing?: RainyModelPricing;
  supportedParameters?: string[];
  capabilities?: RainyModelCapabilities;
}

export function normalizeRainyServiceTier(
  value: unknown,
): RainyServiceTier {
  return value === 'flex' || value === 'priority' ? value : 'standard';
}

export function getRainyServiceTierOptions(
  entry?: RainyModelCatalogEntry | null,
): RainyServiceTier[] {
  const tiers = entry?.pricing?.service_tiers;
  if (!tiers || tiers.length === 0) {
    return ['standard'];
  }

  const supported = new Set<RainyServiceTier>(['standard']);
  for (const tier of tiers) {
    supported.add(normalizeRainyServiceTier(tier.tier));
  }

  return (['standard', 'flex', 'priority'] as RainyServiceTier[]).filter(
    (tier) => supported.has(tier),
  );
}

export function modelSupportsServiceTiers(
  entry?: RainyModelCatalogEntry | null,
) {
  return getRainyServiceTierOptions(entry).length > 1;
}
