import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AuditReport } from '../contracts/audit';
import type { ToolEvent } from '../contracts/chat';
import type { SearchMatch, WorkspaceSummary } from '../contracts/workspace';

const execFileAsync = promisify(execFile);

export interface RepoSnapshot {
  workspace: WorkspaceSummary;
  files: string[];
  packageJson: string | null;
  statusLines: string[];
  ipcMentions: SearchMatch[];
}

export async function getWorkspaceSummary(): Promise<WorkspaceSummary> {
  const root = process.cwd();
  const [branch, statusOutput, files, packageJson] = await Promise.all([
    runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(['status', '--short']),
    listFiles(180),
    readFileMaybe('package.json'),
  ]);
  const statusLines = statusOutput.split('\n').map((line) => line.trim()).filter(Boolean);

  const stack = deriveStack(files, packageJson);
  const dirtyCount = statusLines.length;

  return {
    id: 'workspace-main',
    name: root.split('/').filter(Boolean).at(-1) ?? 'workspace',
    path: root,
    branch: branch.trim() || 'unknown',
    status: 'ready',
    stack,
    facts: [
      { label: 'Package manager', value: packageJson?.includes('"bun') ? 'bun' : 'unknown' },
      { label: 'Tracked files', value: String(files.length) },
      { label: 'Git changes', value: dirtyCount > 0 ? `${dirtyCount} pending` : 'clean' },
      { label: 'IPC', value: files.some((file) => file.includes('preload')) ? 'present' : 'missing' },
    ],
  };
}

export async function listFiles(limit = 120): Promise<string[]> {
  const { stdout } = await execFileAsync('rg', ['--files', '.'], { cwd: process.cwd() });

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export async function searchInFiles(query: string, limit = 20): Promise<SearchMatch[]> {
  if (!query.trim()) {
    return [];
  }

  const args = ['-n', '--no-heading', '--color', 'never', '-S', query, '.'];

  try {
    const { stdout } = await execFileAsync('rg', args, { cwd: process.cwd() });

    return stdout
      .split('\n')
      .map((line) => parseSearchLine(line))
      .filter((match): match is SearchMatch => match !== null)
      .slice(0, limit);
  } catch (error) {
    const failed = error as { stdout?: string; code?: number };

    if (failed.code === 1 && !failed.stdout) {
      return [];
    }

    if (failed.stdout) {
      return failed.stdout
        .split('\n')
        .map((line) => parseSearchLine(line))
        .filter((match): match is SearchMatch => match !== null)
        .slice(0, limit);
    }

    throw error;
  }
}

export async function collectRepoSnapshot(): Promise<RepoSnapshot> {
  const [workspace, files, packageJson, statusOutput, ipcMentions] = await Promise.all([
    getWorkspaceSummary(),
    listFiles(200),
    readFileMaybe('package.json'),
    runGit(['status', '--short']),
    searchInFiles('ipcMain|ipcRenderer|contextBridge|invoke', 20),
  ]);

  return {
    workspace,
    files,
    packageJson,
    statusLines: statusOutput.split('\n').map((line) => line.trim()).filter(Boolean),
    ipcMentions,
  };
}

export async function runAudit(prompt: string): Promise<{ events: ToolEvent[]; report: AuditReport }> {
  const snapshot = await collectRepoSnapshot();
  const findings = [];

  if (snapshot.ipcMentions.length === 0) {
    findings.push({
      id: 'finding-ipc-missing',
      severity: 'critical' as const,
      title: 'Typed IPC boundary is not implemented broadly enough yet',
      summary:
        'The repo does not expose enough preload/main channels to support repo inspection, command execution, and artifact retrieval.',
      file: 'src/preload.ts',
      recommendation:
        'Define a narrow API surface for workspace summary, git status, file search, command execution, and future permission-gated actions.',
    });
  }

  if (!snapshot.files.some((file) => file.includes('store/chat-store.ts'))) {
    findings.push({
      id: 'finding-chat-state',
      severity: 'warning' as const,
      title: 'Conversation state module is missing',
      summary: 'The app needs a dedicated store for session, run, and artifact state.',
      file: 'src/store/chat-store.ts',
      recommendation: 'Keep runtime state isolated from presentation components and persist sessions by workspace.',
    });
  }

  if (!snapshot.files.some((file) => file.includes('contracts/ipc.ts'))) {
    findings.push({
      id: 'finding-contracts',
      severity: 'warning' as const,
      title: 'IPC contracts are not centralized',
      summary: 'Renderer and main process should share request/response types.',
      file: 'src/contracts/ipc.ts',
      recommendation: 'Promote IPC payloads into shared contracts before the tool surface grows.',
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: 'finding-next-step',
      severity: 'note' as const,
      title: 'Repo inspection boundary is present',
      summary:
        'The app already exposes the first repo inspection services; the next step is adding command execution permissions and persistence.',
      file: 'src/electron/repo-service.ts',
      recommendation:
        'Add explicit command policies, persist conversations per workspace, and attach artifacts like logs and diffs to each run.',
    });
  }

  const events: ToolEvent[] = [
    {
      id: 'step-workspace',
      label: 'Read workspace metadata',
      detail: `Resolved ${snapshot.workspace.path} on branch ${snapshot.workspace.branch}.`,
      status: 'done',
    },
    {
      id: 'step-files',
      label: 'Inspect repository files',
      detail: `Scanned ${snapshot.files.length} files and ${snapshot.statusLines.length} git changes.`,
      status: 'done',
    },
    {
      id: 'step-query',
      label: 'Search implementation signals',
      detail: `Prompt: "${prompt}". IPC-related matches found: ${snapshot.ipcMentions.length}.`,
      status: 'done',
    },
  ];

  return {
    events,
    report: {
      id: `audit-${Date.now()}`,
      createdAt: new Date().toISOString(),
      headline:
        findings[0]?.severity === 'critical'
          ? findings[0].title
          : 'Repo inspection completed; use these findings to guide the next runtime modules.',
      summary:
        'This audit is generated from live repository inspection through Electron main, not from static mock data.',
      checkedAreas: ['workspace summary', 'git status', 'file inventory', 'IPC surface'],
      findings,
    },
  };
}

async function runGit(args: string[]) {
  const { stdout } = await execFileAsync('git', args, { cwd: process.cwd() });
  return stdout.trimEnd();
}

async function readFileMaybe(path: string) {
  try {
    const { stdout } = await execFileAsync('cat', [path], { cwd: process.cwd() });
    return stdout;
  } catch {
    return null;
  }
}

function deriveStack(files: string[], packageJson: string | null) {
  const stack = new Set<string>();

  if (files.some((file) => file.endsWith('src/main.ts'))) stack.add('Electron');
  if (packageJson?.includes('"react"')) stack.add('React');
  if (packageJson?.includes('"@tanstack/react-router"')) stack.add('TanStack Router');
  if (packageJson?.includes('"tailwindcss"')) stack.add('Tailwind CSS v4');
  if (packageJson?.includes('"zustand"')) stack.add('Zustand');
  if (packageJson?.includes('"@base-ui/react"')) stack.add('Base UI');

  return Array.from(stack);
}

function parseSearchLine(line: string): SearchMatch | null {
  const match = line.match(/^(.+?):(\d+):(.*)$/);

  if (!match) {
    return null;
  }

  return {
    file: match[1],
    line: Number(match[2]),
    text: match[3].trim(),
  };
}
