import { isAbsolute, normalize, relative } from 'node:path';

import type { WorkspaceTrustContract } from '../contracts/workspace';
import { createId } from '../lib/id';

export const TRUST_CONTRACT_SCHEMA_VERSION = 1;

export function createDefaultWorkspaceTrustContract(
  workspaceId: string,
  workspaceName: string,
): WorkspaceTrustContract {
  return {
    id: createId('trust'),
    workspaceId,
    name: `${workspaceName} governed review`,
    version: TRUST_CONTRACT_SCHEMA_VERSION,
    autonomy: 'approval-required',
    allowedPaths: ['src', 'package.json', 'README.md', 'AGENTS.md'],
    forbiddenPaths: [
      '.env',
      '.env.*',
      '.git',
      'node_modules',
      'dist',
      'build',
      'infra/prod',
      '.env.production',
    ],
    allowedCommands: [
      'bun run lint',
      'bun run typecheck',
      'bun test',
      'npm test',
      'pnpm test',
    ],
    allowedDomains: [
      'api.github.com',
      'docs.github.com',
      'docs.npmjs.com',
      'rainy-api-v3-us-179843975974.us-east4.run.app',
    ],
    allowedSecrets: [],
    allowedActions: ['read', 'search', 'patch', 'test'],
    blockedActions: ['deploy', 'delete', 'install-global-packages', 'exfiltrate-secrets'],
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeWorkspaceTrustContract(
  contract: WorkspaceTrustContract,
): WorkspaceTrustContract {
  return {
    ...contract,
    name: contract.name.trim() || 'Workspace trust contract',
    version: Number.isInteger(contract.version) && contract.version > 0
      ? contract.version
      : TRUST_CONTRACT_SCHEMA_VERSION,
    allowedPaths: normalizeList(contract.allowedPaths),
    forbiddenPaths: normalizeList(contract.forbiddenPaths),
    allowedCommands: normalizeList(contract.allowedCommands),
    allowedDomains: normalizeList(contract.allowedDomains).map((domain) =>
      domain.toLowerCase(),
    ),
    allowedSecrets: normalizeList(contract.allowedSecrets),
    allowedActions: normalizeList(contract.allowedActions),
    blockedActions: normalizeList(contract.blockedActions),
    updatedAt: contract.updatedAt || new Date().toISOString(),
  };
}

export function evaluateTrustForToolCall({
  toolName,
  args,
  contract,
}: {
  toolName: string;
  args: Record<string, unknown>;
  contract: WorkspaceTrustContract;
}) {
  const normalizedContract = normalizeWorkspaceTrustContract(contract);
  const requiredAction = getRequiredAction(toolName, args);

  if (
    normalizedContract.autonomy === 'plan-only' &&
    requiredAction &&
    !['read', 'search'].includes(requiredAction)
  ) {
    return `Workspace Trust Contract blocks ${toolName}: autonomy is plan-only.`;
  }

  if (requiredAction && !normalizedContract.allowedActions.includes(requiredAction)) {
    return `Workspace Trust Contract blocks ${toolName}: action "${requiredAction}" is not allowed.`;
  }

  const blockedAction = getBlockedAction(toolName, args, normalizedContract);
  if (blockedAction) {
    return `Workspace Trust Contract blocks ${toolName}: action "${blockedAction}" is prohibited.`;
  }

  const command = extractCommand(toolName, args);
  if (command) {
    const allowed = normalizedContract.allowedCommands.some((allowedCommand) =>
      command === allowedCommand || command.startsWith(`${allowedCommand} `),
    );
    if (!allowed) {
      return `Workspace Trust Contract blocks command "${command}".`;
    }
  }

  const pathValues = extractPathValues(args, toolName);
  for (const pathValue of pathValues) {
    const pathError = evaluatePath(pathValue, normalizedContract);
    if (pathError) {
      return `Workspace Trust Contract blocks ${toolName}: ${pathError}`;
    }
  }

  return null;
}

export function canQueryDomain(contract: WorkspaceTrustContract, hostname: string) {
  const normalizedHostname = hostname.toLowerCase();
  return normalizeWorkspaceTrustContract(contract).allowedDomains.some(
    (domain) =>
      normalizedHostname === domain ||
      normalizedHostname.endsWith(`.${domain}`),
  );
}

export function renderTrustContractForPrompt(contract: WorkspaceTrustContract) {
  const normalized = normalizeWorkspaceTrustContract(contract);

  return [
    `Trust contract: ${normalized.name} v${normalized.version}`,
    `Autonomy: ${normalized.autonomy}`,
    `Allowed paths: ${formatList(normalized.allowedPaths)}`,
    `Forbidden paths: ${formatList(normalized.forbiddenPaths)}`,
    `Allowed commands: ${formatList(normalized.allowedCommands)}`,
    `Allowed domains: ${formatList(normalized.allowedDomains)}`,
    `Allowed secrets: ${formatList(normalized.allowedSecrets)}`,
    `Allowed actions: ${formatList(normalized.allowedActions)}`,
    `Blocked actions: ${formatList(normalized.blockedActions)}`,
  ].join('\n');
}

function normalizeList(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function getRequiredAction(toolName: string, args: Record<string, unknown>) {
  if (toolName === 'auto_patch') {
    return 'patch';
  }

  if (toolName === 'run_tests' || toolName === 'sandbox_run') {
    return 'test';
  }

  if (toolName === 'git_diag') {
    return args.operation === 'diff' || args.operation === 'show' ? 'read' : 'search';
  }

  if (toolName.includes('patch')) {
    return 'patch';
  }

  return toolName === 'rg' ? 'search' : 'read';
}

function getBlockedAction(
  toolName: string,
  args: Record<string, unknown>,
  contract: WorkspaceTrustContract,
) {
  if (toolName === 'sandbox_run') {
    const command = typeof args.command === 'string' ? args.command : '';
    if (/\bdeploy\b|vercel|netlify|firebase|railway|flyctl|kubectl/i.test(command)) {
      return 'deploy';
    }
    if (/\bnpm\s+install\s+-g\b|\bbun\s+add\s+-g\b|\byarn\s+global\b/i.test(command)) {
      return 'install-global-packages';
    }
  }

  return contract.blockedActions.find((blockedAction) => {
    if (blockedAction === 'delete') {
      return /\brm\b|\bdel\b|delete|unlink/i.test(JSON.stringify(args));
    }

    if (blockedAction === 'deploy') {
      return /deploy|vercel|netlify|firebase|railway|flyctl|kubectl/i.test(JSON.stringify(args));
    }

    return false;
  }) ?? null;
}

function extractCommand(toolName: string, args: Record<string, unknown>) {
  if (toolName === 'sandbox_run' && typeof args.command === 'string') {
    return args.command.trim();
  }

  return null;
}

function extractPathValues(args: Record<string, unknown>, toolName: string) {
  const pathKeys = toolName === 'run_tests'
    ? ['specificPath']
    : ['path', 'scope', 'specificPath'];
  const scalarPaths = pathKeys
    .map((key) => args[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const arrayPaths = ['paths']
    .flatMap((key) => args[key])
    .filter(Array.isArray)
    .flatMap((values) => values)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return [...scalarPaths, ...arrayPaths];
}

function evaluatePath(pathValue: string, contract: WorkspaceTrustContract) {
  const candidate = normalizeWorkspaceRelativePath(pathValue);
  if (!candidate) {
    return 'path must remain within the active workspace.';
  }

  if (matchesAnyPath(candidate, contract.forbiddenPaths)) {
    return `"${pathValue}" matches a forbidden path.`;
  }

  if (contract.allowedPaths.length === 0 || contract.allowedPaths.includes('.')) {
    return null;
  }

  if (!matchesAnyPath(candidate, contract.allowedPaths)) {
    return `"${pathValue}" is outside allowed paths.`;
  }

  return null;
}

function normalizeWorkspaceRelativePath(pathValue: string) {
  const normalized = normalize(pathValue.trim()).replaceAll('\\', '/');
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    isAbsolute(normalized) ||
    relative('.', normalized).startsWith('..')
  ) {
    return null;
  }

  return normalized === '' ? '.' : normalized;
}

function matchesAnyPath(candidate: string, patterns: string[]) {
  return patterns.some((pattern) => matchesPathPattern(candidate, pattern));
}

function matchesPathPattern(candidate: string, pattern: string) {
  const normalizedPattern = normalizeWorkspaceRelativePath(pattern);
  if (!normalizedPattern) {
    return false;
  }

  if (normalizedPattern.endsWith('.*')) {
    const prefix = normalizedPattern.slice(0, -1);
    return candidate.startsWith(prefix);
  }

  return (
    candidate === normalizedPattern ||
    candidate.startsWith(`${normalizedPattern}/`)
  );
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join(', ') : 'none';
}
