import { lookup } from 'node:dns/promises';
import { Socket } from 'node:net';
import type { Tool } from '../tool-service';

const MAX_PORT_RANGE = 1024;
const MAX_CONCURRENT_CONNECTIONS = 32;
const CONNECTION_TIMEOUT_MS = 500;
const SCAN_TIMEOUT_MS = 60_000;

type PortTarget = { port: number, name: string };

export const localNetworkReconTool: Tool = {
  name: 'local_network_recon',
  description: 'Hyper-fast TCP port scanner for localhost to discover exposed internal services (Databases, Docker, Caches).',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(args = {}) {
    const host = typeof args.host === 'string' ? args.host : '127.0.0.1';
    const localhostError = await validateLocalhost(host);
    if (localhostError) {
      return JSON.stringify(localhostError);
    }

    // Common developer ports
    const commonPorts: PortTarget[] = [
      { port: 80, name: 'HTTP' },
      { port: 3000, name: 'Node/React Dev' },
      { port: 5173, name: 'Vite Dev' },
      { port: 8080, name: 'HTTP Alternate' },
      { port: 3306, name: 'MySQL' },
      { port: 5432, name: 'PostgreSQL' },
      { port: 6379, name: 'Redis' },
      { port: 27017, name: 'MongoDB' },
      { port: 2375, name: 'Docker API' },
      { port: 9200, name: 'Elasticsearch' },
      { port: 11211, name: 'Memcached' },
    ];

    const rangeError = validatePortRange(args);
    if (rangeError) {
      return JSON.stringify(rangeError);
    }

    const targetPorts = getTargetPorts(args, commonPorts);
    const results: string[] = [];
    let scannedCount = 0;
    let timedOut = false;
    const activeSockets = new Set<Socket>();

    const scanPort = (portObj: PortTarget) => {
      return new Promise<void>((resolve) => {
        const socket = new Socket();
        let settled = false;
        activeSockets.add(socket);
        socket.setTimeout(CONNECTION_TIMEOUT_MS);

        const finish = () => {
          if (settled) return;
          settled = true;
          scannedCount++;
          activeSockets.delete(socket);
          resolve();
        };

        socket.on('connect', () => {
          results.push(`[OPEN] Port ${portObj.port} (${portObj.name}) is actively listening.`);
          socket.destroy();
        });

        socket.on('timeout', () => {
          socket.destroy();
        });

        socket.on('error', () => {
          // Connection refused = closed
          socket.destroy();
        });

        socket.on('close', () => {
          finish();
        });

        socket.connect(portObj.port, host);
      });
    };

    const scan = async () => {
      for (let i = 0; i < targetPorts.length && !timedOut; i += MAX_CONCURRENT_CONNECTIONS) {
        await Promise.all(targetPorts.slice(i, i + MAX_CONCURRENT_CONNECTIONS).map(scanPort));
      }
      return false;
    };

    let deadlineHandle: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<true>((resolve) => {
      deadlineHandle = setTimeout(() => {
        timedOut = true;
        for (const socket of activeSockets) {
          socket.destroy();
        }
        resolve(true);
      }, SCAN_TIMEOUT_MS);
    });

    const hitDeadline = await Promise.race([scan(), deadline]);
    if (deadlineHandle) {
      clearTimeout(deadlineHandle);
    }
    if (hitDeadline) {
      return JSON.stringify({
        partial: true,
        reason: 'SCAN_TIMEOUT',
        scannedCount,
        totalRequested: targetPorts.length,
        results,
      });
    }

    if (results.length === 0) {
      return 'No common developer services found listening on localhost.';
    }

    return `🕵️ Local Network Recon Results:\n\n${results.join('\n')}\n\nWARNING: Ensure these internal services do not use default credentials.`;
  },
};

function validatePortRange(args: Record<string, unknown>) {
  const hasStartPort = args.startPort !== undefined;
  const hasEndPort = args.endPort !== undefined;
  if (!hasStartPort && !hasEndPort) return null;

  if (!Number.isInteger(args.startPort) || !Number.isInteger(args.endPort)) {
    return {
      error: 'INVALID_PORT_RANGE',
      message: 'startPort and endPort must be integers between 1 and 65535.',
    };
  }

  const startPort = args.startPort as number;
  const endPort = args.endPort as number;
  if (startPort < 1 || startPort > 65535 || endPort < 1 || endPort > 65535 || endPort < startPort) {
    return {
      error: 'INVALID_PORT_RANGE',
      message: 'startPort and endPort must be integers between 1 and 65535, and endPort must be greater than or equal to startPort.',
    };
  }

  const requested = endPort - startPort + 1;
  if (requested > MAX_PORT_RANGE) {
    return {
      error: 'RANGE_TOO_LARGE',
      maxAllowed: MAX_PORT_RANGE,
      requested,
      message: 'Port scan range exceeds maximum allowed (1024 ports). Narrow the range.',
    };
  }

  return null;
}

function getTargetPorts(args: Record<string, unknown>, commonPorts: PortTarget[]) {
  if (!Number.isInteger(args.startPort) || !Number.isInteger(args.endPort)) {
    return commonPorts;
  }

  const targetPorts: PortTarget[] = [];
  for (let port = args.startPort as number; port <= (args.endPort as number); port++) {
    targetPorts.push({ port, name: 'Unknown' });
  }
  return targetPorts;
}

async function validateLocalhost(host: string) {
  try {
    const { address } = await lookup(host);
    if (address === '::1' || address.startsWith('127.')) {
      return null;
    }
  } catch {
    // Unresolvable targets are rejected by the localhost-only gate.
  }

  return {
    error: 'NON_LOCALHOST_TARGET',
    message: 'local_network_recon is restricted to localhost targets only.',
  };
}
