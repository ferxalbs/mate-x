import type { Tool } from '../tool-service';

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
          const res = await fetch('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'MaTE-X-Sec-Auditor' },
            signal: controller.signal
          });
          if (res.status === 200) {
            const data = await res.json();
            return `🚨 CRITICAL: GitHub Token is ACTIVE.\nBelongs to user: ${data.login} (${data.email || 'no public email'}).\nScopes: ${res.headers.get('x-oauth-scopes') || 'unknown'}`;
          }
          return `Token is INVALID or REVOKED (HTTP ${res.status}). Falso positivo.`;
        }
        case 'npm': {
          const res = await fetch('https://registry.npmjs.org/-/whoami', {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal
          });
          if (res.status === 200) {
            const data = await res.json();
            return `🚨 CRITICAL: NPM Token is ACTIVE.\nBelongs to user: ${data.username}\nCan publish packages!`;
          }
          return `Token is INVALID or REVOKED (HTTP ${res.status}).`;
        }
        case 'slack': {
            const res = await fetch('https://slack.com/api/auth.test', {
                headers: { Authorization: `Bearer ${token}` },
                signal: controller.signal
            });
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
      if (error.name === 'AbortError') return `Request timed out. Provider might be blocking or offline.`;
      return `Error validating token: ${error.message}`;
    } finally {
      clearTimeout(timeout);
    }
  },
};
