import type { AuditReport } from '../contracts/audit';
import type { WorkspaceSummary } from '../contracts/workspace';

export const sampleWorkspace: WorkspaceSummary = {
  id: 'workspace-main',
  name: 'mate-x',
  path: '/Users/fer/Projects/mate-x',
  branch: 'main',
  status: 'ready',
  stack: ['Electron', 'React 19', 'Tailwind v4', 'TanStack Router', 'Zustand'],
  facts: [
    { label: 'Package manager', value: 'bun' },
    { label: 'Surface', value: 'desktop' },
    { label: 'Audit mode', value: 'local repo' },
    { label: 'IPC', value: 'pending' },
  ],
};

export const sampleAuditReport: AuditReport = {
  id: 'audit-001',
  createdAt: new Date().toISOString(),
  headline: 'Renderer foundation is ready; agent runtime and typed IPC are the next blockers.',
  summary:
    'The repo already has a modern renderer stack, but it still lacks the execution layer required for repo audits, command permissions, and artifact tracking.',
  checkedAreas: [
    'renderer architecture',
    'state model',
    'desktop boundary',
    'repo tooling readiness',
  ],
  findings: [
    {
      id: 'finding-ipc',
      severity: 'critical',
      title: 'No typed IPC contract between renderer and Electron main',
      summary:
        'The current renderer cannot request repo inspections or command execution through a safe boundary.',
      file: 'src/preload.ts',
      recommendation:
        'Create request/response contracts for shell execution, repo reads, and audit jobs before wiring real tools.',
    },
    {
      id: 'finding-store',
      severity: 'warning',
      title: 'Conversation state is not yet persisted by workspace',
      summary:
        'Audit sessions will be lost across reloads and there is no per-repo session model yet.',
      file: 'src/store/chat-store.ts',
      recommendation:
        'Persist conversations keyed by workspace id and keep tool runs separate from rendered chat messages.',
    },
    {
      id: 'finding-runtime',
      severity: 'note',
      title: 'Audit execution is still mocked',
      summary:
        'The current shell demonstrates the product flow, but findings are not generated from real repo inspection.',
      file: 'src/services/audit-service.ts',
      recommendation:
        'Replace the mock inspector with a repo service layer that runs rg, git, lint, and typecheck through IPC.',
    },
  ],
};
