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

async function loadSettingsOptions(): Promise<Partial<PrivacyFirewallOptions>> {
  try {
    const settings = await tursoService.getAppSettings();
    return {
      mode: settings.privacyFirewallEnabled ? settings.privacyMode : "off",
      placeholderStyle: settings.privacyPlaceholderStyle,
      scanModel: settings.privacyUseOnnxModel,
      scanRegex: settings.privacyUseRegex,
      blockP0CloudSend: settings.privacyBlockP0CloudSend,
      minModelConfidence: settings.privacyMinModelConfidence,
    };
  } catch {
    return {};
  }
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
    context: { workspaceId?: string; runId?: string; inputKind?: string; persist?: boolean } = {},
  ): Promise<PrivacyScanResult> {
    const startedAt = Date.now();
    const resolved = { ...DEFAULT_OPTIONS, ...(await loadSettingsOptions()), ...options };

    if (resolved.mode === "off") {
      return {
        originalLength: text.length,
        redactedText: text,
        spans: [],
        blocked: false,
        stats: { totalSpans: 0, p0Count: 0, modelCount: 0, regexCount: 0, elapsedMs: Date.now() - startedAt },
      };
    }

    let modelSpans: PrivacySpan[] = [];
    let modelError: string | undefined;
    if (resolved.scanModel) {
      const result = await scanWithOnnx(text);
      modelSpans = result.spans.filter((span) => span.confidence >= resolved.minModelConfidence);
      modelError = result.error;
    }

    const regexSpans = resolved.scanRegex ? scanWithRegex(text, context.workspaceId) : [];
    const spans = postprocessPrivacySpans(
      text,
      [...regexSpans, ...modelSpans],
      resolved,
      context.workspaceId,
    );
    const redactedText = redactText(text, spans);
    const p0Count = spans.filter((span) => span.risk === "p0").length;
    const blocked =
      resolved.mode === "strict" &&
      ((resolved.blockP0CloudSend && p0Count > 0 && redactedText === text) ||
        (resolved.scanModel && Boolean(modelError) && !resolved.scanRegex));
    const elapsedMs = Date.now() - startedAt;

    const scan: PrivacyScanResult = {
      originalLength: text.length,
      redactedText,
      spans,
      blocked,
      blockReason: blocked ? "Privacy Firewall blocked unsafe outbound context." : undefined,
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

    return scan;
  }

  async scanTextSafe(text: string): Promise<PrivacySafeScanResult> {
    return blankSpanText(
      await this.scanText(text, { mode: "review", placeholderStyle: "typed" }, { persist: false, inputKind: "debug" }),
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
    const outboundOptions = { ...DEFAULT_OPTIONS, ...(await loadSettingsOptions()) };

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
        { mode: "strict", placeholderStyle: "typed", scanRegex: true, scanModel: false },
        { ...context, inputKind: context.inputKind ?? "outbound_model_payload" },
      );
      aggregateSpans.push(...scan.spans);
      elapsedMs += scan.stats.elapsedMs;

      let redactedText = scan.redactedText;
      for (const span of scan.spans) {
        if (isSecretLikeP0(span) && span.text.length >= 8 && redactedText.includes(span.text)) {
          redactedText = redactedText.split(span.text).join(span.replacement);
        }
      }

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
