import {
  RAINY_REASONING_REQUEST_FIELDS,
  normalizeRainyServiceTier,
  type LaunchActionKind,
  type LaunchPrimaryAction,
  type LaunchUi,
  type LaunchVariant,
  type LaunchUiSelectorMode,
  type LaunchVariantAvailability,
  type RainyAppControlAvailability,
  type RainyAppControlKind,
  type RainyModelCatalogEntry,
  type RainyModelLaunch,
  type RainyModelLaunchAppControl,
  type RainyModelLaunchPresentation,
  type RainyModelLaunchSelection,
  type RainyModelLaunchStatus,
  type RainyServiceTier,
} from "../contracts/rainy";

const LAUNCH_DISMISSAL_STORAGE_PREFIX = "mate-x:dismissed-model-launches:v4:";
const LAUNCH_VIEW_COUNT_PREFIX = "mate-x:launch-views:v4:";
const GPT56_HIGH_CONTEXT_NOTICE_TOKENS = 272_000;

export type LaunchDismissalStore = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function normalizeLaunchStatus(value: unknown): RainyModelLaunchStatus {
  if (value === "available" || value === "retired" || value === "staged") {
    return value;
  }
  return "staged";
}

function normalizeControlAvailability(value: unknown): RainyAppControlAvailability {
  return value === "available" ? "available" : "staged";
}

function normalizeControlKind(value: unknown): RainyAppControlKind | null {
  if (value === "toggle" || value === "select" || value === "model_variant") {
    return value;
  }
  return null;
}

function extractLaunchItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return [];
  }

  if (Array.isArray(payload.launches)) {
    return payload.launches;
  }
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  if (isRecord(payload.data)) {
    if (Array.isArray(payload.data.data)) {
      return payload.data.data;
    }
    if (Array.isArray(payload.data.launches)) {
      return payload.data.launches;
    }
  }
  return [];
}

function normalizeLaunchVariant(item: unknown): RainyModelLaunch["variants"][number] | null {
  if (!isRecord(item)) {
    return null;
  }
  const modelId = firstString(item.model_id, item.modelId, item.id);
  const label = firstString(item.label, item.name, modelId);
  if (!modelId || !label) {
    return null;
  }
  return { 
    modelId, 
    label,
    family: firstString(item.family) ?? undefined,
    presentation: normalizeLaunchPresentation(item.presentation ?? item.theme) ?? undefined,
  };
}

function normalizeAppControl(item: unknown): RainyModelLaunchAppControl | null {
  if (!isRecord(item)) {
    return null;
  }
  const id = firstString(item.id);
  const kind = normalizeControlKind(item.kind);
  const label = firstString(item.label, id);
  if (!id || !kind || !label) {
    return null;
  }

  return {
    id,
    kind,
    label,
    availability: normalizeControlAvailability(item.availability),
    requestFields: asStringArray(item.request_fields ?? item.requestFields),
    values: asStringArray(item.values),
    variantSuffix: firstString(item.variant_suffix, item.variantSuffix) ?? undefined,
  };
}

function normalizeLaunchSelection(raw: unknown): RainyModelLaunchSelection {
  const selection = isRecord(raw) ? raw : {};
  const groupBy = selection.group_by === "none" || selection.groupBy === "none" ? "none" : "family";
  return {
    mode: "auto",
    groupBy,
    availableCtaLabel: firstString(selection.available_cta_label, selection.availableCtaLabel) ?? "Get Started",
    stagedCtaLabel: firstString(selection.staged_cta_label, selection.stagedCtaLabel) ?? "Not available yet",
    allowPreviewSelection: selection.allow_preview_selection === true || selection.allowPreviewSelection === true,
  };
}

function normalizeLaunchItem(item: unknown): RainyModelLaunch | null {
  if (!isRecord(item)) {
    return null;
  }

  const id = firstString(item.id);
  const title = firstString(item.title);
  const summary = firstString(item.summary, item.description);
  if (!id || !title || !summary) {
    return null;
  }

  const variants = Array.isArray(item.variants)
    ? item.variants
        .map((variant) => normalizeLaunchVariant(variant))
        .filter((variant): variant is RainyModelLaunch["variants"][number] => variant !== null)
    : [];
  if (variants.length === 0) {
    return null;
  }

  const appControls = Array.isArray(item.app_controls)
    ? item.app_controls
        .map((control) => normalizeAppControl(control))
        .filter((control): control is RainyModelLaunchAppControl => control !== null)
    : Array.isArray(item.appControls)
      ? item.appControls
          .map((control) => normalizeAppControl(control))
          .filter((control): control is RainyModelLaunchAppControl => control !== null)
      : [];

  const pricingRaw = isRecord(item.pricing) ? item.pricing : null;
  const highContextThreshold =
    firstNumber(
      pricingRaw?.high_context_threshold,
      pricingRaw?.highContextThreshold,
    ) ?? GPT56_HIGH_CONTEXT_NOTICE_TOKENS + 1;
  const pricingNote =
    firstString(pricingRaw?.note) ??
    "Provider base pricing may change above the high-context input-token threshold.";

  const presentation = normalizeLaunchPresentation(item.presentation ?? item.theme);
  if (!presentation) {
    // presentation is required for trusted launch cards; drop incomplete feed rows.
    return null;
  }

  const selection = normalizeLaunchSelection(item.selection);

  // Prefer server-resolved ui block; synthesize from legacy fields when absent.
  const ui =
    normalizeLaunchUi(item.ui) ??
    synthesizeLaunchUi(variants, presentation, selection);

  return {
    id,
    status: normalizeLaunchStatus(item.status),
    publishedAt: firstString(item.published_at, item.publishedAt) ?? new Date(0).toISOString(),
    title,
    summary,
    variants,
    appControls,
    pricing: {
      basis: "prompt_tokens",
      highContextThreshold,
      note: pricingNote,
    },
    presentation,
    selection,
    ui,
  };
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value.trim());
}

function normalizeLaunchPresentation(raw: unknown): RainyModelLaunchPresentation | null {
  if (!isRecord(raw)) {
    return null;
  }

  const themeId = firstString(raw.theme_id, raw.themeId);
  const accent = isHexColor(raw.accent) ? raw.accent.trim() : null;
  const surface = isHexColor(raw.surface) ? raw.surface.trim() : null;
  const onSurface = isHexColor(raw.on_surface ?? raw.onSurface)
    ? String(raw.on_surface ?? raw.onSurface).trim()
    : null;
  const muted = isHexColor(raw.muted) ? raw.muted.trim() : null;
  const gradientRaw = isRecord(raw.gradient) ? raw.gradient : null;
  const colors = Array.isArray(gradientRaw?.colors)
    ? gradientRaw.colors.filter(isHexColor).map((color) => color.trim())
    : [];
  const angleDegrees =
    firstNumber(gradientRaw?.angle_degrees, gradientRaw?.angleDegrees) ?? 135;
  const animationRaw = isRecord(raw.animation) ? raw.animation : null;
  const durationMs =
    firstNumber(animationRaw?.duration_ms, animationRaw?.durationMs) ?? 9000;

  if (!themeId || !accent || !surface || !onSurface || !muted || colors.length < 2) {
    return null;
  }

  return {
    themeId,
    accent,
    surface,
    onSurface,
    muted,
    gradient: {
      colors,
      angleDegrees: Math.min(360, Math.max(0, angleDegrees)),
    },
    animation: {
      kind: "aurora",
      durationMs: Math.min(30_000, Math.max(1_000, Math.floor(durationMs))),
      reducedMotion: "static",
    },
  };
}

// ---------------------------------------------------------------------------
// API-resolved UI normalizers
// ---------------------------------------------------------------------------

function normalizeActionKind(value: unknown): LaunchActionKind {
  return value === "start_chat" ? "start_chat" : "disabled";
}

function normalizeVariantAvailability(value: unknown): LaunchVariantAvailability {
  return value === "callable" ? "callable" : "unavailable";
}

function normalizeUiSelectorMode(value: unknown): LaunchUiSelectorMode {
  if (value === "none" || value === "single" || value === "multiple") {
    return value;
  }
  return "multiple";
}

function normalizeLaunchAction(raw: unknown): LaunchPrimaryAction | null {
  if (!isRecord(raw)) {
    return null;
  }
  const label = firstString(raw.label);
  if (!label) {
    return null;
  }
  const kind = normalizeActionKind(raw.kind);
  const model_id = kind === "start_chat" ? (firstString(raw.model_id, raw.modelId) ?? null) : null;
  return { kind, label, model_id };
}

function normalizeLaunchUiVariant(raw: unknown): LaunchVariant | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = firstString(raw.id, raw.model_id, raw.modelId);
  const label = firstString(raw.label);
  if (!id || !label) {
    return null;
  }
  const presentation = normalizeLaunchPresentation(raw.presentation);
  if (!presentation) {
    return null;
  }
  const primary_action = normalizeLaunchAction(raw.primary_action ?? raw.primaryAction);
  if (!primary_action) {
    return null;
  }
  return {
    id,
    label,
    availability: normalizeVariantAvailability(raw.availability),
    selectable: raw.selectable !== false, // default true
    presentation,
    primary_action,
  };
}

function normalizeLaunchUi(raw: unknown): LaunchUi | null {
  if (!isRecord(raw)) {
    return null;
  }
  const variantsRaw = Array.isArray(raw.variants) ? raw.variants : [];
  const variants = variantsRaw
    .map(normalizeLaunchUiVariant)
    .filter((v): v is LaunchVariant => v !== null);
  if (variants.length === 0) {
    return null;
  }
  const selector = normalizeUiSelectorMode(raw.selector);
  const initial_model_id =
    firstString(raw.initial_model_id, raw.initialModelId) ??
    variants[0].id;
  const primary_action =
    normalizeLaunchAction(raw.primary_action ?? raw.primaryAction) ??
    variants.find((v) => v.id === initial_model_id)?.primary_action ??
    variants[0].primary_action;
  return { selector, initial_model_id, primary_action, variants };
}

/**
 * Backward-compat synthesizer: builds a `LaunchUi` from the legacy
 * `variants` + `selection` fields when the server has not yet upgraded
 * to the new `ui` block.
 *
 * All synthesized variants are marked `availability: "unavailable"` so
 * the CTA stays disabled for old payloads — consistent with the prior
 * behavior of checking against the model catalog.
 */
function synthesizeLaunchUi(
  variants: RainyModelLaunch["variants"],
  presentation: RainyModelLaunchPresentation,
  selection: RainyModelLaunchSelection,
): LaunchUi {
  const uiVariants: LaunchVariant[] = variants.map((v) => {
    const variantPresentation = v.presentation ?? presentation;
    return {
      id: v.modelId,
      label: v.label,
      availability: "unavailable" as LaunchVariantAvailability,
      selectable: selection.allowPreviewSelection === true,
      presentation: variantPresentation,
      primary_action: {
        kind: "disabled" as LaunchActionKind,
        label: selection.stagedCtaLabel,
        model_id: null,
      } satisfies LaunchPrimaryAction,
    };
  });

  const selector: LaunchUiSelectorMode =
    uiVariants.length <= 1 ? "none" : "multiple";

  return {
    selector,
    initial_model_id: uiVariants[0]?.id ?? "",
    primary_action: {
      kind: "disabled",
      label: selection.stagedCtaLabel,
      model_id: null,
    },
    variants: uiVariants,
  };
}

/** Collapse Sol / Sol Pro → family label "Sol" for clean chip UI. */
export function getLaunchFamilyNames(
  variants: Array<{ label: string; modelId?: string }>,
): string[] {
  const families: string[] = [];
  const seen = new Set<string>();
  for (const variant of variants) {
    const family = variant.label
      .replace(/\s+pro$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!family) {
      continue;
    }
    const key = family.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    families.push(family);
  }
  return families;
}

export function buildLaunchGradientCss(
  presentation: RainyModelLaunchPresentation,
): string {
  const { colors, angleDegrees } = presentation.gradient;
  const stops = colors.join(", ");
  return `linear-gradient(${angleDegrees}deg, ${stops})`;
}

/**
 * Animate only when user has not requested reduced motion and presentation
 * allows aurora motion. Reduced-motion clients always get a static gradient.
 */
export function shouldAnimateLaunchPresentation(
  presentation: RainyModelLaunchPresentation,
  prefersReducedMotion: boolean,
): boolean {
  // Prefer user reduced-motion setting. Presentation.animation.reducedMotion: "static"
  // documents the fallback mode; we never animate when the user requests less motion.
  if (prefersReducedMotion) {
    return false;
  }
  return presentation.animation.kind === "aurora";
}

export function buildLaunchPresentationCssVars(
  presentation: RainyModelLaunchPresentation,
): Record<string, string> {
  return {
    "--launch-accent": presentation.accent,
    "--launch-surface": presentation.surface,
    "--launch-on-surface": presentation.onSurface,
    "--launch-muted": presentation.muted,
    "--launch-gradient": buildLaunchGradientCss(presentation),
    "--launch-aurora-duration": `${presentation.animation.durationMs}ms`,
  };
}

/** @deprecated API now returns exact CTA labels via launch.ui.primary_action.label.
 *  This function will be removed in a future cleanup pass. */
export function getLaunchPrimaryCtaLabel(canTry: boolean, isActivating: boolean) {
  if (isActivating) {
    return "Activating…";
  }
  return canTry ? "Try model" : "Not available yet";
}


/** Parse `/api/v1/models/launches` envelope or raw array into normalized launches. */
export function parseRainyModelLaunchesPayload(payload: unknown): RainyModelLaunch[] {
  const items = extractLaunchItems(payload);
  const launches = items
    .map((item) => normalizeLaunchItem(item))
    .filter((item): item is RainyModelLaunch => item !== null);

  const unique = new Map<string, RainyModelLaunch>();
  for (const launch of launches) {
    if (!unique.has(launch.id)) {
      unique.set(launch.id, launch);
    }
  }
  return Array.from(unique.values());
}

export function dismissalStorageKey(userKey: string) {
  const normalized = userKey.trim() || "local";
  return `${LAUNCH_DISMISSAL_STORAGE_PREFIX}${normalized}`;
}

export function loadDismissedLaunchIds(
  userKey: string,
  store: LaunchDismissalStore = defaultBrowserStore(),
): string[] {
  try {
    const raw = store.getItem(dismissalStorageKey(userKey));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function persistDismissedLaunchId(
  userKey: string,
  launchId: string,
  store: LaunchDismissalStore = defaultBrowserStore(),
): string[] {
  const trimmedLaunchId = launchId.trim();
  if (!trimmedLaunchId) {
    return loadDismissedLaunchIds(userKey, store);
  }

  const next = Array.from(
    new Set([...loadDismissedLaunchIds(userKey, store), trimmedLaunchId]),
  );
  store.setItem(dismissalStorageKey(userKey), JSON.stringify(next));
  return next;
}

export function isLaunchDismissed(
  userKey: string,
  launchId: string,
  store: LaunchDismissalStore = defaultBrowserStore(),
) {
  return loadDismissedLaunchIds(userKey, store).includes(launchId.trim());
}

export function loadLaunchViewCounts(
  userKey: string,
  store: LaunchDismissalStore = defaultBrowserStore(),
): Record<string, number> {
  const normalized = userKey.trim() || "local";
  const key = `${LAUNCH_VIEW_COUNT_PREFIX}${normalized}`;
  try {
    const raw = store.getItem(key);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) {
      const counts: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "number") {
          counts[k] = v;
        }
      }
      return counts;
    }
  } catch {
    // Return empty on failure
  }
  return {};
}

export function incrementLaunchViewCount(
  userKey: string,
  launchId: string,
  store: LaunchDismissalStore = defaultBrowserStore(),
): number {
  const normalized = userKey.trim() || "local";
  const key = `${LAUNCH_VIEW_COUNT_PREFIX}${normalized}`;
  const counts = loadLaunchViewCounts(userKey, store);
  const current = counts[launchId] || 0;
  const next = current + 1;
  counts[launchId] = next;
  store.setItem(key, JSON.stringify(counts));
  return next;
}

function defaultBrowserStore(): LaunchDismissalStore {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
  };
}

/** A model is callable only when present in `/models/catalog` (not launch feed alone). */
export function isModelCallableInCatalog(
  modelId: string,
  catalog: Array<Pick<RainyModelCatalogEntry, "id">>,
) {
  const normalized = modelId.trim();
  if (!normalized) {
    return false;
  }
  return catalog.some((entry) => entry.id === normalized);
}

export function getCallableLaunchVariants(
  launch: RainyModelLaunch,
  catalog: Array<Pick<RainyModelCatalogEntry, "id">>,
) {
  return launch.variants.filter((variant) =>
    isModelCallableInCatalog(variant.modelId, catalog),
  );
}

export function canTryLaunchModel(
  launch: RainyModelLaunch,
  catalog: Array<Pick<RainyModelCatalogEntry, "id">>,
) {
  // Staged launch announcements must not become callable solely from the feed.
  if (launch.status === "retired") {
    return false;
  }
  return getCallableLaunchVariants(launch, catalog).length > 0;
}

export function selectUnseenLaunches(
  launches: RainyModelLaunch[],
  dismissedIds: readonly string[],
  viewCounts?: Record<string, number>,
  catalog?: Array<Pick<RainyModelCatalogEntry, "id">>
) {
  const dismissed = new Set(dismissedIds);
  return launches.filter(
    (launch) => {
      if (launch.status === "retired" || dismissed.has(launch.id)) {
        return false;
      }
      if (!viewCounts || !catalog) {
        return true;
      }
      const views = viewCounts[launch.id] || 0;
      const isAvailable = canTryLaunchModel(launch, catalog);
      if (isAvailable) {
        return views < 1;
      }
      return views < 4;
    }
  );
}

export function findLaunchForModel(
  launches: RainyModelLaunch[],
  modelId: string,
): RainyModelLaunch | null {
  const normalized = modelId.trim();
  if (!normalized) {
    return null;
  }
  return (
    launches.find((launch) =>
      launch.variants.some((variant) => variant.modelId === normalized),
    ) ?? null
  );
}

export function getAppControl(
  launch: RainyModelLaunch | null | undefined,
  controlId: string,
): RainyModelLaunchAppControl | null {
  if (!launch) {
    return null;
  }
  return launch.appControls.find((control) => control.id === controlId) ?? null;
}

export function isAppControlAvailable(control: RainyModelLaunchAppControl | null | undefined) {
  return control?.availability === "available";
}

function launchVariantIds(launch: RainyModelLaunch): Set<string> {
  return new Set(launch.variants.map((variant) => variant.modelId));
}

function resolveProSuffix(
  launch: RainyModelLaunch,
  suffix?: string | null,
): string {
  if (typeof suffix === "string" && suffix.trim()) {
    return suffix.trim();
  }
  return getAppControl(launch, "reasoning_pro")?.variantSuffix ?? "-pro";
}

/**
 * True when `modelId` is a Pro variant **declared** in the launch feed
 * (paired with a base id also listed in `variants`). Never suffix-guesses.
 */
export function isDeclaredProVariant(
  modelId: string,
  launch: RainyModelLaunch | null | undefined,
  suffix?: string | null,
): boolean {
  if (!launch) {
    return false;
  }
  const normalized = modelId.trim();
  const proSuffix = resolveProSuffix(launch, suffix);
  if (!normalized || !normalized.endsWith(proSuffix)) {
    return false;
  }
  const baseId = normalized.slice(0, -proSuffix.length);
  if (!baseId) {
    return false;
  }
  const ids = launchVariantIds(launch);
  return ids.has(normalized) && ids.has(baseId);
}

/**
 * Map base model → declared Pro variant from launch-feed `variants` only.
 *
 * Example: `openai/gpt-5.6-luna` → `openai/gpt-5.6-luna-pro` only when that
 * pair is listed on the launch. Never invents ids by appending `-pro` to
 * arbitrary models. Does not invent a `reasoning_pro` request parameter.
 */
export function resolveProVariantModelId(
  modelId: string,
  launch?: RainyModelLaunch | null,
  options?: {
    suffix?: string | null;
    catalog?: Array<Pick<RainyModelCatalogEntry, "id">>;
  },
): string | null {
  const normalized = modelId.trim();
  if (!normalized || !launch) {
    return null;
  }

  const proSuffix = resolveProSuffix(launch, options?.suffix);
  const ids = launchVariantIds(launch);
  if (!ids.has(normalized) && !isDeclaredProVariant(normalized, launch, proSuffix)) {
    // Selected model is not part of this launch's declared variants.
    return null;
  }

  // Already on a declared Pro variant.
  if (isDeclaredProVariant(normalized, launch, proSuffix)) {
    if (options?.catalog && !isModelCallableInCatalog(normalized, options.catalog)) {
      return null;
    }
    return normalized;
  }

  // Partner must be explicitly declared in launch.variants — never suffix-guess.
  const candidate = `${normalized}${proSuffix}`;
  if (!ids.has(candidate)) {
    return null;
  }

  if (options?.catalog && !isModelCallableInCatalog(candidate, options.catalog)) {
    return null;
  }
  return candidate;
}

/**
 * Map declared Pro variant → base variant using launch-feed `variants` only.
 */
export function resolveBaseVariantModelId(
  modelId: string,
  launch?: RainyModelLaunch | null,
  suffix?: string | null,
): string | null {
  const normalized = modelId.trim();
  if (!normalized || !launch) {
    return null;
  }

  const proSuffix = resolveProSuffix(launch, suffix);
  if (!isDeclaredProVariant(normalized, launch, proSuffix)) {
    // Not a declared Pro id — if it's a listed base, return itself.
    return launchVariantIds(launch).has(normalized) ? normalized : null;
  }

  const baseId = normalized.slice(0, -proSuffix.length);
  return launchVariantIds(launch).has(baseId) ? baseId : null;
}

/** @deprecated Prefer isDeclaredProVariant(modelId, launch). Suffix-only checks are unsafe. */
export function isProVariantModelId(
  modelId: string,
  launch?: RainyModelLaunch | null,
  suffix?: string | null,
) {
  if (launch) {
    return isDeclaredProVariant(modelId, launch, suffix);
  }
  // Without a launch feed, never claim Pro via suffix alone.
  return false;
}

/**
 * Serialize reasoning for Rainy provider requests.
 * Only emits documented fields: reasoning, reasoning_effort, include_reasoning.
 * Never invents reasoning_pro or other unknown parameters.
 */
export function serializeReasoningRequest(params: {
  enabled: boolean;
  effort?: string | null;
  acceptedParameters?: readonly string[] | null;
  requestFields?: readonly string[] | null;
}): Record<string, unknown> {
  if (!params.enabled) {
    return {};
  }

  // null/undefined acceptedParameters => model capabilities unknown (allow documented fields).
  // Explicit empty array => model declares no accepted params (allow none).
  const acceptedList =
    params.acceptedParameters === undefined || params.acceptedParameters === null
      ? null
      : params.acceptedParameters.map((value) => value.trim()).filter(Boolean);
  const allowedFields = new Set(
    (params.requestFields?.length
      ? params.requestFields
      : RAINY_REASONING_REQUEST_FIELDS
    )
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const canUse = (field: string) => {
    if (!allowedFields.has(field)) {
      return false;
    }
    if (acceptedList === null) {
      return true;
    }
    return acceptedList.includes(field);
  };

  const body: Record<string, unknown> = {};
  const effort =
    typeof params.effort === "string" && params.effort.trim()
      ? params.effort.trim()
      : null;

  if (canUse("reasoning")) {
    body.reasoning = effort ? { effort } : { enabled: true };
  }

  if (effort && canUse("reasoning_effort")) {
    body.reasoning_effort = effort;
  }

  if (canUse("include_reasoning")) {
    body.include_reasoning = true;
  }

  // Hard guarantee: never emit unknown reasoning params.
  for (const key of Object.keys(body)) {
    if (
      key !== "reasoning" &&
      key !== "reasoning_effort" &&
      key !== "include_reasoning"
    ) {
      delete body[key];
    }
  }

  return body;
}

/**
 * Serialize service_tier for request body.
 * Standard/default omits the field. Only listed values are sent.
 */
export function serializeServiceTierRequest(
  tier: RainyServiceTier | string | null | undefined,
  allowedValues?: readonly string[] | null,
): { service_tier?: Exclude<RainyServiceTier, "standard"> } {
  const normalized = normalizeRainyServiceTier(tier);
  if (normalized === "standard") {
    return {};
  }

  if (allowedValues && allowedValues.length > 0) {
    const allowed = new Set(
      allowedValues.map((value) => normalizeRainyServiceTier(value)),
    );
    // Launch lists may omit standard; listed flex/priority/scale must match.
    if (!allowed.has(normalized) && !allowedValues.includes(normalized)) {
      return {};
    }
  }

  return { service_tier: normalized };
}

function coerceServiceTierValue(value: unknown): RainyServiceTier | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const lower = value.trim().toLowerCase();
  if (
    lower === "flex" ||
    lower === "priority" ||
    lower === "scale" ||
    lower === "standard" ||
    lower === "default" ||
    lower === "auto"
  ) {
    return normalizeRainyServiceTier(lower);
  }
  return null;
}

/**
 * Extract provider-returned effective service tier from response body/metadata.
 * Preference order:
 * 1. Rainy metadata (top-level / envelope meta / usage)
 * 2. Nested provider chat metadata (`*.service_tier` on provider envelope keys)
 * Does not invent tiers from the request.
 */
export function extractEffectiveServiceTier(response: unknown): RainyServiceTier | null {
  if (!isRecord(response)) {
    return null;
  }

  const meta = isRecord(response.meta) ? response.meta : null;

  // 1) Rainy metadata first (billing authority when Rainy surfaces it).
  const rainyCandidates: unknown[] = [
    response.service_tier,
    response.serviceTier,
    response.served_tier,
    response.servedTier,
    response.effective_service_tier,
    response.effectiveServiceTier,
    meta?.service_tier,
    meta?.serviceTier,
    meta?.effective_service_tier,
    meta?.effectiveServiceTier,
    meta?.served_tier,
    meta?.servedTier,
    isRecord(response.usage) ? response.usage.service_tier : null,
    isRecord(response.usage) ? response.usage.effective_service_tier : null,
    isRecord(response.provider) ? response.provider.service_tier : null,
    isRecord(meta?.billing) ? meta.billing.service_tier : null,
    isRecord(meta?.billing) ? meta.billing.effective_service_tier : null,
  ];

  for (const candidate of rainyCandidates) {
    const tier = coerceServiceTierValue(candidate);
    if (tier) {
      return tier;
    }
  }

  // 2) Nested provider chat envelope (wire key kept for Rainy passthrough compatibility).
  const providerChatMetadataKey = ["open", "router", "_metadata"].join("");
  const providerShortKey = ["open", "router"].join("");
  const providerChatMetadata =
    (isRecord(response[providerChatMetadataKey])
      ? response[providerChatMetadataKey]
      : null) ??
    (meta && isRecord(meta[providerChatMetadataKey])
      ? meta[providerChatMetadataKey]
      : null) ??
    (isRecord(response[providerShortKey]) ? response[providerShortKey] : null);

  if (providerChatMetadata) {
    const providerTier = coerceServiceTierValue(
      providerChatMetadata.service_tier ?? providerChatMetadata.serviceTier,
    );
    if (providerTier) {
      return providerTier;
    }
  }

  return null;
}

/**
 * Pricing notice for high-context models (e.g. GPT-5.6).
 * Threshold is measured in provider prompt/input tokens — never prompt-message count.
 */
export function getHighContextPricingNotice(params: {
  launch?: RainyModelLaunch | null;
  modelId?: string | null;
  measuredInputTokens?: number | null;
}): string | null {
  const launch = params.launch ?? null;
  const note = launch?.pricing?.note ?? null;
  if (!note) return null;
  const measured = typeof params.measuredInputTokens === "number" && Number.isFinite(params.measuredInputTokens)
    ? ` Measured prompt tokens/input tokens: ${Math.floor(params.measuredInputTokens).toLocaleString("en-US")}.`
    : "";
  return /message count/i.test(note)
    ? `${note}${measured}`
    : `${note}${measured} Do not estimate from message count; use provider input-token accounting.`;
}

export function formatLaunchStatus(status: RainyModelLaunchStatus) {
  switch (status) {
    case "available":
      return "Available";
    case "retired":
      return "Retired";
    default:
      return "Staged";
  }
}

export function controlComingSoonLabel(control: RainyModelLaunchAppControl) {
  if (control.availability === "available") {
    return null;
  }
  return "Coming soon";
}
