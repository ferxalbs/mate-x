import type { Tool } from '../tool-service';
import { ToolRateLimiter } from './tool-rate-limiter';

type CredentialProvider = 'github' | 'npm' | 'slack';

const validatorRateLimiter = new ToolRateLimiter('creds_validator', 10, 60_000);
const circuitOpenMs = 2 * 60_000;
const circuitFailuresBeforeOpen = 3;
const circuitStateByService = new Map<
  CredentialProvider,
  { consecutiveFailures: number; openedAt?: number }
>();

function rateLimitedResult(retryAfterMs: number) {
  return JSON.stringify({
    error: 'RATE_LIMITED',
    retryAfterMs,
    message: `creds_validator is rate-limited. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
  });
}

function circuitOpenResult(service: CredentialProvider) {
  return JSON.stringify({
    error: 'CIRCUIT_OPEN',
    service,
    message: `External API unavailable. Circuit open for ${service}.`,
  });
}

function isCircuitOpen(service: CredentialProvider) {
  const state = circuitStateByService.get(service);
  if (!state?.openedAt) return false;

  if (Date.now() - state.openedAt < circuitOpenMs) {
    return true;
  }

  circuitStateByService.set(service, { consecutiveFailures: 0 });
  return false;
}

function recordExternalSuccess(service: CredentialProvider) {
  circuitStateByService.set(service, { consecutiveFailures: 0 });
}

function recordExternalFailure(service: CredentialProvider) {
  const state = circuitStateByService.get(service) ?? { consecutiveFailures: 0 };
  const consecutiveFailures = state.consecutiveFailures + 1;
  circuitStateByService.set(service, {
    consecutiveFailures,
    openedAt: consecutiveFailures >= circuitFailuresBeforeOpen ? Date.now() : state.openedAt,
  });
}

function isExternalFailureStatus(status: number) {
  return status === 429 || status >= 500;
}

function checkExternalPreflight(service: CredentialProvider) {
  if (isCircuitOpen(service)) {
    return circuitOpenResult(service);
  }

  const rateLimit = validatorRateLimiter.check();
  if (!rateLimit.allowed) {
    return rateLimitedResult(rateLimit.retryAfterMs);
  }

  validatorRateLimiter.record();
  return null;
}

export const credsValidatorTool: Tool = {
  name: 'creds_validator',
  description: 'Actively validates leaked secrets/tokens against provider APIs (GitHub, AWS, etc) to confirm critical impact.',
  parameters: {
    type: 'object',
    properties: {
      provider: {
        type: 'string',
        description: 'The service provider (e.g., "github", "npm", "slack").',
      },
      token: {
        type: 'string',
        description: 'The raw secret or token to validate.',
      },
    },
    required: ['provider', 'token'],
  },
  async execute(args) {
    const { provider, token } = args;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      switch (provider.toLowerCase()) {
        case 'github': {
          const blocked = checkExternalPreflight('github');
          if (blocked) return blocked;
          const res = await fetch('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'MaTE-X-Sec-Auditor' },
            signal: controller.signal
          });
          if (isExternalFailureStatus(res.status)) recordExternalFailure('github');
          else recordExternalSuccess('github');
          if (res.status === 200) {
            const data = await res.json();
            return `🚨 CRITICAL: GitHub Token is ACTIVE.\nBelongs to user: ${data.login} (${data.email || 'no public email'}).\nScopes: ${res.headers.get('x-oauth-scopes') || 'unknown'}`;
          }
          return `Token is INVALID or REVOKED (HTTP ${res.status}). Falso positivo.`;
        }
        case 'npm': {
          const blocked = checkExternalPreflight('npm');
          if (blocked) return blocked;
          const res = await fetch('https://registry.npmjs.org/-/whoami', {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal
          });
          if (isExternalFailureStatus(res.status)) recordExternalFailure('npm');
          else recordExternalSuccess('npm');
          if (res.status === 200) {
            const data = await res.json();
            return `🚨 CRITICAL: NPM Token is ACTIVE.\nBelongs to user: ${data.username}\nCan publish packages!`;
          }
          return `Token is INVALID or REVOKED (HTTP ${res.status}).`;
        }
        case 'slack': {
            const blocked = checkExternalPreflight('slack');
            if (blocked) return blocked;
            const res = await fetch('https://slack.com/api/auth.test', {
                headers: { Authorization: `Bearer ${token}` },
                signal: controller.signal
            });
            if (isExternalFailureStatus(res.status)) recordExternalFailure('slack');
            else recordExternalSuccess('slack');
            const data = await res.json();
            if (data.ok) {
                return `🚨 CRITICAL: Slack Token is ACTIVE.\nWorkspace: ${data.team}\nUser: ${data.user}`;
            }
            return `Token is INVALID or REVOKED.`;
        }
        default:
          return `Validation for provider '${provider}' is not natively supported yet. Recommend using http_prober to test it manually.`;
      }
    } catch (error: any) {
      const normalizedProvider = typeof provider === 'string' ? provider.toLowerCase() : '';
      if (normalizedProvider === 'github' || normalizedProvider === 'npm' || normalizedProvider === 'slack') {
        recordExternalFailure(normalizedProvider);
      }
      if (error.name === 'AbortError') return `Request timed out. Provider might be blocking or offline.`;
      return `Error validating token: ${error.message}`;
    } finally {
      clearTimeout(timeout);
    }
  },
};
