import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { WorkspaceEntry } from '../contracts/workspace';
import { createId } from '../lib/id';

interface WorkspaceRegistryState {
  activeWorkspaceId: string | null;
  workspaces: WorkspaceEntry[];
}

const DEFAULT_REGISTRY_STATE: WorkspaceRegistryState = {
  activeWorkspaceId: null,
  workspaces: [],
};

export class WorkspaceRegistry {
  private readonly filePath: string;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'workspace-registry.json');
  }

  async load(): Promise<WorkspaceRegistryState> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<WorkspaceRegistryState>;
      const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
      const activeWorkspaceId =
        typeof parsed.activeWorkspaceId === 'string' ? parsed.activeWorkspaceId : null;

      return {
        activeWorkspaceId:
          activeWorkspaceId && workspaces.some((workspace) => workspace.id === activeWorkspaceId)
            ? activeWorkspaceId
            : workspaces[0]?.id ?? null,
        workspaces,
      };
    } catch {
      return { ...DEFAULT_REGISTRY_STATE };
    }
  }

  async save(state: WorkspaceRegistryState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf8');
  }

  async ensureSeedWorkspace(defaultPath: string): Promise<WorkspaceRegistryState> {
    const state = await this.load();
    if (state.workspaces.length > 0) {
      return state;
    }

    const seededState: WorkspaceRegistryState = {
      activeWorkspaceId: null,
      workspaces: [],
    };

    const nextState = this.upsertWorkspace(seededState, defaultPath, true);
    await this.save(nextState);
    return nextState;
  }

  upsertWorkspace(
    state: WorkspaceRegistryState,
    workspacePath: string,
    setActive = false,
  ): WorkspaceRegistryState {
    const normalizedPath = path.resolve(workspacePath);
    const now = new Date().toISOString();
    const existing = state.workspaces.find((workspace) => workspace.path === normalizedPath);

    const workspaces = existing
      ? state.workspaces.map((workspace) =>
          workspace.id === existing.id ? { ...workspace, lastOpenedAt: now } : workspace,
        )
      : [
          {
            id: createId('workspace'),
            name: path.basename(normalizedPath) || normalizedPath,
            path: normalizedPath,
            addedAt: now,
            lastOpenedAt: now,
          },
          ...state.workspaces,
        ];

    const activeWorkspaceId =
      setActive || !state.activeWorkspaceId
        ? (existing?.id ?? workspaces[0]?.id ?? null)
        : state.activeWorkspaceId;

    return { activeWorkspaceId, workspaces };
  }

  removeWorkspace(state: WorkspaceRegistryState, workspaceId: string): WorkspaceRegistryState {
    const workspaces = state.workspaces.filter((workspace) => workspace.id !== workspaceId);
    const activeWorkspaceId =
      state.activeWorkspaceId === workspaceId ? (workspaces[0]?.id ?? null) : state.activeWorkspaceId;

    return { activeWorkspaceId, workspaces };
  }
}

export const workspaceRegistry = new WorkspaceRegistry();
