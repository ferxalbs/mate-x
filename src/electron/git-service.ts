import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';

import type { GitCommit, GitDiff, GitStatus } from '../contracts/git';

export class GitService {
  private git: SimpleGit;

  constructor(workingDir: string = process.cwd()) {
    this.git = simpleGit(workingDir);
  }

  async getStatus(): Promise<GitStatus> {
    const status: StatusResult = await this.git.status();
    return {
      not_added: status.not_added,
      conflicted: status.conflicted,
      created: status.created,
      deleted: status.deleted,
      modified: status.modified,
      renamed: status.renamed,
      staged: status.staged,
      files: status.files,
      ahead: status.ahead,
      behind: status.behind,
      current: status.current,
      tracking: status.tracking,
      isClean: status.isClean(),
    };
  }

  async getLog(limit = 20): Promise<GitCommit[]> {
    const log = await this.git.log({ maxCount: limit });
    return log.all.map((entry) => ({
      hash: entry.hash,
      date: entry.date,
      message: entry.message,
      author_name: entry.author_name,
      author_email: entry.author_email,
    }));
  }

  async stageFiles(files: string[]): Promise<void> {
    await this.git.add(files);
  }

  async commit(message: string): Promise<void> {
    await this.git.commit(message);
  }

  async push(): Promise<void> {
    await this.git.push();
  }

  async pull(): Promise<void> {
    await this.git.pull();
  }

  async unstageFiles(files: string[]): Promise<void> {
    if (files.length === 0) {
      // Unstage all staged files
      await this.git.reset(['HEAD']);
    } else {
      await this.git.reset(['HEAD', '--', ...files]);
    }
  }

  async getDiff(): Promise<GitDiff> {
    const summary = await this.git.diffSummary();
    return {
      files: summary.files.map((f: any) => ({
        file: f.file,
        changes: f.changes,
        insertions: f.insertions,
        deletions: f.deletions,
        binary: f.binary,
      })),
      insertions: summary.insertions,
      deletions: summary.deletions,
    };
  }

  async getBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current || 'unknown';
  }
}

export const gitService = new GitService();
