import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

import OpenAI from 'openai';

import { GitService } from './git-service';
import { tursoService } from './turso-service';
import type { Conversation } from '../contracts/chat';
import type { AssistantExecution, MessageArtifact, ToolEvent } from '../contracts/chat';
import type { SearchMatch, WorkspaceEntry, WorkspaceSnapshot, WorkspaceSummary } from '../contracts/workspace';

const execFileAsync = promisify(execFile);
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.2';
const OPENAI_TIMEOUT_MS = 20_000;

export interface RepoSnapshot {
  workspace: WorkspaceSummary;
  files: string[];
  packageJson: string | null;
  statusLines: string[];
  promptMatches: SearchMatch[];
}

export async function bootstrapWorkspaceState(): Promise<WorkspaceSnapshot> {
  await tursoService.ensureSeedWorkspace(process.cwd());
  const activeWorkspaceId = await tursoService.getActiveWorkspaceId();
  return buildWorkspaceSnapshot(activeWorkspaceId);
}

export async function getWorkspaceEntries(): Promise<WorkspaceEntry[]> {
  await tursoService.ensureSeedWorkspace(process.cwd());
  return tursoService.getWorkspaces();
}

export async function setActiveWorkspace(workspaceId: string): Promise<WorkspaceSnapshot> {
  await tursoService.ensureSeedWorkspace(process.cwd());
  const workspaces = await tursoService.getWorkspaces();
  if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new Error('Workspace not found.');
  }

  await tursoService.setActiveWorkspaceId(workspaceId);
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  if (workspace) {
    await tursoService.upsertWorkspace(workspace.path, true);
  }
  return buildWorkspaceSnapshot(workspaceId);
}

export async function addWorkspace(workspacePath: string): Promise<WorkspaceSnapshot> {
  await access(workspacePath);
  const workspaceId = await tursoService.upsertWorkspace(workspacePath, true);
  return buildWorkspaceSnapshot(workspaceId);
}

export async function removeWorkspace(workspaceId: string): Promise<WorkspaceSnapshot> {
  await tursoService.ensureSeedWorkspace(process.cwd());
  await tursoService.removeWorkspace(workspaceId);
  const remaining = await tursoService.getWorkspaces();

  if (remaining.length === 0) {
    const seededWorkspaceId = await tursoService.upsertWorkspace(process.cwd(), true);
    return buildWorkspaceSnapshot(seededWorkspaceId);
  }

  const activeWorkspaceId = (await tursoService.getActiveWorkspaceId()) ?? remaining[0].id;
  return buildWorkspaceSnapshot(activeWorkspaceId);
}

export async function saveWorkspaceSession(
  workspaceId: string,
  threads: Conversation[],
  activeThreadId: string,
) {
  await tursoService.saveWorkspaceSession(workspaceId, threads, activeThreadId);
}

export async function getWorkspaceSummary(workspaceId?: string): Promise<WorkspaceSummary> {
  const workspace = await resolveWorkspace(workspaceId);
  return buildWorkspaceSummary(workspace);
}

export async function listFiles(limit = 120, workspaceId?: string): Promise<string[]> {
  const workspace = await resolveWorkspace(workspaceId);
  return listWorkspaceFiles(workspace.path, limit);
}

export async function searchInFiles(
  query: string,
  limit = 20,
  workspaceId?: string,
): Promise<SearchMatch[]> {
  const workspace = await resolveWorkspace(workspaceId);
  return searchWorkspaceFiles(workspace.path, query, limit);
}

export async function collectRepoSnapshot(prompt: string, workspaceId?: string): Promise<RepoSnapshot> {
  const workspace = await resolveWorkspace(workspaceId);
  const promptPattern = buildPromptPattern(prompt);
  const [summary, files, packageJson, status, promptMatches] = await Promise.all([
    buildWorkspaceSummary(workspace),
    listWorkspaceFiles(workspace.path, 200),
    readFileMaybe(workspace.path, 'package.json'),
    new GitService(workspace.path).getStatus(),
    promptPattern ? searchWorkspaceFiles(workspace.path, promptPattern, 16) : Promise.resolve([]),
  ]);

  return {
    workspace: summary,
    files,
    packageJson,
    statusLines: status.files.map((f) => `${f.index}${f.working_dir} ${f.path}`),
    promptMatches,
  };
}

export async function runAssistant(
  prompt: string,
  history: string[],
  workspaceId?: string,
): Promise<AssistantExecution> {
  const snapshot = await collectRepoSnapshot(prompt, workspaceId);
  const events: ToolEvent[] = [
    {
      id: 'step-workspace',
      label: 'Read workspace metadata',
      detail: `Resolved ${snapshot.workspace.path} on branch ${snapshot.workspace.branch}.`,
      status: 'done',
    },
    {
      id: 'step-files',
      label: 'Inventory repository surface',
      detail: `Indexed ${snapshot.files.length} files and ${snapshot.statusLines.length} git changes.`,
      status: 'done',
    },
    {
      id: 'step-query',
      label: 'Search prompt-linked files',
      detail:
        snapshot.promptMatches.length > 0
          ? `Found ${snapshot.promptMatches.length} repo matches connected to the request.`
          : 'No direct file matches from the current prompt terms.',
      status: 'done',
    },
  ];

  const artifacts = buildArtifacts(snapshot);
  const providerReady = Boolean(process.env.OPENAI_API_KEY);
  const createdAt = new Date().toISOString();
  let content: string;

  if (providerReady) {
    try {
      content = await requestOpenAIResponse({
        history,
        prompt,
        snapshot,
      });
      events.push({
        id: 'step-openai',
        label: 'Generate OpenAI response',
        detail: `Answered with ${DEFAULT_OPENAI_MODEL}.`,
        status: 'done',
      });
    } catch (error) {
      content = buildFallbackResponse(prompt, snapshot, error);
      events.push({
        id: 'step-openai-fallback',
        label: 'OpenAI fallback',
        detail: 'The API request failed, so Mate-X returned a local repo-grounded response.',
        status: 'error',
      });
    }
  } else {
    content = buildFallbackResponse(prompt, snapshot);
    events.push({
      id: 'step-openai-missing',
      label: 'OpenAI unavailable',
      detail: 'Set OPENAI_API_KEY to enable live model responses. Using local repo context for now.',
      status: 'error',
    });
  }

  return {
    suggestedTitle: history.length === 0 ? buildThreadTitle(prompt) : undefined,
    message: {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content,
      createdAt,
      events,
      artifacts,
    },
  };
}

async function buildWorkspaceSnapshot(activeWorkspaceId: string | null): Promise<WorkspaceSnapshot> {
  await tursoService.ensureSeedWorkspace(process.cwd());
  const workspaces = await tursoService.getWorkspaces();
  const resolvedWorkspaceId = activeWorkspaceId ?? (await tursoService.getActiveWorkspaceId());

  if (!resolvedWorkspaceId) {
    throw new Error('No workspace is available.');
  }

  const workspace = await resolveWorkspace(resolvedWorkspaceId, workspaces);
  const [summary, files, signals, session] = await Promise.all([
    buildWorkspaceSummary(workspace),
    listWorkspaceFiles(workspace.path, 18),
    searchWorkspaceFiles(workspace.path, 'OpenAI|ipc|thread|sidebar|composer', 10),
    tursoService.getWorkspaceSession(workspace.id),
  ]);

  return {
    activeWorkspaceId: workspace.id,
    workspaces,
    workspace: summary,
    files,
    signals,
    threads: session.threads,
    activeThreadId: session.activeThreadId,
  };
}

async function resolveWorkspace(
  workspaceId?: string,
  cachedWorkspaces?: WorkspaceEntry[],
): Promise<WorkspaceEntry> {
  const workspaces = cachedWorkspaces ?? (await tursoService.getWorkspaces());
  const resolvedId = workspaceId ?? (await tursoService.getActiveWorkspaceId()) ?? workspaces[0]?.id;
  const workspace = workspaces.find((entry) => entry.id === resolvedId);

  if (!workspace) {
    throw new Error('Workspace not found.');
  }

  return workspace;
}

async function buildWorkspaceSummary(workspace: WorkspaceEntry): Promise<WorkspaceSummary> {
  const [status, files, packageJson] = await Promise.all([
    new GitService(workspace.path).getStatusSafe(),
    listWorkspaceFiles(workspace.path, 180),
    readFileMaybe(workspace.path, 'package.json'),
  ]);

  const stack = deriveStack(files, packageJson);
  const dirtyCount = status?.files.length ?? 0;

  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    branch: status?.current || 'not-a-repo',
    status: 'ready',
    stack,
    facts: [
      { label: 'Package manager', value: packageJson?.includes('"bun') ? 'bun' : 'unknown' },
      { label: 'Tracked files', value: String(files.length) },
      { label: 'Git changes', value: dirtyCount > 0 ? `${dirtyCount} pending` : 'clean' },
      { label: 'IPC', value: files.some((file) => file.includes('preload')) ? 'present' : 'missing' },
      { label: 'AI provider', value: process.env.OPENAI_API_KEY ? 'OpenAI connected' : 'OpenAI key missing' },
      { label: 'Model', value: DEFAULT_OPENAI_MODEL },
    ],
  };
}

async function listWorkspaceFiles(workspacePath: string, limit = 120): Promise<string[]> {
  const { stdout } = await execFileAsync('rg', ['--files', '.'], { cwd: workspacePath });

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

async function searchWorkspaceFiles(
  workspacePath: string,
  query: string,
  limit = 20,
): Promise<SearchMatch[]> {
  if (!query.trim()) {
    return [];
  }

  const args = ['-n', '--no-heading', '--color', 'never', '-S', query, '.'];

  try {
    const { stdout } = await execFileAsync('rg', args, { cwd: workspacePath });

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

async function readFileMaybe(workspacePath: string, relativePath: string) {
  try {
    const { stdout } = await execFileAsync('cat', [relativePath], { cwd: workspacePath });
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

function buildThreadTitle(prompt: string) {
  const collapsed = prompt.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 42) {
    return collapsed;
  }
  return `${collapsed.slice(0, 39).trimEnd()}...`;
}

function buildPromptPattern(prompt: string) {
  const terms = Array.from(
    new Set(
      prompt
        .toLowerCase()
        .match(/[a-z0-9_-]{4,}/g)
        ?.filter((term) => !STOP_WORDS.has(term))
        .slice(0, 6) ?? [],
    ),
  );

  return terms.length > 0 ? terms.join('|') : '';
}

function buildArtifacts(snapshot: RepoSnapshot): MessageArtifact[] {
  return [
    {
      id: 'artifact-provider',
      label: 'Provider',
      value: process.env.OPENAI_API_KEY ? 'OpenAI' : 'Local fallback',
      tone: process.env.OPENAI_API_KEY ? 'success' : 'warning',
    },
    {
      id: 'artifact-model',
      label: 'Model',
      value: process.env.OPENAI_API_KEY ? DEFAULT_OPENAI_MODEL : 'repo-grounded summary',
    },
    {
      id: 'artifact-branch',
      label: 'Branch',
      value: snapshot.workspace.branch,
    },
    {
      id: 'artifact-files',
      label: 'Files indexed',
      value: String(snapshot.files.length),
    },
  ];
}

function buildFallbackResponse(prompt: string, snapshot: RepoSnapshot, error?: unknown) {
  const matches =
    snapshot.promptMatches.length > 0
      ? snapshot.promptMatches
          .slice(0, 4)
          .map((match) => `- ${match.file}:${match.line} ${match.text}`)
          .join('\n')
      : '- No prompt-linked file matches were found.';

  const gitLines =
    snapshot.statusLines.length > 0
      ? snapshot.statusLines.slice(0, 6).map((line) => `- ${line}`).join('\n')
      : '- Working tree clean.';

  const errorLine = error instanceof Error ? `\n\nOpenAI error: ${error.message}` : '';

  return [
    `Request: ${prompt}`,
    '',
    `Workspace: ${snapshot.workspace.name}`,
    `Path: ${snapshot.workspace.path}`,
    `Branch: ${snapshot.workspace.branch}`,
    '',
    'Relevant matches:',
    matches,
    '',
    'Git status:',
    gitLines,
    '',
    'Next move: inspect the matched files and update the active workspace flow before making changes.',
    errorLine,
  ].join('\n');
}

async function requestOpenAIResponse({
  history,
  prompt,
  snapshot,
}: {
  history: string[];
  prompt: string;
  snapshot: RepoSnapshot;
}) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const files = snapshot.files.slice(0, 80).join('\n');
  const matches = snapshot.promptMatches
    .slice(0, 12)
    .map((match) => `${match.file}:${match.line} ${match.text}`)
    .join('\n');
  const gitStatus = snapshot.statusLines.slice(0, 40).join('\n');

  const response = await client.responses.create(
    {
      model: DEFAULT_OPENAI_MODEL,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'You are Mate-X, an Electron coding copilot grounded in the local repository.',
                'Use the supplied workspace inventory, git status, and search matches to answer precisely.',
                'If repo evidence is weak, say so explicitly and propose the next repo action.',
              ].join(' '),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                `Workspace: ${snapshot.workspace.name}`,
                `Path: ${snapshot.workspace.path}`,
                `Branch: ${snapshot.workspace.branch}`,
                '',
                'Files:',
                files || '(none)',
                '',
                'Git status:',
                gitStatus || '(clean)',
                '',
                'Prompt-linked matches:',
                matches || '(none)',
                '',
                'Conversation history:',
                history.join('\n') || '(none)',
                '',
                `User prompt: ${prompt}`,
              ].join('\n'),
            },
          ],
        },
      ],
    },
    {
      timeout: OPENAI_TIMEOUT_MS,
    },
  );

  return response.output_text?.trim() || buildFallbackResponse(prompt, snapshot);
}

const STOP_WORDS = new Set([
  'this',
  'that',
  'with',
  'from',
  'have',
  'need',
  'make',
  'into',
  'about',
  'your',
  'project',
  'workspace',
  'please',
  'could',
]);
