import type {
  PrivacyFirewallOptions,
  PrivacySafeScanResult,
  PrivacySanitizeResult,
  PrivacyScanResult,
  PrivacySpan,
} from "./privacy-types";
import { scanWithRegex } from "./privacy-regex-scanner";
import { scanWithOnnx } from "./privacy-onnx-scanner";
import { downloadPrivacyModelAssets, loadPrivacyModelStatus } from "./privacy-model-loader";
import { postprocessPrivacySpans } from "./privacy-postprocessor";
import { redactText } from "./privacy-redactor";
import { storePrivacySpans } from "./privacy-vault";
import { tursoService } from "../turso-service";

const DEFAULT_OPTIONS: PrivacyFirewallOptions = {
  mode: "review",
  placeholderStyle: "typed",
  scanModel: true,
  scanRegex: true,
  encryptVault: true,
  blockP0CloudSend: true,
  minModelConfidence: 0.5,
};

type LoadedPrivacyOptions = Partial<PrivacyFirewallOptions> & {
  settingsLoadFailed?: boolean;
};

const SETTINGS_CACHE_TTL_MS = 2_000;
let cachedSettings: LoadedPrivacyOptions | null = null;
let cachedSettingsAt = 0;

async function loadSettingsOptions(): Promise<LoadedPrivacyOptions> {
  const now = Date.now();
  if (cachedSettings && now - cachedSettingsAt < SETTINGS_CACHE_TTL_MS) {
    return cachedSettings;
  }

  try {
    const settings = await tursoService.getAppSettings();
    cachedSettings = {
      mode: settings.privacyFirewallEnabled ? settings.privacyMode : "off",
      placeholderStyle: settings.privacyPlaceholderStyle,
      scanModel: settings.privacyUseOnnxModel,
      scanRegex: settings.privacyUseRegex,
      blockP0CloudSend: settings.privacyBlockP0CloudSend,
      minModelConfidence: settings.privacyMinModelConfidence,
    };
  } catch {
    cachedSettings = { settingsLoadFailed: true };
  }

  cachedSettingsAt = now;
  return cachedSettings;
}

export function invalidatePrivacySettingsCache() {
  cachedSettings = null;
  cachedSettingsAt = 0;
}

function blankSpanText(result: PrivacyScanResult): PrivacySafeScanResult {
  return {
    ...result,
    spans: result.spans.map(({ text: _text, ...span }) => span),
  };
}

export class PrivacyFirewallService {
  async scanText(
    text: string,
    options: Partial<PrivacyFirewallOptions> = {},
    context: {
      workspaceId?: string;
      runId?: string;
      inputKind?: string;
      persist?: boolean;
      recordTelemetry?: boolean;
    } = {},
  ): Promise<PrivacyScanResult> {
    const startedAt = Date.now();
    const loadedOptions = await loadSettingsOptions();
    const resolved = { ...DEFAULT_OPTIONS, ...loadedOptions, ...options };

    if (resolved.mode === "off") {
      return {
        originalLength: text.length,
        redactedText: text,
        spans: [],
        blocked: false,
        stats: { totalSpans: 0, p0Count: 0, modelCount: 0, regexCount: 0, elapsedMs: Date.now() - startedAt },
      };
    }

    // Privacy Sentinel v0.15 ONNX always runs at full fidelity when enabled.
    // Performance optimizations apply only to regex pre-filters and settings caching.
    const [modelResult, regexSpans] = await Promise.all([
      resolved.scanModel
        ? scanWithOnnx(text)
            .then((result) => ({
              spans: result.spans.filter((span) => span.confidence >= resolved.minModelConfidence),
              error: result.error,
            }))
            .catch((error: unknown) => ({
              spans: [] as PrivacySpan[],
              error: error instanceof Error ? error.message : "Privacy model scan failed.",
            }))
        : Promise.resolve({ spans: [] as PrivacySpan[], error: undefined }),
      Promise.resolve(resolved.scanRegex ? scanWithRegex(text, context.workspaceId) : []),
    ]);
    const modelSpans = modelResult.spans;
    const modelError = modelResult.error;
    const spans = postprocessPrivacySpans(
      text,
      [...regexSpans, ...modelSpans],
      resolved,
      context.workspaceId,
    );
    const redactedText = redactText(text, spans);
    const p0Count = spans.filter((span) => span.risk === "p0").length;
    const strictCoverageFailed =
      loadedOptions.settingsLoadFailed ||
      (!resolved.scanRegex && !resolved.scanModel) ||
      (resolved.scanModel && Boolean(modelError) && !resolved.scanRegex);
    const blocked =
      resolved.mode === "strict" &&
      (strictCoverageFailed ||
        (resolved.blockP0CloudSend && p0Count > 0 && redactedText === text));
    const elapsedMs = Date.now() - startedAt;

    const scan: PrivacyScanResult = {
      originalLength: text.length,
      redactedText,
      spans,
      blocked,
      blockReason: blocked
        ? loadedOptions.settingsLoadFailed
          ? "Privacy Firewall settings could not be loaded."
          : !resolved.scanRegex && !resolved.scanModel
            ? "Privacy Firewall has no active scanner coverage."
            : "Privacy Firewall blocked unsafe outbound context."
        : undefined,
      stats: {
        totalSpans: spans.length,
        p0Count,
        modelCount: modelSpans.length,
        regexCount: regexSpans.length,
        elapsedMs,
      },
    };

    if (resolved.encryptVault && context.persist !== false && spans.length > 0) {
      await storePrivacySpans({ workspaceId: context.workspaceId, runId: context.runId, spans });
    }

    if (context.recordTelemetry !== false) {
      await tursoService.recordPrivacyScanEvent({
        id: `privacy-scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        workspaceId: context.workspaceId ?? "",
        runId: context.runId ?? null,
        inputKind: context.inputKind ?? "text",
        totalSpans: spans.length,
        p0Count,
        blocked,
        elapsedMs,
        createdAt: new Date().toISOString(),
      });
    }

    return scan;
  }

  async scanTextSafe(text: string): Promise<PrivacySafeScanResult> {
    return blankSpanText(
      await this.scanText(
        text,
        { mode: "review", placeholderStyle: "typed" },
        { persist: false, recordTelemetry: false, inputKind: "debug" },
      ),
    );
  }

  getModelStatus() {
    return loadPrivacyModelStatus();
  }

  downloadModel(onProgress?: Parameters<typeof downloadPrivacyModelAssets>[0]) {
    return downloadPrivacyModelAssets(onProgress);
  }

  clearVault() {
    return tursoService.clearPrivacyVault();
  }

  async sanitizeOutboundModelPayload<T>(
    payload: T,
    context: { workspaceId?: string; runId?: string; inputKind?: string } = {},
  ): Promise<PrivacySanitizeResult<T>> {
    const aggregateSpans: PrivacySpan[] = [];
    let blocked = false;
    let reason: string | undefined;
    let elapsedMs = 0;
    let originalLength = 0;
    const loadedOptions = await loadSettingsOptions();
    const outboundOptions = { ...DEFAULT_OPTIONS, ...loadedOptions };
    if (
      loadedOptions.settingsLoadFailed ||
      outboundOptions.mode === "off" ||
      (!outboundOptions.scanRegex && !outboundOptions.scanModel)
    ) {
      return {
        payload,
        blocked: true,
        reason: loadedOptions.settingsLoadFailed
          ? "Privacy Firewall settings could not be loaded."
          : "Privacy Firewall is not enabled with active scanner coverage.",
        scan: {
          originalLength: 0,
          redactedText: "",
          spans: [],
          blocked: true,
          blockReason: "Privacy Firewall is not enabled with active scanner coverage.",
          stats: { totalSpans: 0, p0Count: 0, modelCount: 0, regexCount: 0, elapsedMs: 0 },
        },
      };
    }

    const sanitizeValue = async (value: unknown): Promise<unknown> => {
      if (typeof value !== "string") {
        if (Array.isArray(value)) {
          return Promise.all(value.map((item) => sanitizeValue(item)));
        }

        if (value && typeof value === "object") {
          const entries = await Promise.all(
            Object.entries(value).map(async ([key, item]) => [key, await sanitizeValue(item)] as const),
          );
          return Object.fromEntries(entries);
        }

        return value;
      }

      originalLength += value.length;
      const scan = await this.scanText(
        value,
        {
          mode: "strict",
          placeholderStyle: "typed",
          scanRegex: outboundOptions.scanRegex,
          scanModel: outboundOptions.scanModel,
        },
        { ...context, inputKind: context.inputKind ?? "outbound_model_payload" },
      );
      aggregateSpans.push(...scan.spans);
      elapsedMs += scan.stats.elapsedMs;

      let redactedText = scan.redactedText;
      redactedText = repairP0Redaction(redactedText, scan.spans, context);

      for (const span of scan.spans) {
        if (
          outboundOptions.blockP0CloudSend &&
          isSecretLikeP0(span) &&
          span.text.length >= 8 &&
          redactedText.includes(span.text)
        ) {
          blocked = true;
          reason = "Privacy Firewall outbound assertion failed.";
          break;
        }
      }

      return redactedText;
    };

    const sanitizedPayload = (await sanitizeValue(payload)) as T;

    const scan: PrivacyScanResult = {
      originalLength,
      redactedText: "",
      spans: aggregateSpans,
      blocked,
      blockReason: reason,
      stats: {
        totalSpans: aggregateSpans.length,
        p0Count: aggregateSpans.filter((span) => span.risk === "p0").length,
        modelCount: aggregateSpans.filter((span) => span.source.includes("onnx")).length,
        regexCount: aggregateSpans.filter((span) => span.source.includes("regex")).length,
        elapsedMs,
      },
    };

    return { payload: sanitizedPayload, scan, blocked, reason };
  }
}

function repairP0Redaction(
  text: string,
  spans: PrivacySpan[],
  context: { workspaceId?: string; runId?: string; inputKind?: string },
) {
  let redactedText = text;
  for (const span of spans) {
    if (isSecretLikeP0(span) && span.text.length >= 8 && redactedText.includes(span.text)) {
      redactedText = redactedText.split(span.text).join("[SECRET]");
    }
  }

  const secondPassSpans = postprocessPrivacySpans(
    redactedText,
    scanWithRegex(redactedText, context.workspaceId),
    {
      ...DEFAULT_OPTIONS,
      mode: "strict",
      placeholderStyle: "simple",
      scanRegex: true,
      scanModel: false,
    },
    context.workspaceId,
  );
  redactedText = redactText(redactedText, secondPassSpans);
  for (const span of secondPassSpans) {
    if (isSecretLikeP0(span) && span.text.length >= 8 && redactedText.includes(span.text)) {
      redactedText = redactedText.split(span.text).join("[SECRET]");
    }
  }

  return redactedText;
}

function isSecretLikeP0(span: PrivacySpan) {
  return (
    span.risk === "p0" &&
    (
      span.label === "secret" ||
      span.label === "api_key" ||
      span.label === "auth_token" ||
      span.label === "session_cookie" ||
      span.label === "database_uri" ||
      span.label === "cloud_credential" ||
      span.label === "repo_secret" ||
      span.label === "payment_token" ||
      span.label === "personal_document_id"
    )
  );
}

export const privacyFirewall = new PrivacyFirewallService();
