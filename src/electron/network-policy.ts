import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import type { WorkspaceTrustContract } from "../contracts/workspace";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const BROWSER_LOCAL_PROTOCOLS = new Set(["about:", "blob:", "data:"]);
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
]);
const METADATA_HOSTNAMES = new Set([
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "instance-data.ec2.internal",
]);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type NetworkAddressResolver = (hostname: string) => Promise<string[]>;

export interface NetworkUrlOptions {
  /** Allows non-network schemes used by a loaded browser document. */
  allowBrowserLocalProtocols?: boolean;
  /** Injected resolver keeps policy tests deterministic. */
  resolveHost?: NetworkAddressResolver;
}

export interface NetworkFetchOptions extends NetworkUrlOptions {
  /** Credential validators are the only built-in caller that needs this. */
  allowSensitiveHeaders?: boolean;
  maxResponseBytes?: number;
}

export class NetworkPolicyError extends Error {
  readonly code = "NETWORK_POLICY_BLOCKED";

  constructor(message: string) {
    super(message);
    this.name = "NetworkPolicyError";
  }
}

export const CREDENTIAL_PROVIDER_URLS = {
  github: "https://api.github.com/user",
  npm: "https://registry.npmjs.org/-/whoami",
  slack: "https://slack.com/api/auth.test",
} as const;

/**
 * Fast, synchronous validation used by the canonical capability resolver.
 * Runtime execution performs the authoritative DNS/IP check again.
 */
export function validateNetworkTargetForToolCall(
  toolName: string,
  args: Record<string, unknown>,
  contract: WorkspaceTrustContract,
): string | null {
  if (toolName === "http_prober" || toolName === "browser_prober") {
    if (typeof args.url !== "string" || args.url.trim().length === 0) {
      return `${toolName} requires a URL.`;
    }
    try {
      validateNetworkUrlSyntax(args.url, contract);
    } catch (error) {
      return error instanceof Error ? error.message : "Network URL is not allowed.";
    }
    return null;
  }

  if (toolName === "creds_validator") {
    const provider = typeof args.provider === "string" ? args.provider.toLowerCase() : "";
    const target = CREDENTIAL_PROVIDER_URLS[provider as keyof typeof CREDENTIAL_PROVIDER_URLS];
    if (!target) {
      return `Credential provider "${provider || "<empty>"}" is not supported.`;
    }
    try {
      validateNetworkUrlSyntax(target, contract);
    } catch (error) {
      return error instanceof Error ? error.message : "Credential provider domain is not allowed.";
    }
  }

  return null;
}

/**
 * Authorizes one URL, including hostname allowlisting and DNS resolution.
 * Every resolved address must be public; this prevents DNS aliases and
 * redirects from reaching loopback, RFC1918, link-local, or cloud metadata.
 */
export async function assertNetworkUrlAllowed(
  rawUrl: string,
  contract: WorkspaceTrustContract,
  options: NetworkUrlOptions = {},
): Promise<URL> {
  const url = parseNetworkUrl(rawUrl, options.allowBrowserLocalProtocols === true);
  if (BROWSER_LOCAL_PROTOCOLS.has(url.protocol)) return url;

  validateNetworkUrlSyntax(url.toString(), contract);
  const hostname = normalizeHostname(url.hostname);
  const addresses = isIP(hostname)
    ? [hostname]
    : await (options.resolveHost ?? resolveHost)(hostname);
  if (addresses.length === 0) {
    throw new NetworkPolicyError(`Network host "${hostname}" did not resolve.`);
  }
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new NetworkPolicyError(
        `Network target "${hostname}" resolves to a private or metadata address.`,
      );
    }
  }
  return url;
}

/**
 * Performs a policy-checked request without automatic redirects. The selected
 * DNS address is pinned into the socket lookup callback so the request cannot
 * silently re-resolve to a different address after policy validation.
 */
export async function fetchWithNetworkPolicy(
  rawUrl: string,
  init: RequestInit = {},
  contract: WorkspaceTrustContract,
  options: NetworkFetchOptions = {},
): Promise<Response> {
  const url = await assertNetworkUrlAllowed(rawUrl, contract, options);
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new NetworkPolicyError("Only HTTP and HTTPS requests are supported.");
  }

  const headers = new Headers(init.headers);
  if (options.allowSensitiveHeaders !== true) {
    for (const [name] of headers) {
      if (SENSITIVE_HEADER_NAMES.has(name.toLowerCase())) {
        throw new NetworkPolicyError(
          `Sensitive request header "${name}" is not allowed for this network operation.`,
        );
      }
    }
  }

  const hostname = normalizeHostname(url.hostname);
  const addresses = isIP(hostname)
    ? [hostname]
    : await (options.resolveHost ?? resolveHost)(hostname);
  const address = addresses[0];
  if (!address || isBlockedIp(address)) {
    throw new NetworkPolicyError(`Network target "${hostname}" is not public.`);
  }

  const body = toRequestBody(init.body);
  const method = String(init.method ?? (body ? "POST" : "GET")).toUpperCase();
  const requestHeaders = Object.fromEntries(headers.entries());
  if (body && !headers.has("content-length")) {
    requestHeaders["content-length"] = String(body.byteLength);
  }

  return requestPinnedAddress({
    url,
    address,
    method,
    headers: requestHeaders,
    body,
    signal: init.signal ?? undefined,
    maxResponseBytes: options.maxResponseBytes ?? MAX_RESPONSE_BYTES,
  });
}

export function isBlockedIp(rawAddress: string): boolean {
  const address = rawAddress.trim().replace(/^\[|\]$/g, "");
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    const [first, second] = octets;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0 && octets[2] === 0) ||
      (first === 198 && second >= 18 && second <= 19) ||
      (first === 198 && second === 51 && octets[2] === 100) ||
      (first === 203 && second === 0 && octets[2] === 113) ||
      first >= 224
    );
  }

  if (isIP(address) !== 6) return true;
  const hextets = expandIpv6(address);
  if (!hextets) return true;

  // IPv4-mapped IPv6 addresses must use the IPv4 policy above.
  if (
    hextets.slice(0, 5).every((value) => value === 0) &&
    hextets[5] === 0xffff
  ) {
    const mapped = [
      (hextets[6] >> 8) & 0xff,
      hextets[6] & 0xff,
      (hextets[7] >> 8) & 0xff,
      hextets[7] & 0xff,
    ].join(".");
    return isBlockedIp(mapped);
  }

  const first = hextets[0];
  const allZero = hextets.every((value) => value === 0);
  const loopback = hextets.slice(0, 7).every((value) => value === 0) && hextets[7] === 1;
  return (
    allZero ||
    loopback ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
  );
}

function validateNetworkUrlSyntax(
  rawUrl: string,
  contract: WorkspaceTrustContract,
): URL {
  const url = parseNetworkUrl(rawUrl, false);
  const hostname = normalizeHostname(url.hostname);
  if (isBlockedHostname(hostname) || (isIP(hostname) > 0 && isBlockedIp(hostname))) {
    throw new NetworkPolicyError(`Network host "${hostname}" is blocked.`);
  }
  if (!isAllowedDomain(hostname, contract.allowedDomains)) {
    throw new NetworkPolicyError(
      `Network host "${hostname}" is outside the workspace allowedDomains policy.`,
    );
  }
  return url;
}

function parseNetworkUrl(rawUrl: string, allowBrowserLocalProtocols: boolean): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new NetworkPolicyError("Network URL is invalid.");
  }

  if (url.username || url.password) {
    throw new NetworkPolicyError("Network URLs may not contain embedded credentials.");
  }
  if (
    !ALLOWED_PROTOCOLS.has(url.protocol) &&
    !(allowBrowserLocalProtocols && BROWSER_LOCAL_PROTOCOLS.has(url.protocol))
  ) {
    throw new NetworkPolicyError(`Network protocol "${url.protocol}" is not allowed.`);
  }
  return url;
}

function isBlockedHostname(hostname: string): boolean {
  return (
    METADATA_HOSTNAMES.has(hostname) ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  );
}

function isAllowedDomain(hostname: string, domains: string[]): boolean {
  return domains.some((domain) => {
    const normalized = domain.trim().toLowerCase().replace(/\.$/, "");
    return Boolean(normalized) &&
      (hostname === normalized || hostname.endsWith(`.${normalized}`));
  });
}

async function resolveHost(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function expandIpv6(address: string): number[] | null {
  const [left, right, ...rest] = address.split("::");
  if (rest.length > 0) return null;
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  if (leftParts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  if (rightParts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  const missing = 8 - leftParts.length - rightParts.length;
  if (missing < 0 || (address.includes("::") ? missing < 1 : missing !== 0)) {
    return null;
  }
  return [
    ...leftParts.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...rightParts.map((part) => Number.parseInt(part, 16)),
  ];
}

function toRequestBody(body: BodyInit | null | undefined): Buffer | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new NetworkPolicyError("Streaming request bodies are not supported by the network policy.");
}

function requestPinnedAddress(input: {
  url: URL;
  address: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
  signal?: AbortSignal;
  maxResponseBytes: number;
}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const requestModule = input.url.protocol === "https:" ? httpsRequest : httpRequest;
    const port = input.url.port
      ? Number(input.url.port)
      : input.url.protocol === "https:"
        ? 443
        : 80;
    const request = requestModule({
      protocol: input.url.protocol,
      hostname: input.address,
      port,
      method: input.method,
      path: `${input.url.pathname}${input.url.search}`,
      headers: {
        ...input.headers,
        host: input.url.host,
      },
      servername: input.url.hostname,
      lookup: (_hostname, _options, callback) => {
        callback(null, input.address, isIP(input.address));
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let received = 0;
      response.on("data", (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += bytes.byteLength;
        if (received > input.maxResponseBytes) {
          request.destroy(new NetworkPolicyError("Network response exceeded the safety limit."));
          return;
        }
        chunks.push(bytes);
      });
      response.on("end", () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else if (value !== undefined) {
            responseHeaders.set(name, String(value));
          }
        }
        resolve(
          new Response(Buffer.concat(chunks), {
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers: responseHeaders,
          }),
        );
      });
      response.on("error", reject);
    });

    const abort = () => request.destroy(new DOMException("The operation was aborted.", "AbortError"));
    if (input.signal?.aborted) {
      abort();
    } else {
      input.signal?.addEventListener("abort", abort, { once: true });
    }
    request.on("error", reject);
    request.once("close", () => input.signal?.removeEventListener("abort", abort));
    if (input.body) request.write(input.body);
    request.end();
  });
}
