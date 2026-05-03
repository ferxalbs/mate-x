import type {
  PrivacyFirewallOptions,
  PrivacySafeScanResult,
  PrivacySanitizeResult,
  PrivacyScanResult,
  PrivacySpan,
} from "./privacy-types";
import { scanWithRegex } from "./privacy-regex-scanner";
import { scanWithOnnx } from "./privacy-onnx-scanner";
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

function blankSpanText(result: PrivacyScanResult): PrivacySafeScanResult {
  return {
    ...result,
    spans: result.spans.map(({ text: _text, ...span }) => span),
  };
}

function collectStrings(value: unknown, output: string[]) {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, output));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, output));
  }
}

function replaceStrings(value: unknown, replacements: Map<string, string>): unknown {
  if (typeof value === "string") {
    return replacements.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceStrings(item, replacements));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceStrings(item, replacements)]),
    );
  }
  return value;
}

export class PrivacyFirewallService {
  async scanText(
    text: string,
    options: Partial<PrivacyFirewallOptions> = {},
    context: { workspaceId?: string; runId?: string; inputKind?: string; persist?: boolean } = {},
  ): Promise<PrivacyScanResult> {
    const startedAt = Date.now();
    const resolved = { ...DEFAULT_OPTIONS, ...options };

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

  async sanitizeOutboundModelPayload<T>(
    payload: T,
    context: { workspaceId?: string; runId?: string; inputKind?: string } = {},
  ): Promise<PrivacySanitizeResult<T>> {
    const strings: string[] = [];
    collectStrings(payload, strings);
    const replacements = new Map<string, string>();
    const aggregateSpans: PrivacySpan[] = [];
    let blocked = false;
    let reason: string | undefined;
    let elapsedMs = 0;

    for (const value of strings) {
      const scan = await this.scanText(
        value,
        { mode: "strict", placeholderStyle: "typed", scanRegex: true, scanModel: false },
        { ...context, inputKind: context.inputKind ?? "outbound_model_payload" },
      );
      replacements.set(value, scan.redactedText);
      aggregateSpans.push(...scan.spans);
      blocked = blocked || scan.blocked;
      reason = reason ?? scan.blockReason;
      elapsedMs += scan.stats.elapsedMs;
    }

    const sanitizedPayload = replaceStrings(payload, replacements) as T;
    const serialized = JSON.stringify(sanitizedPayload);
    for (const span of aggregateSpans) {
      if (span.risk === "p0" && span.text && serialized.includes(span.text)) {
        blocked = true;
        reason = "Privacy Firewall outbound assertion failed.";
        break;
      }
    }

    const scan: PrivacyScanResult = {
      originalLength: strings.reduce((sum, item) => sum + item.length, 0),
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

export const privacyFirewall = new PrivacyFirewallService();
