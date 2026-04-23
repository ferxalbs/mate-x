import { app, shell } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  WorkspaceMemoryBootstrapContext,
  WorkspaceMemoryFile,
  WorkspaceMemoryFileKind,
  WorkspaceMemoryStatus,
} from "../contracts/workspace";

const MEMORY_FILES: Record<
  WorkspaceMemoryFileKind,
  {
    filename: WorkspaceMemoryFile["filename"];
    title: string;
    description: string;
    template: (repoPath: string) => string;
  }
> = {
  memory: {
    filename: "MEMORY.md",
    title: "Memory",
    description: "Durable mission context for this workspace.",
    template: (repoPath) => `# MEMORY.md

## Workspace
- Repository: ${repoPath}

## Project Purpose
- Add durable project facts here.

## Architecture Notes
- Add lasting architecture notes here.

## Durable Decisions
- Add decisions that should survive across runs.
`,
  },
  guardrails: {
    filename: "GUARDRAILS.md",
    title: "Guardrails",
    description: "Workspace-specific constraints and operating rules.",
    template: () => `# GUARDRAILS.md

## Security
- Never hardcode credentials.
- Validate inputs before crossing IPC or tool boundaries.
- Keep security-sensitive logic in the main process.

## Repository Discipline
- Do not write workspace memory files into the repository.
- Preserve human edits outside generated sections.
`,
  },
  workstate: {
    filename: "WORKSTATE.md",
    title: "Workstate",
    description: "Current task state and resumability notes.",
    template: () => `# WORKSTATE.md

## Current Focus
- No active task recorded.

## Last Known State
- Workspace memory was initialized.

## Open Questions
- None recorded.
`,
  },
};

const MAX_MEMORY_FILE_BYTES = 128 * 1024;
const MEMORY_ROOT_FOLDER = "workspace-memory";

interface WorkspaceMemoryMetadata {
  version: 1;
  workspaceId: string;
  memoryWorkspaceId: string;
  repoPath: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  memoryFiles: Record<WorkspaceMemoryFileKind, WorkspaceMemoryFile["filename"]>;
}

export class WorkspaceMemoryService {
  async getStatus(workspaceId: string, repoPath: string): Promise<WorkspaceMemoryStatus> {
    const metadata = await this.ensureWorkspaceMemory(workspaceId, repoPath);
    return this.readStatus(metadata);
  }

  async writeFile(
    workspaceId: string,
    repoPath: string,
    kind: WorkspaceMemoryFileKind,
    content: string,
  ): Promise<WorkspaceMemoryStatus> {
    this.assertValidKind(kind);
    this.assertValidContent(content);

    const metadata = await this.ensureWorkspaceMemory(workspaceId, repoPath);
    const filePath = this.getMemoryFilePath(metadata.memoryWorkspaceId, kind);
    await writeFile(filePath, content, "utf8");
    await this.touchMetadata(metadata);

    return this.readStatus({
      ...metadata,
      updatedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    });
  }

  async resetFile(
    workspaceId: string,
    repoPath: string,
    kind: WorkspaceMemoryFileKind,
  ): Promise<WorkspaceMemoryStatus> {
    this.assertValidKind(kind);

    const metadata = await this.ensureWorkspaceMemory(workspaceId, repoPath);
    const definition = MEMORY_FILES[kind];
    await writeFile(
      this.getMemoryFilePath(metadata.memoryWorkspaceId, kind),
      definition.template(repoPath),
      "utf8",
    );
    await this.touchMetadata(metadata);

    return this.readStatus({
      ...metadata,
      updatedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    });
  }

  async revealFolder(workspaceId: string, repoPath: string): Promise<void> {
    const metadata = await this.ensureWorkspaceMemory(workspaceId, repoPath);
    await shell.openPath(this.getWorkspaceMemoryDir(metadata.memoryWorkspaceId));
  }

  async getBootstrapContext(
    workspaceId: string,
    repoPath: string,
  ): Promise<WorkspaceMemoryBootstrapContext> {
    const status = await this.getStatus(workspaceId, repoPath);
    const byKind = new Map(status.files.map((file) => [file.kind, file.content]));
    const context = [
      "# Workspace Memory",
      "",
      "## GUARDRAILS.md",
      byKind.get("guardrails") ?? "",
      "",
      "## WORKSTATE.md",
      byKind.get("workstate") ?? "",
      "",
      "## MEMORY.md",
      byKind.get("memory") ?? "",
    ].join("\n");

    return {
      workspaceId,
      storagePath: status.storagePath,
      context,
    };
  }

  private async ensureWorkspaceMemory(
    workspaceId: string,
    repoPath: string,
  ): Promise<WorkspaceMemoryMetadata> {
    const memoryWorkspaceId = this.createMemoryWorkspaceId(workspaceId, repoPath);
    const dir = this.getWorkspaceMemoryDir(memoryWorkspaceId);
    await mkdir(dir, { recursive: true });

    const metadataPath = path.join(dir, "metadata.json");
    const now = new Date().toISOString();
    let metadata: WorkspaceMemoryMetadata | null = null;

    try {
      metadata = JSON.parse(await readFile(metadataPath, "utf8")) as WorkspaceMemoryMetadata;
    } catch {
      // Missing or invalid metadata is repaired below.
    }

    if (!metadata || metadata.version !== 1) {
      metadata = {
        version: 1,
        workspaceId,
        memoryWorkspaceId,
        repoPath,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        memoryFiles: {
          memory: "MEMORY.md",
          guardrails: "GUARDRAILS.md",
          workstate: "WORKSTATE.md",
        },
      };
    } else {
      metadata = {
        ...metadata,
        workspaceId,
        repoPath,
        lastOpenedAt: now,
      };
    }

    for (const [kind, definition] of Object.entries(MEMORY_FILES)) {
      const filePath = path.join(dir, definition.filename);
      try {
        await stat(filePath);
      } catch {
        await writeFile(
          filePath,
          definition.template(repoPath),
          "utf8",
        );
      }
      metadata.memoryFiles[kind as WorkspaceMemoryFileKind] = definition.filename;
    }

    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
    return metadata;
  }

  private async readStatus(
    metadata: WorkspaceMemoryMetadata,
  ): Promise<WorkspaceMemoryStatus> {
    const files = await Promise.all(
      (Object.keys(MEMORY_FILES) as WorkspaceMemoryFileKind[]).map(async (kind) => {
        const definition = MEMORY_FILES[kind];
        const filePath = this.getMemoryFilePath(metadata.memoryWorkspaceId, kind);
        const fileStat = await stat(filePath);
        const content = await readFile(filePath, "utf8");

        return {
          kind,
          filename: definition.filename,
          title: definition.title,
          description: definition.description,
          content,
          updatedAt: fileStat.mtime.toISOString(),
        };
      }),
    );

    return {
      workspaceId: metadata.workspaceId,
      memoryWorkspaceId: metadata.memoryWorkspaceId,
      repoPath: metadata.repoPath,
      storagePath: this.getWorkspaceMemoryDir(metadata.memoryWorkspaceId),
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      lastOpenedAt: metadata.lastOpenedAt,
      files,
    };
  }

  private async touchMetadata(metadata: WorkspaceMemoryMetadata) {
    const now = new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      updatedAt: now,
      lastOpenedAt: now,
    };
    await writeFile(
      path.join(this.getWorkspaceMemoryDir(metadata.memoryWorkspaceId), "metadata.json"),
      JSON.stringify(nextMetadata, null, 2),
      "utf8",
    );
  }

  private getMemoryFilePath(memoryWorkspaceId: string, kind: WorkspaceMemoryFileKind) {
    this.assertValidKind(kind);
    return path.join(this.getWorkspaceMemoryDir(memoryWorkspaceId), MEMORY_FILES[kind].filename);
  }

  private getWorkspaceMemoryDir(memoryWorkspaceId: string) {
    return path.join(app.getPath("userData"), MEMORY_ROOT_FOLDER, memoryWorkspaceId);
  }

  private createMemoryWorkspaceId(workspaceId: string, repoPath: string) {
    const normalizedRepoPath = path.resolve(repoPath);
    return createHash("sha256")
      .update(`${workspaceId}:${normalizedRepoPath}`)
      .digest("hex")
      .slice(0, 32);
  }

  private assertValidKind(kind: WorkspaceMemoryFileKind) {
    if (!Object.prototype.hasOwnProperty.call(MEMORY_FILES, kind)) {
      throw new Error("Invalid workspace memory file.");
    }
  }

  private assertValidContent(content: string) {
    if (typeof content !== "string") {
      throw new Error("Workspace memory content must be text.");
    }

    if (Buffer.byteLength(content, "utf8") > MAX_MEMORY_FILE_BYTES) {
      throw new Error("Workspace memory file is too large.");
    }
  }

  async clearWorkspaceMemory(workspaceId: string, repoPath: string) {
    const memoryWorkspaceId = this.createMemoryWorkspaceId(workspaceId, repoPath);
    await rm(this.getWorkspaceMemoryDir(memoryWorkspaceId), {
      recursive: true,
      force: true,
    });
  }
}

export const workspaceMemoryService = new WorkspaceMemoryService();
