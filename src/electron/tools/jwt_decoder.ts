import type { Tool } from '../tool-service';

export const jwtDecoderTool: Tool = {
  name: 'jwt_decoder',
  description: 'Decode and inspect a JWT or Base64Url token. Useful for checking claims, roles, and detecting insecure algorithms like "none".',
  parameters: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description: 'The raw JWT string to decode.',
      },
    },
    required: ['token'],
  },
  async execute(args) {
    const { token } = args;
    if (!token || typeof token !== 'string') return 'Invalid token format.';

    const parts = token.split('.');
    if (parts.length !== 3) {
      return `Warning: Token does not appear to be a standard JWT (expected 3 parts, got ${parts.length}).`;
    }

    try {
      const headerStr = Buffer.from(parts[0], 'base64url').toString('utf8');
      const payloadStr = Buffer.from(parts[1], 'base64url').toString('utf8');
      
      let header, payload;
      try { header = JSON.parse(headerStr); } catch (_e) { header = headerStr; }
      try { payload = JSON.parse(payloadStr); } catch (_e) { payload = payloadStr; }

      let analysis = '';
      if (header?.alg && header.alg.toLowerCase() === 'none') {
        analysis += '\n🚨 CRITICAL VULNERABILITY: Token uses "alg: none" which bypasses signature verification.\n';
      }
      
      const isExpired = payload?.exp && payload.exp * 1000 < Date.now();
      if (isExpired) {
        analysis += '\n⚠️ WARNING: Token is expired.\n';
      }

      return `### JWT Decode Result\n\n**Header:**\n\`\`\`json\n${JSON.stringify(header, null, 2)}\n\`\`\`\n\n**Payload:**\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n${analysis}`;
    } catch (error) {
      return `Failed to decode JWT: ${(error as Error).message}`;
    }
  },
};
