import type { Tool } from '../tool-service';
import { fetchWithNetworkPolicy } from "../network-policy";

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
  async execute(args, { trustContract, signal, approvedPolicyStopId }) {
    const { url, method = 'GET', headers = '{}', body } = args;
    if (!trustContract) {
      return "Error probing network target: workspace network policy is unavailable.";
    }

    let parsedHeaders: Record<string, string>;
    try {
      const candidate = JSON.parse(headers);
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return "Error probing network target: headers must be a JSON object.";
      }
      parsedHeaders = Object.fromEntries(
        Object.entries(candidate).map(([key, value]) => [key, String(value)]),
      );
    } catch (_e) {
      return "Error probing network target: headers must be valid JSON.";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      const res = await fetchWithNetworkPolicy(url, {
        method,
        headers: parsedHeaders,
        body: (method !== 'GET' && method !== 'HEAD') ? body : undefined,
        signal: controller.signal,
      }, trustContract, {
        // Generic HTTP probes may send sensitive headers only after the
        // canonical outbound-network approval has been consumed.
        allowSensitiveHeaders: Boolean(approvedPolicyStopId),
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
      signal?.removeEventListener("abort", abortFromCaller);
    }
  },
};
