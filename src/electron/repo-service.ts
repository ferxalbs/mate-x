import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import OpenAI from 'openai';

import type { AssistantExecution, MessageArtifact, ToolEvent } from '../contracts/chat';
import type { SearchMatch, WorkspaceSummary } from '../contracts/workspace';

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
      { label: 'AI provider', value: process.env.OPENAI_API_KEY ? 'OpenAI connected' : 'OpenAI key missing' },
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

export async function collectRepoSnapshot(prompt: string): Promise<RepoSnapshot> {
  const promptPattern = buildPromptPattern(prompt);
  const [workspace, files, packageJson, statusOutput, promptMatches] = await Promise.all([
    getWorkspaceSummary(),
    listFiles(200),
    readFileMaybe('package.json'),
    runGit(['status', '--short']),
    promptPattern ? searchInFiles(promptPattern, 16) : Promise.resolve([]),
  ]);

  return {
    workspace,
    files,
    packageJson,
    statusLines: statusOutput.split('\n').map((line) => line.trim()).filter(Boolean),
    promptMatches,
  };
}

export async function runAssistant(prompt: string, history: string[]): Promise<AssistantExecution> {
  const snapshot = await collectRepoSnapshot(prompt);
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
      id: 'artifact-matches',
      label: 'Matches',
      value: String(snapshot.promptMatches.length),
    },
  ];
}

async function requestOpenAIResponse(input: {
  prompt: string;
  history: string[];
  snapshot: RepoSnapshot;
}) {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: OPENAI_TIMEOUT_MS,
  });

  const response = await client.responses.create({
    model: DEFAULT_OPENAI_MODEL,
    instructions: buildSystemPrompt(input.snapshot),
    input: buildUserInput(input),
  });

  const text = response.output_text?.trim();

  if (!text) {
    throw new Error('OpenAI response did not contain output text.');
  }

  return text;
}

function buildSystemPrompt(snapshot: RepoSnapshot) {
  return [
    'You are Mate-X, a desktop coding assistant.',
    'Answer like a senior engineer: concise, direct, and specific.',
    'Base your response on the provided repository snapshot.',
    'Prefer practical next steps over general theory.',
    `Current workspace: ${snapshot.workspace.name} on branch ${snapshot.workspace.branch}.`,
  ].join(' ');
}

function buildUserInput(input: {
  prompt: string;
  history: string[];
  snapshot: RepoSnapshot;
}) {
  const transcript =
    input.history.length > 0
      ? input.history.map((entry, index) => `${index + 1}. ${entry}`).join('\n')
      : '(new thread)';
  const matches =
    input.snapshot.promptMatches.length > 0
      ? input.snapshot.promptMatches
          .slice(0, 8)
          .map((match) => `${match.file}:${match.line} ${match.text}`)
          .join('\n')
      : 'No prompt-linked matches found.';

  return [
    `User request:\n${input.prompt}`,
    `Conversation history:\n${transcript}`,
    `Workspace:\n- Path: ${input.snapshot.workspace.path}\n- Branch: ${input.snapshot.workspace.branch}\n- Stack: ${input.snapshot.workspace.stack.join(', ') || 'Unknown'}`,
    `Git status:\n${input.snapshot.statusLines.slice(0, 12).join('\n') || 'clean'}`,
    `Relevant file matches:\n${matches}`,
    `Top files:\n${input.snapshot.files.slice(0, 18).join('\n')}`,
    'Respond in plain text. Mention concrete files when useful. If the repo context is thin, say so.',
  ].join('\n\n');
}

function buildFallbackResponse(prompt: string, snapshot: RepoSnapshot, error?: unknown) {
  const topMatch = snapshot.promptMatches[0];
  const lines = [
    `I mapped your request against \`${snapshot.workspace.name}\` on \`${snapshot.workspace.branch}\`.`,
    topMatch
      ? `The closest live repo signal is \`${topMatch.file}:${topMatch.line}\`, which suggests that area is the right place to extend next.`
      : 'The prompt did not map cleanly to an existing file, so the next step is expanding the shell and store around the current desktop surface.',
    `Right now the workspace has ${snapshot.statusLines.length} pending git changes and ${snapshot.files.length} indexed files.`,
    `Request focus: ${prompt.trim()}`,
  ];

  if (error instanceof Error) {
    lines.push(`OpenAI request failed: ${error.message}`);
  } else if (error) {
    lines.push('OpenAI request failed before a model response was returned.');
  } else {
    lines.push('Set `OPENAI_API_KEY` to replace this local fallback with live OpenAI responses.');
  }

  return lines.join('\n\n');
}

const STOP_WORDS = new Set([
  'that',
  'this',
  'with',
  'from',
  'have',
  'your',
  'will',
  'just',
  'into',
  'most',
  'repo',
  'design',
  'desktop',
  'build',
  'make',
]);
