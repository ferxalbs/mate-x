import { app, shell } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  WorkspaceMemoryBootstrapContext,
  WorkspaceMemoryFile,
  WorkspaceMemoryFileKind,
  WorkspaceMemoryProposedUpdate,
  WorkspaceMemoryRunSummary,
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

  async summarizeRun(
    workspaceId: string,
    repoPath: string,
    summary: WorkspaceMemoryRunSummary,
  ): Promise<WorkspaceMemoryProposedUpdate[]> {
    const metadata = await this.ensureWorkspaceMemory(workspaceId, repoPath);
    const createdAt = summary.completedAt;
    const responseSummary = this.summarizeText(summary.response);
    const touchedPaths = summary.touchedPaths.slice(0, 12);
    const toolNames = Array.from(new Set(summary.toolNames)).slice(0, 12);

    await this.appendGeneratedSection(metadata, "workstate", [
      `## Session Summary - ${this.formatDate(createdAt)}`,
      "<!-- mate-x:generated:start -->",
      `- Prompt: ${this.singleLine(summary.prompt)}`,
      `- Result: ${responseSummary}`,
      touchedPaths.length > 0
        ? `- Touched paths: ${touchedPaths.join(", ")}`
        : "- Touched paths: none recorded",
      toolNames.length > 0
        ? `- Tools used: ${toolNames.join(", ")}`
        : "- Tools used: none recorded",
      "<!-- mate-x:generated:end -->",
    ].join("\n"));

    await this.touchMetadata(metadata);

    const memoryContent = [
      `## Proposed Durable Memory - ${this.formatDate(createdAt)}`,
      "<!-- mate-x:generated:start -->",
      `- User intent: ${this.singleLine(summary.prompt)}`,
      `- Outcome: ${responseSummary}`,
      touchedPaths.length > 0 ? `- Relevant paths: ${touchedPaths.join(", ")}` : "",
      "<!-- mate-x:generated:end -->",
    ].filter(Boolean).join("\n");

    const guardrailContent = this.extractGuardrailProposal(summary.response, createdAt);
    const proposals: WorkspaceMemoryProposedUpdate[] = [
      {
        kind: "memory",
        filename: "MEMORY.md",
        title: "Proposed durable memory",
        content: memoryContent,
        createdAt,
      },
    ];

    if (guardrailContent) {
      proposals.push({
        kind: "guardrails",
        filename: "GUARDRAILS.md",
        title: "Proposed guardrail",
        content: guardrailContent,
        createdAt,
      });
    }

    await this.appendGeneratedSection(metadata, "workstate", [
      `## Pending Memory Proposals - ${this.formatDate(createdAt)}`,
      "<!-- mate-x:generated:start -->",
      ...proposals.map(
        (proposal) =>
          `### ${proposal.filename}\n${proposal.content}`,
      ),
      "<!-- mate-x:generated:end -->",
    ].join("\n"));
    await this.touchMetadata(metadata);

    return proposals;
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

  private async appendGeneratedSection(
    metadata: WorkspaceMemoryMetadata,
    kind: WorkspaceMemoryFileKind,
    section: string,
  ) {
    const filePath = this.getMemoryFilePath(metadata.memoryWorkspaceId, kind);
    const current = await readFile(filePath, "utf8");
    const separator = current.endsWith("\n") ? "\n" : "\n\n";
    await writeFile(filePath, `${current}${separator}${section}\n`, "utf8");
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

  private summarizeText(value: string) {
    const normalized = this.singleLine(value);
    if (!normalized) {
      return "Run completed without a final response summary.";
    }

    return normalized.length > 260 ? `${normalized.slice(0, 257)}...` : normalized;
  }

  private singleLine(value: string) {
    return value.replace(/\s+/g, " ").trim();
  }

  private formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return new Date().toISOString().slice(0, 10);
    }

    return date.toISOString().slice(0, 10);
  }

  private extractGuardrailProposal(response: string, createdAt: string) {
    const normalized = response.toLowerCase();
    const guardrailSignals = [
      "never ",
      "always ",
      "must ",
      "do not ",
      "don't ",
      "requires approval",
      "should require",
    ];

    if (!guardrailSignals.some((signal) => normalized.includes(signal))) {
      return null;
    }

    const sentence = response
      .split(/(?<=[.!?])\s+/)
      .find((part) =>
        guardrailSignals.some((signal) => part.toLowerCase().includes(signal)),
      );

    if (!sentence) {
      return null;
    }

    return [
      `## Proposed Guardrail - ${this.formatDate(createdAt)}`,
      "<!-- mate-x:generated:start -->",
      `- ${this.summarizeText(sentence)}`,
      "<!-- mate-x:generated:end -->",
    ].join("\n");
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
