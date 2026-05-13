import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool } from '../tool-service';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_FINDINGS = 50;
const MAX_FINDINGS_LIMIT = 200;

type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

type ContainerRule = {
  id: string;
  name: string;
  severity: FindingSeverity;
  appliesTo: (file: string) => boolean;
  match: (content: string) => RegExpMatchArray[];
  recommendation: string;
};

const isDockerfile = (file: string) => /(^|\/)(Dockerfile|.*\.Dockerfile)(\..*)?$/i.test(file);
const isComposeFile = (file: string) => /(^|\/)(docker-compose|compose).*\.(ya?ml)$/i.test(file);
const isKubernetesFile = (file: string) => /\.(ya?ml)$/i.test(file);

const makeMatches = (content: string, regex: RegExp) => [...content.matchAll(regex)];

const CONTAINER_RULES: ContainerRule[] = [
  {
    id: 'dockerfile-root-user',
    name: 'Container runs as root',
    severity: 'high',
    appliesTo: isDockerfile,
    match: (content) => makeMatches(content, /^\s*USER\s+(root|0)\s*$/gim),
    recommendation: 'Use dedicated non-root UID/GID and drop root-only permissions.',
  },
  {
    id: 'dockerfile-latest-tag',
    name: 'Unpinned latest image tag',
    severity: 'medium',
    appliesTo: isDockerfile,
    match: (content) => makeMatches(content, /^\s*FROM\s+\S+:(latest)\b.*$/gim),
    recommendation: 'Pin image to immutable digest or explicit version.',
  },
  {
    id: 'dockerfile-curl-pipe-shell',
    name: 'Remote script piped to shell',
    severity: 'high',
    appliesTo: isDockerfile,
    match: (content) => makeMatches(content, /^\s*RUN\s+.*\b(curl|wget)\b.*\|\s*(sh|bash)\b.*$/gim),
    recommendation: 'Download, verify checksum/signature, then execute explicitly.',
  },
  {
    id: 'dockerfile-add-remote',
    name: 'Remote ADD source',
    severity: 'medium',
    appliesTo: isDockerfile,
    match: (content) => makeMatches(content, /^\s*ADD\s+https?:\/\/\S+/gim),
    recommendation: 'Use COPY for local files or verify remote artifact before use.',
  },
  {
    id: 'dockerfile-sudo-install',
    name: 'sudo installed in image',
    severity: 'low',
    appliesTo: isDockerfile,
    match: (content) => makeMatches(content, /^\s*RUN\s+.*\b(apt-get|apk|yum|dnf)\b.*\binstall\b.*\bsudo\b.*$/gim),
    recommendation: 'Avoid sudo inside containers; build with least required packages.',
  },
  {
    id: 'compose-privileged',
    name: 'Privileged container',
    severity: 'critical',
    appliesTo: isComposeFile,
    match: (content) => makeMatches(content, /^\s*privileged:\s*true\s*$/gim),
    recommendation: 'Remove privileged mode; grant only required capabilities/devices.',
  },
  {
    id: 'compose-host-network',
    name: 'Host network mode',
    severity: 'high',
    appliesTo: isComposeFile,
    match: (content) => makeMatches(content, /^\s*network_mode:\s*["']?host["']?\s*$/gim),
    recommendation: 'Use bridged networks and expose only required ports.',
  },
  {
    id: 'compose-host-pid',
    name: 'Host PID namespace',
    severity: 'high',
    appliesTo: isComposeFile,
    match: (content) => makeMatches(content, /^\s*pid:\s*["']?host["']?\s*$/gim),
    recommendation: 'Avoid host PID namespace unless tightly justified.',
  },
  {
    id: 'compose-host-ipc',
    name: 'Host IPC namespace',
    severity: 'high',
    appliesTo: isComposeFile,
    match: (content) => makeMatches(content, /^\s*ipc:\s*["']?host["']?\s*$/gim),
    recommendation: 'Avoid host IPC namespace unless tightly justified.',
  },
  {
    id: 'compose-host-root-mount',
    name: 'Host root filesystem mounted',
    severity: 'critical',
    appliesTo: isComposeFile,
    match: (content) => makeMatches(content, /^\s*-\s*\/:(?!\/)/gim),
    recommendation: 'Remove host root mount; mount narrow read-only paths when needed.',
  },
  {
    id: 'compose-docker-socket',
    name: 'Docker socket mounted',
    severity: 'critical',
    appliesTo: isComposeFile,
    match: (content) => makeMatches(content, /\/var\/run\/docker\.sock/gim),
    recommendation: 'Avoid Docker socket mount or isolate behind tightly scoped proxy.',
  },
  {
    id: 'compose-dangerous-capability',
    name: 'Dangerous Linux capability added',
    severity: 'high',
    appliesTo: isComposeFile,
    match: (content) => makeMatches(content, /^\s*-\s*(SYS_ADMIN|NET_ADMIN|SYS_PTRACE|DAC_READ_SEARCH)\s*$/gim),
    recommendation: 'Drop broad capabilities; add only minimum required capability.',
  },
  {
    id: 'kube-privileged',
    name: 'Kubernetes privileged container',
    severity: 'critical',
    appliesTo: isKubernetesFile,
    match: (content) => makeMatches(content, /^\s*privileged:\s*true\s*$/gim),
    recommendation: 'Set privileged false and use restricted Pod Security settings.',
  },
  {
    id: 'kube-host-namespace',
    name: 'Kubernetes host namespace enabled',
    severity: 'high',
    appliesTo: isKubernetesFile,
    match: (content) => makeMatches(content, /^\s*host(Network|PID|IPC):\s*true\s*$/gim),
    recommendation: 'Disable host namespaces unless workload has clear isolation exception.',
  },
  {
    id: 'kube-allow-privilege-escalation',
    name: 'Privilege escalation allowed',
    severity: 'high',
    appliesTo: isKubernetesFile,
    match: (content) => makeMatches(content, /^\s*allowPrivilegeEscalation:\s*true\s*$/gim),
    recommendation: 'Set allowPrivilegeEscalation to false.',
  },
  {
    id: 'kube-root-user',
    name: 'Kubernetes container runs as root',
    severity: 'high',
    appliesTo: isKubernetesFile,
    match: (content) => makeMatches(content, /^\s*runAsUser:\s*0\s*$/gim),
    recommendation: 'Use non-root runAsUser and enforce runAsNonRoot.',
  },
  {
    id: 'kube-rootfs-writable',
    name: 'Writable root filesystem',
    severity: 'medium',
    appliesTo: isKubernetesFile,
    match: (content) => makeMatches(content, /^\s*readOnlyRootFilesystem:\s*false\s*$/gim),
    recommendation: 'Set readOnlyRootFilesystem true and mount writable volumes explicitly.',
  },
];

const isInsideWorkspace = (workspacePath: string, targetPath: string) => {
  const relativePath = relative(workspacePath, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith('/'));
};

const toPositiveInteger = (value: unknown, fallback: number, max: number) => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(Math.floor(numberValue), max);
};

const getLineNumber = (content: string, index = 0) => content.slice(0, index).split('\n').length;

export const containerAuditTool: Tool = {
  name: 'container_audit',
  description: 'Audits Docker, Docker Compose, and Kubernetes configs for common container security misconfigurations with line evidence and remediation.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory to scan for container configs. Defaults to ".".',
      },
      maxFindings: {
        type: 'number',
        description: 'Max findings to return. Defaults to 50, capped at 200.',
      },
    },
    required: [],
  },
  async execute(args, { workspacePath, settings: _settings }) {
    const relativePath = String(args.path || '.');
    const maxFindings = toPositiveInteger(args.maxFindings, DEFAULT_MAX_FINDINGS, MAX_FINDINGS_LIMIT);
    const targetPath = resolve(workspacePath, relativePath);

    if (!isInsideWorkspace(workspacePath, targetPath)) {
      return 'Refusing to scan outside the workspace.';
    }

    try {
      // -- prevents argument injection from relativePath
      const { stdout } = await execFileAsync(
        'rg',
        [
          '--files',
          '-g',
          '*Dockerfile*',
          '-g',
          '*.Dockerfile',
          '-g',
          '*docker-compose*.yml',
          '-g',
          '*docker-compose*.yaml',
          '-g',
          'compose*.yml',
          '-g',
          'compose*.yaml',
          '-g',
          '*kube*.yml',
          '-g',
          '*kube*.yaml',
          '-g',
          '*k8s*.yml',
          '-g',
          '*k8s*.yaml',
          '--',
          relativePath,
        ],
        { cwd: workspacePath }
      );
      const files = stdout.split('\n').filter(Boolean);
      const findings: string[] = [];

      for (const file of files) {
        if (findings.length >= maxFindings) break;

        const filePath = resolve(workspacePath, file);
        if (!isInsideWorkspace(workspacePath, filePath)) continue;

        const content = await readFile(filePath, 'utf8');
        for (const rule of CONTAINER_RULES) {
          if (!rule.appliesTo(file)) continue;

          for (const match of rule.match(content)) {
            const lineNumber = getLineNumber(content, match.index);
            const evidence = (match[0] || '').trim().replace(/\s+/g, ' ');
            findings.push(
              `${rule.severity.toUpperCase()} ${file}:${lineNumber} [${rule.id}] ${rule.name} | evidence: ${evidence} | fix: ${rule.recommendation}`
            );

            if (findings.length >= maxFindings) break;
          }

          if (findings.length >= maxFindings) break;
        }
      }

      return findings.length > 0 
        ? `Container Security findings (${findings.length}${findings.length >= maxFindings ? '+' : ''}):\n${findings.join('\n')}`
        : `No immediate container security misconfigurations identified across ${files.length} container config file(s).`;
    } catch (error) {
      const maybeError = error as { code?: number; stderr?: string; message?: string };
      if (maybeError.code === 1) {
        return 'No container configuration files (Dockerfile, docker-compose, Kubernetes YAML) found.';
      }

      return `container_audit failed: ${maybeError.stderr?.trim() || maybeError.message || 'Unknown error'}`;
    }
  },
};
