export type RainyApiMode = 'chat_completions' | 'responses';
export type RainyServiceTier = 'standard' | 'flex' | 'priority' | 'scale';

export type RainyModelLaunchStatus = 'staged' | 'available' | 'retired';
export type RainyAppControlAvailability = 'staged' | 'available';
export type RainyAppControlKind = 'toggle' | 'select' | 'model_variant';

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
  serviceTier?: RainyServiceTierPricing[];
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

/** Documented Rainy/provider reasoning request fields only. */
export const RAINY_REASONING_REQUEST_FIELDS = [
  'reasoning',
  'reasoning_effort',
  'include_reasoning',
] as const;

export type RainyReasoningRequestField =
  (typeof RAINY_REASONING_REQUEST_FIELDS)[number];

export interface RainyModelLaunchVariant {
  modelId: string;
  label: string;
  family?: string;
  presentation?: RainyModelLaunchPresentation;
}

// ---------------------------------------------------------------------------
// API-resolved UI contract (GET /api/v1/models/launches)
// ---------------------------------------------------------------------------

/** Controls which selector is rendered. "none" = no picker; "single" = show
 *  selected model name only; "multiple" = one button per variant. */
export type LaunchUiSelectorMode = "none" | "single" | "multiple";

/** Resolved server-side — never derived from the model catalog locally. */
export type LaunchVariantAvailability = "callable" | "unavailable";

/** "start_chat" = enabled CTA that starts a conversation with model_id.
 *  "disabled"   = CTA shown but not actionable (use label from API). */
export type LaunchActionKind = "start_chat" | "disabled";

export interface LaunchPrimaryAction {
  /** What the CTA does. */
  kind: LaunchActionKind;
  /** Exact button label text from the API — never override locally. */
  label: string;
  /** Only meaningful when kind === "start_chat". Null for disabled actions. */
  model_id: string | null;
}

export interface LaunchVariant {
  /** Stable identifier used to track selection state. */
  id: string;
  /** Display label for the selector button. */
  label: string;
  /** Server-resolved availability — never derived from catalog locally. */
  availability: LaunchVariantAvailability;
  /** When true, the variant can be clicked for theme preview even if unavailable.
   *  The CTA stays exactly as provided by primary_action (likely disabled). */
  selectable: boolean;
  /** Visual theme for this variant — controls gradient, accent, glow, border. */
  presentation: RainyModelLaunchPresentation;
  /** CTA state when this variant is selected. */
  primary_action: LaunchPrimaryAction;
}

export interface LaunchUi {
  /** Selector layout from the API — client renders exactly this. */
  selector: LaunchUiSelectorMode;
  /** Which variant is pre-selected on mount. Must match a LaunchVariant.id. */
  initial_model_id: string;
  /** Default CTA before the user makes a selection (matches initial variant). */
  primary_action: LaunchPrimaryAction;
  /** Exact variant list — render N buttons, never add or subtract locally. */
  variants: LaunchVariant[];
}

export interface RainyModelLaunchAppControl {
  id: string;
  kind: RainyAppControlKind;
  label: string;
  availability: RainyAppControlAvailability;
  requestFields?: string[];
  values?: string[];
  variantSuffix?: string;
}

export interface RainyModelLaunchPricing {
  basis: 'prompt_tokens';
  highContextThreshold: number;
  note: string;
}

export interface RainyModelLaunchPresentationGradient {
  colors: string[];
  angleDegrees: number;
}

export interface RainyModelLaunchPresentationAnimation {
  kind: 'aurora';
  durationMs: number;
  reducedMotion: 'static';
}

/** Visual theme from GET /api/v1/models/launches — client must not hardcode launch colors. */
export interface RainyModelLaunchPresentation {
  themeId: string;
  accent: string;
  gradient: RainyModelLaunchPresentationGradient;
  surface: string;
  onSurface: string;
  muted: string;
  animation: RainyModelLaunchPresentationAnimation;
}

export interface RainyModelLaunchSelection {
  mode: "auto";
  groupBy: "family" | "none";
  availableCtaLabel: string;
  stagedCtaLabel: string;
  allowPreviewSelection?: boolean;
}

export interface RainyModelLaunch {
  id: string;
  status: RainyModelLaunchStatus;
  publishedAt: string;
  title: string;
  summary: string;
  variants: RainyModelLaunchVariant[];
  appControls: RainyModelLaunchAppControl[];
  pricing: RainyModelLaunchPricing;
  presentation: RainyModelLaunchPresentation;
  selection: RainyModelLaunchSelection;
  /** API-resolved UI specification. Synthesized from variants+selection for
   *  backward compat when the server does not yet return this field. */
  ui: LaunchUi;
}

export function normalizeRainyServiceTier(
  value: unknown,
): RainyServiceTier {
  if (value === 'flex' || value === 'priority' || value === 'scale') {
    return value;
  }
  // Provider aliases: default/auto map to our Standard (omit field) path.
  return 'standard';
}

export function getRainyServiceTierOptions(
  entry?: RainyModelCatalogEntry | null,
  extraValues?: readonly string[] | null,
): RainyServiceTier[] {
  const tiers = entry?.pricing?.service_tiers ?? entry?.pricing?.serviceTier;
  const supported = new Set<RainyServiceTier>(['standard']);

  if (tiers && tiers.length > 0) {
    for (const tier of tiers) {
      supported.add(normalizeRainyServiceTier(tier.tier));
    }
  }

  if (extraValues) {
    for (const value of extraValues) {
      const normalized = normalizeRainyServiceTier(value);
      if (normalized !== 'standard' || value === 'standard' || value === 'default') {
        supported.add(normalized);
      }
      // Listed non-standard values from launch controls.
      if (value === 'flex' || value === 'priority' || value === 'scale') {
        supported.add(value);
      }
    }
  }

  return (['standard', 'flex', 'priority', 'scale'] as RainyServiceTier[]).filter(
    (tier) => supported.has(tier),
  );
}

export function modelSupportsServiceTiers(
  entry?: RainyModelCatalogEntry | null,
  extraValues?: readonly string[] | null,
) {
  return getRainyServiceTierOptions(entry, extraValues).length > 1;
}
