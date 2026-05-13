import { BrowserWindow, session } from "electron";
import type { Tool } from "../tool-service";

// ─── Types ────────────────────────────────────────────────────────────────────

type WaitFor = "load" | "domcontentloaded" | "networkidle";

interface ProbeResult {
  url: string;
  final_url: string;
  status_code: number | null;
  response_headers: Record<string, string>;
  console_logs: ConsoleLine[];
  intercepted_requests: RequestRecord[];
  cookies: CookieRecord[];
  script_result: unknown;
  screenshot_base64: string | null;
  error: string | null;
  elapsed_ms: number;
}

interface ConsoleLine {
  level: string;
  message: string;
}

interface RequestRecord {
  method: string;
  url: string;
  resource_type: string;
}

interface CookieRecord {
  name: string;
  domain: string;
  path: string;
  secure: boolean;
  http_only: boolean;
  same_site: string;
  session: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a promise that resolves after `ms` milliseconds. */
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Polls until all in-flight network requests have settled (≤ 2 concurrent),
 * or until the outer timeout fires.
 */
async function waitForNetworkIdle(
  win: BrowserWindow,
  idleThresholdMs = 500,
  maxWaitMs = 5000,
): Promise<void> {
  let inFlight = 0;
  let idleSince = Date.now();
  const deadline = Date.now() + maxWaitMs;

  const onRequest = (): void => {
    inFlight++;
    idleSince = Infinity;
  };
  const onFinished = (): void => {
    inFlight = Math.max(0, inFlight - 1);
    if (inFlight <= 2) idleSince = Date.now();
  };

  win.webContents.session.webRequest.onBeforeRequest(onRequest);
  win.webContents.session.webRequest.onCompleted(onFinished);
  win.webContents.session.webRequest.onErrorOccurred(onFinished);

  try {
    while (Date.now() < deadline) {
      if (inFlight <= 2 && Date.now() - idleSince >= idleThresholdMs) break;
      await sleep(50);
    }
  } finally {
    // Remove listeners by passing null filter and empty handler
    win.webContents.session.webRequest.onBeforeRequest(null as never);
    win.webContents.session.webRequest.onCompleted(null as never);
    win.webContents.session.webRequest.onErrorOccurred(null as never);
  }
}

/** Waits for `did-finish-load` on webContents. */
function waitForLoad(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    win.webContents.once("did-finish-load", () => resolve());
  });
}

/** Waits for `dom-ready` on webContents. */
function waitForDomReady(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    win.webContents.once("dom-ready", () => resolve());
  });
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const browserProberTool: Tool = {
  name: "browser_prober",
  description:
    "Headless Electron browser that loads a URL in an isolated, ephemeral session and returns " +
    "a structured probe report. Captures: HTTP status + response headers, outbound request log, " +
    "cookies, browser console output, optional DOM script result, and optional screenshot. " +
    "Ideal for DOM XSS testing, CSP inspection, cookie security audits, tracking pixel detection, " +
    "and dynamic frontend security analysis. All probes run in a sandboxed offscreen window with " +
    "no shared state between runs.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The fully-qualified URL to navigate to (http/https).",
      },
      script: {
        type: "string",
        description:
          "Optional JavaScript to execute in the page after it loads. " +
          "Must return a value (string, object, or array). " +
          "If omitted, only metadata is collected.",
      },
      wait_for: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle"],
        description:
          '"load" — waits for the window load event (default). ' +
          '"domcontentloaded" — faster, stops at DOMContentLoaded. ' +
          '"networkidle" — waits until ≤2 in-flight requests remain.',
      },
      timeout_ms: {
        type: "number",
        description:
          "Hard timeout in milliseconds. Default: 15000. Max: 60000.",
      },
      capture_screenshot: {
        type: "boolean",
        description:
          "If true, captures a PNG screenshot and returns it as a base64 string.",
      },
      intercept_requests: {
        type: "boolean",
        description:
          "If true, records all outbound network requests (URL, method, resource type) made during the probe.",
      },
      extract_cookies: {
        type: "boolean",
        description:
          "If true, extracts all cookies visible to the page after load.",
      },
    },
    required: ["url"],
  },

  async execute(args): Promise<string> {
    const url = args.url as string;
    const script = (args.script as string | undefined) ?? null;
    const waitFor: WaitFor = (args.wait_for as WaitFor | undefined) ?? "load";
    const timeoutMs = Math.min(
      Math.max(Number(args.timeout_ms ?? 15000), 1000),
      60000,
    );
    const captureScreenshot = args.capture_screenshot === true;
    const interceptRequests = args.intercept_requests === true;
    const extractCookies = args.extract_cookies === true;

    const startMs = Date.now();
    const result: ProbeResult = {
      url,
      final_url: url,
      status_code: null,
      response_headers: {},
      console_logs: [],
      intercepted_requests: [],
      cookies: [],
      script_result: null,
      screenshot_base64: null,
      error: null,
      elapsed_ms: 0,
    };

    // Ephemeral session — no shared state between probes
    const probeSession = session.fromPartition(
      `probe:${Date.now()}:${Math.random()}`,
      {
        cache: false,
      },
    );

    // Disable caching for clean cold probes
    probeSession.setProxy({ mode: "direct" });

    let win: BrowserWindow | null = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        offscreen: true,
        session: probeSession,
        webSecurity: true,
        allowRunningInsecureContent: false,
        javascript: true,
      },
    });

    // ── Console capture ────────────────────────────────────────────────────────
    win.webContents.on("console-message", (_e, level, message) => {
      const levelMap: Record<number, string> = {
        0: "verbose",
        1: "info",
        2: "warning",
        3: "error",
      };
      result.console_logs.push({
        level: levelMap[level] ?? "unknown",
        message,
      });
    });

    // ── Request interception ──────────────────────────────────────────────────
    if (interceptRequests) {
      probeSession.webRequest.onBeforeRequest((details, callback) => {
        result.intercepted_requests.push({
          method: details.method,
          url: details.url,
          resource_type: details.resourceType ?? "unknown",
        });
        callback({ cancel: false });
      });
    }

    // ── Response headers capture ──────────────────────────────────────────────
    const mainFrameHeaders: Record<string, string> = {};
    let mainFrameStatus: number | null = null;

    probeSession.webRequest.onHeadersReceived((details, callback) => {
      // Only capture the main frame (navigational) response
      if (details.resourceType === "mainFrame") {
        mainFrameStatus = details.statusCode;
        for (const [key, values] of Object.entries(
          details.responseHeaders ?? {},
        )) {
          mainFrameHeaders[key.toLowerCase()] = Array.isArray(values)
            ? values[0]
            : values;
        }
      }
      callback({ responseHeaders: details.responseHeaders });
    });

    return new Promise<string>((resolve) => {
      const finish = async (err?: string): Promise<void> => {
        clearTimeout(hardTimeout);
        result.elapsed_ms = Date.now() - startMs;
        if (err) result.error = err;

        if (win && !win.isDestroyed()) {
          // ── Screenshot ──────────────────────────────────────────────────────
          if (captureScreenshot && !err) {
            try {
              const image = await win.webContents.capturePage();
              result.screenshot_base64 = image.toPNG().toString("base64");
            } catch {
              // Non-fatal — screenshot failure does not abort the probe
            }
          }

          // ── Cookies ─────────────────────────────────────────────────────────
          if (extractCookies) {
            try {
              const raw = await probeSession.cookies.get({ url });
              result.cookies = raw.map((c) => ({
                name: c.name,
                domain: c.domain ?? "",
                path: c.path ?? "/",
                secure: c.secure ?? false,
                http_only: c.httpOnly ?? false,
                same_site: c.sameSite ?? "unspecified",
                session: c.session ?? true,
              }));
            } catch {
              // Non-fatal
            }
          }

          win.destroy();
          win = null;
        }

        result.status_code = mainFrameStatus;
        result.response_headers = mainFrameHeaders;
        if (result.final_url === url) {
          try {
            // Attempt to pick up final URL after redirects
            // (already captured in did-navigate; this is a safety fallback)
          } catch {
            /* ignore */
          }
        }

        resolve(formatProbeResult(result));
      };

      // ── Hard timeout ────────────────────────────────────────────────────────
      const hardTimeout = setTimeout(() => {
        finish("Probe timed out after " + timeoutMs + "ms.");
      }, timeoutMs);

      // ── Navigation error ────────────────────────────────────────────────────
      win!.webContents.on(
        "did-fail-load",
        (_e, errorCode, errorDescription, failedUrl) => {
          // Ignore cancelled (code -3) — can fire on redirects
          if (errorCode === -3) return;
          finish(
            `Failed to load "${failedUrl}": ${errorDescription} (code ${errorCode})`,
          );
        },
      );

      // ── Redirect tracking ───────────────────────────────────────────────────
      win!.webContents.on("did-navigate", (_e, navUrl) => {
        result.final_url = navUrl;
      });

      // ── Main load flow ──────────────────────────────────────────────────────
      win!
        .loadURL(url)
        .then(async () => {
          if (!win || win.isDestroyed()) return;

          try {
            // Wait strategy
            if (waitFor === "domcontentloaded") {
              await waitForDomReady(win);
            } else if (waitFor === "networkidle") {
              await waitForLoad(win);
              await waitForNetworkIdle(win, 500, Math.min(timeoutMs / 2, 5000));
            } else {
              // 'load' — loadURL already resolves after did-finish-load
            }

            // ── Script execution ───────────────────────────────────────────────
            if (script && win && !win.isDestroyed()) {
              try {
                const scriptResult = await win.webContents.executeJavaScript(`
                  (async () => {
                    try {
                      ${script}
                    } catch (err) {
                      return { __error: err.message };
                    }
                  })();
                `);
                result.script_result = scriptResult;
              } catch (err: unknown) {
                result.script_result = {
                  __error: err instanceof Error ? err.message : String(err),
                };
              }
            }

            await finish();
          } catch (err: unknown) {
            await finish(err instanceof Error ? err.message : String(err));
          }
        })
        .catch(async (err: unknown) => {
          await finish(
            `Navigation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    });
  },
};

// ─── Output formatter ─────────────────────────────────────────────────────────

function formatProbeResult(r: ProbeResult): string {
  const lines: string[] = [];
  const status = r.status_code !== null ? String(r.status_code) : "unknown";
  const redirectNote = r.final_url !== r.url ? ` → ${r.final_url}` : "";

  lines.push(`═══ Browser Probe Report ═══`);
  lines.push(`URL        : ${r.url}${redirectNote}`);
  lines.push(`Status     : ${status}`);
  lines.push(`Elapsed    : ${r.elapsed_ms}ms`);

  if (r.error) {
    lines.push(`Error      : ${r.error}`);
  }

  // Response headers
  if (Object.keys(r.response_headers).length > 0) {
    lines.push("");
    lines.push("── Response Headers ──");
    // Surface security-relevant headers first
    const SECURITY_HEADERS = [
      "content-security-policy",
      "content-security-policy-report-only",
      "strict-transport-security",
      "x-frame-options",
      "x-content-type-options",
      "permissions-policy",
      "cross-origin-opener-policy",
      "cross-origin-embedder-policy",
      "referrer-policy",
      "set-cookie",
    ];
    const all = Object.entries(r.response_headers);
    const security = all.filter(([k]) => SECURITY_HEADERS.includes(k));
    const rest = all.filter(([k]) => !SECURITY_HEADERS.includes(k));

    if (security.length > 0) {
      lines.push("  [Security-Relevant]");
      for (const [k, v] of security) lines.push(`    ${k}: ${v}`);
    }
    if (rest.length > 0) {
      lines.push("  [Other]");
      for (const [k, v] of rest) lines.push(`    ${k}: ${v}`);
    }
  }

  // Missing security headers
  const EXPECTED_SECURITY = [
    "content-security-policy",
    "strict-transport-security",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
  ];
  const missing = EXPECTED_SECURITY.filter((h) => !(h in r.response_headers));
  if (missing.length > 0) {
    lines.push("");
    lines.push("── Missing Security Headers ──");
    for (const h of missing) lines.push(`  ⚠️  ${h}`);
  }

  // Script result
  if (r.script_result !== null) {
    lines.push("");
    lines.push("── Script Result ──");
    const raw =
      typeof r.script_result === "object"
        ? JSON.stringify(r.script_result, null, 2)
        : String(r.script_result);
    lines.push(raw);
  }

  // Console logs
  if (r.console_logs.length > 0) {
    lines.push("");
    lines.push(`── Console (${r.console_logs.length} entries) ──`);
    const ICON: Record<string, string> = {
      error: "🔴",
      warning: "🟡",
      info: "🔵",
      verbose: "⚪",
    };
    for (const entry of r.console_logs) {
      lines.push(
        `  ${ICON[entry.level] ?? "⬜"} [${entry.level}] ${entry.message}`,
      );
    }
  }

  // Intercepted requests
  if (r.intercepted_requests.length > 0) {
    lines.push("");
    lines.push(`── Outbound Requests (${r.intercepted_requests.length}) ──`);
    const byType = groupBy(r.intercepted_requests, (rr) => rr.resource_type);
    for (const [type, reqs] of Object.entries(byType)) {
      lines.push(`  [${type}]`);
      for (const req of reqs.slice(0, 20)) {
        lines.push(`    ${req.method} ${req.url}`);
      }
      if (reqs.length > 20) lines.push(`    … and ${reqs.length - 20} more`);
    }

    // Third-party origins
    const mainOrigin = new URL(r.url).origin;
    const thirdParty = r.intercepted_requests.filter((rr) => {
      try {
        return new URL(rr.url).origin !== mainOrigin;
      } catch {
        return false;
      }
    });
    if (thirdParty.length > 0) {
      const origins = [
        ...new Set(
          thirdParty.map((rr) => {
            try {
              return new URL(rr.url).origin;
            } catch {
              return rr.url;
            }
          }),
        ),
      ];
      lines.push("");
      lines.push(`  Third-party origins contacted (${origins.length}):`);
      for (const o of origins) lines.push(`    • ${o}`);
    }
  }

  // Cookies
  if (r.cookies.length > 0) {
    lines.push("");
    lines.push(`── Cookies (${r.cookies.length}) ──`);
    for (const c of r.cookies) {
      const flags: string[] = [];
      if (c.secure) flags.push("Secure");
      if (c.http_only) flags.push("HttpOnly");
      if (c.same_site !== "unspecified") flags.push(`SameSite=${c.same_site}`);
      if (c.session) flags.push("Session");
      lines.push(
        `  ${c.name} [${c.domain}${c.path}] ${flags.join(", ") || "NO FLAGS ⚠️"}`,
      );
    }

    // Cookie security audit
    const insecure = r.cookies.filter((c) => !c.secure || !c.http_only);
    if (insecure.length > 0) {
      lines.push("");
      lines.push("  ⚠️  Cookies missing security flags:");
      for (const c of insecure) {
        const missing2: string[] = [];
        if (!c.secure) missing2.push("Secure");
        if (!c.http_only) missing2.push("HttpOnly");
        lines.push(`    ${c.name}: missing ${missing2.join(", ")}`);
      }
    }
  }

  // Screenshot notice
  if (r.screenshot_base64) {
    lines.push("");
    lines.push(`── Screenshot ──`);
    lines.push(
      `  Captured (${Math.round((r.screenshot_base64.length * 0.75) / 1024)}KB PNG, base64-encoded)`,
    );
    lines.push(`  data:image/png;base64,${r.screenshot_base64.slice(0, 64)}…`);
  }

  return lines.join("\n");
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const k = key(item);
    (result[k] ??= []).push(item);
  }
  return result;
}
