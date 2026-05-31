import { createServer, Server } from 'node:http';
import type { Tool } from '../tool-service';
import { ToolRateLimiter } from './tool-rate-limiter';

// Global state to hold the ephemeral server
let activeServer: Server | null = null;
let caughtRequests: any[] = [];
let serverTimeout: NodeJS.Timeout | null = null;
let currentPort = 0;
let openServerCount = 0;

const listenerRateLimiter = new ToolRateLimiter('oob_listener', 5, 60_000);
const maxOpenServers = 3;

function rateLimitedResult(retryAfterMs: number) {
  return JSON.stringify({
    error: 'RATE_LIMITED',
    retryAfterMs,
    message: `oob_listener is rate-limited. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
  });
}

function closeActiveServer() {
  if (serverTimeout) clearTimeout(serverTimeout);
  serverTimeout = null;
  const server = activeServer;
  activeServer = null;
  currentPort = 0;
  if (server) {
    server.close();
  }
}

function decrementOpenServerCount() {
  openServerCount = Math.max(openServerCount - 1, 0);
}

export const oobListenerTool: Tool = {
  name: 'oob_listener',
  description: 'Out-Of-Band Listener. Starts an ephemeral local HTTP server to catch Blind SSRF/XSS callbacks. Use action="start" to open it, and action="check" to read caught requests.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '"start" to launch the listener. "check" to retrieve caught requests and stop the server.',
      },
    },
    required: ['action'],
  },
  async execute(args) {
    const { action } = args;

    if (action === 'start') {
      if (activeServer) {
        return `Server is already running on http://localhost:${currentPort}/`;
      }
      if (openServerCount >= maxOpenServers) {
        return JSON.stringify({
          error: 'LISTENER_CAP_REACHED',
          message: 'Maximum concurrent oob_listener servers reached (3). Close an existing listener first.',
        });
      }
      const rateLimit = listenerRateLimiter.check();
      if (!rateLimit.allowed) {
        return rateLimitedResult(rateLimit.retryAfterMs);
      }
      listenerRateLimiter.record();

      caughtRequests = [];
      activeServer = createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          caughtRequests.push({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: body.substring(0, 1000), // truncate for safety
            timestamp: new Date().toISOString()
          });
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('OK');
        });
      });

      return new Promise((resolve, reject) => {
        activeServer!.listen(0, '127.0.0.1', () => {
          const address = activeServer!.address() as any;
          currentPort = address.port;
          openServerCount += 1;
          
          // Auto-kill after 5 minutes to prevent dangling servers
          serverTimeout = setTimeout(() => {
            if (activeServer) {
              closeActiveServer();
            }
          }, 5 * 60 * 1000);

          resolve(`✅ OOB Listener started.\nUse this callback URL in your payloads: http://localhost:${currentPort}/\nWait for the target to trigger it, then call this tool again with action="check".`);
        });

        activeServer!.on('close', () => {
          decrementOpenServerCount();
        });

        activeServer!.on('error', (e) => {
          activeServer = null;
          reject(`Failed to start OOB listener: ${e.message}`);
        });
      });
    } 
    
    if (action === 'check') {
      if (!activeServer) {
        return 'No active OOB listener is running. Call with action="start" first.';
      }

      const results = [...caughtRequests];
      
      // Cleanup
      closeActiveServer();
      caughtRequests = [];

      if (results.length === 0) {
        return '🔴 No requests were caught. The vulnerability might not be present or triggered yet.\n(The server has been stopped).';
      }

      return `🚨 VULNERABILITY CONFIRMED! Caught ${results.length} Out-Of-Band request(s):\n\n${JSON.stringify(results, null, 2)}\n\n(The server has been stopped).`;
    }

    return 'Invalid action. Use "start" or "check".';
  },
};
