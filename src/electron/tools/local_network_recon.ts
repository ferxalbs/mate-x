import { Socket } from 'node:net';
import type { Tool } from '../tool-service';

export const localNetworkReconTool: Tool = {
  name: 'local_network_recon',
  description: 'Hyper-fast TCP port scanner for localhost to discover exposed internal services (Databases, Docker, Caches).',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute() {
    // Common developer ports
    const targetPorts = [
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

    const results: string[] = [];
    const timeoutMs = 200; // Ultra-fast because it's localhost

    const scanPort = (portObj: { port: number, name: string }) => {
      return new Promise<void>((resolve) => {
        const socket = new Socket();
        let status = 'closed';

        socket.setTimeout(timeoutMs);

        socket.on('connect', () => {
          status = 'open';
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
          resolve();
        });

        socket.connect(portObj.port, '127.0.0.1');
      });
    };

    // Run scans concurrently
    await Promise.all(targetPorts.map(scanPort));

    if (results.length === 0) {
      return 'No common developer services found listening on localhost.';
    }

    return `🕵️ Local Network Recon Results:\n\n${results.join('\n')}\n\nWARNING: Ensure these internal services do not use default credentials.`;
  },
};
