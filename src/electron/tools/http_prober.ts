import type { Tool } from '../tool-service';

export const httpProberTool: Tool = {
  name: 'http_prober',
  description: 'Make an HTTP request to dynamically probe an endpoint (e.g., localhost APIs). Allows testing for XSS/SQLi dynamically.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The exact URL to probe (e.g., "http://localhost:5173/api/data"). Infer the port from the project stack.',
      },
      method: {
        type: 'string',
        description: 'HTTP method (GET, POST, PUT, DELETE). Defaults to GET.',
      },
      headers: {
        type: 'string',
        description: 'JSON string of headers to send.',
      },
      body: {
        type: 'string',
        description: 'Stringified body content for POST/PUT requests.',
      },
    },
    required: ['url'],
  },
  async execute(args) {
    const { url, method = 'GET', headers = '{}', body } = args;
    
    let parsedHeaders = {};
    try { parsedHeaders = JSON.parse(headers); } catch (_e) { /* ignore */ }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    try {
      const res = await fetch(url, {
        method,
        headers: parsedHeaders,
        body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      let preview = text.substring(0, 1500);
      if (text.length > 1500) preview += `\n... (truncated ${text.length - 1500} characters)`;

      return `Status: ${res.status} ${res.statusText}\nHeaders: ${JSON.stringify(Object.fromEntries(res.headers.entries()))}\nBody:\n${preview}`;
    } catch (error: any) {
      if (error.name === 'AbortError') return `Request timed out after 5000ms.`;
      return `Error probing ${url}: ${error.message}`;
    } finally {
      clearTimeout(timeout);
    }
  },
};
