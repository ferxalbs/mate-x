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
