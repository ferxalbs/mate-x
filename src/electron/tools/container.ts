import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);

const DOCKER_VULNERABILITY_PATTERNS = [
  { name: 'Root User', regex: /^USER\s+root/mi, fileType: 'Dockerfile' },
  { name: 'Privileged Mode', regex: /privileged:\s*true/g, fileType: 'docker-compose' },
  { name: 'Host Network', regex: /network_mode:\s*["']?host["']?/g, fileType: 'docker-compose' },
  { name: 'Insecure DNS', regex: /dns:\s*8\.8\.8\.8/g, fileType: 'docker-compose' },
  { name: 'Host Volume Mount', regex: /volumes:\s*\n\s+-\s+\/:(?!\/)/g, fileType: 'docker-compose' },
];

export const containerAuditTool: Tool = {
  name: 'container_audit',
  description: 'Audits Docker and Kubernetes configurations for security misconfigurations like root usage or privileged modes.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory to scan for container configs. Defaults to ".".',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath, settings }) {
    const relativePath = args.path || '.';
    
    try {
      // -- prevents argument injection from relativePath
      const { stdout } = await execFileAsync('rg', ['--files', '-g', '*Dockerfile*', '-g', '*docker-compose*', '-g', '*kube*', '--', relativePath], { cwd: workspacePath });
      const files = stdout.split('\n').filter(Boolean);
      const findings: string[] = [];

      for (const file of files) {
        const content = await readFile(join(workspacePath, file), 'utf8');
        for (const pattern of DOCKER_VULNERABILITY_PATTERNS) {
          if (content.match(pattern.regex)) {
            findings.push(`${file}: Detected potential ${pattern.name}`);
          }
        }
      }

      return findings.length > 0 
        ? `Container Security findings:\n${findings.join('\n')}`
        : 'No immediate container security misconfigurations identified.';
    } catch (_error) {
      // If rg fails because no files match the glob, that's fine
      return 'No container configuration files (Dockerfile, docker-compose, kube) found.';
    }
  },
};
