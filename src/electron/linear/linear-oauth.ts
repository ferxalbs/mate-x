import { createHash, randomBytes } from "node:crypto";
import { LINEAR_OAUTH_SCOPES, type LinearOAuthConfiguration } from "../../contracts/linear-integration";

const AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const TOKEN_URL = "https://api.linear.app/oauth/token";
const REVOKE_URL = "https://api.linear.app/oauth/revoke";

export interface LinearTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string | string[];
  token_type: string;
}

export interface LinearOAuthAttempt {
  state: string;
  verifier: string;
  authorizeUrl: string;
}

export function requireMatchingLinearOAuthState(expected: string | null, actual: string): void {
  if (!expected || expected !== actual) {
    throw new Error("Linear authorization could not be verified. Start a new connection attempt.");
  }
}

export function linearOAuthCancellationMessage(error: string): string {
  return error === "access_denied"
    ? "Linear authorization was cancelled."
    : "Linear authorization did not complete. Try again.";
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

export function createLinearOAuthAttempt(config: LinearOAuthConfiguration): LinearOAuthAttempt {
  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", LINEAR_OAUTH_SCOPES.join(","));
  url.searchParams.set("actor", "app");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { state, verifier, authorizeUrl: url.toString() };
}

async function tokenRequest(body: URLSearchParams, fetchImpl: typeof fetch): Promise<LinearTokenResponse> {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Linear OAuth token request failed (${response.status})`);
  const token = (await response.json()) as Partial<LinearTokenResponse>;
  if (!token.access_token || !token.refresh_token || !token.expires_in) {
    throw new Error("Linear OAuth token response was incomplete");
  }
  return token as LinearTokenResponse;
}

export function exchangeLinearOAuthCode(input: {
  code: string;
  verifier: string;
  config: LinearOAuthConfiguration;
  fetchImpl?: typeof fetch;
}): Promise<LinearTokenResponse> {
  return tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.verifier,
    client_id: input.config.clientId,
    redirect_uri: input.config.redirectUri,
  }), input.fetchImpl ?? fetch);
}

export function refreshLinearOAuthToken(input: {
  refreshToken: string;
  clientId: string;
  fetchImpl?: typeof fetch;
}): Promise<LinearTokenResponse> {
  return tokenRequest(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  }), input.fetchImpl ?? fetch);
}

export async function revokeLinearOAuthToken(input: {
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const response = await (input.fetchImpl ?? fetch)(REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: input.token, token_type_hint: "refresh_token" }),
  });
  if (!response.ok && response.status !== 400) throw new Error(`Linear OAuth revoke request failed (${response.status})`);
}

export function normalizeLinearScopes(scope: string | string[]): string[] {
  return (Array.isArray(scope) ? scope : scope.split(/[ ,]+/)).filter(Boolean).sort();
}
