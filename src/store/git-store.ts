import { create } from "zustand";

import type { GitCommit, GitDiff, GitStatus } from "../contracts/git";

type GitLoadStatus = "idle" | "loading" | "ready" | "error";

interface GitState {
  status: GitStatus | null;
  log: GitCommit[];
  diff: GitDiff | null;
  loadStatus: GitLoadStatus;
  operationStatus: "idle" | "running" | "done" | "error";
  error: string | null;
  commitMessage: string;

  // Actions
  refresh: () => Promise<void>;
  stageFiles: (files: string[]) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageFiles: (files: string[]) => Promise<void>;
  unstageAll: () => Promise<void>;
  commit: () => Promise<void>;
  push: () => Promise<void>;
  pull: () => Promise<void>;
  setCommitMessage: (message: string) => void;
}

const git = () =>
  (window as any).mate.git as {
    getStatus: () => Promise<GitStatus>;
    getLog: (limit?: number) => Promise<GitCommit[]>;
    stageFiles: (files: string[]) => Promise<void>;
    unstageFiles: (files: string[]) => Promise<void>;
    commit: (message: string) => Promise<void>;
    push: () => Promise<void>;
    pull: () => Promise<void>;
    getDiff: () => Promise<GitDiff>;
  };

export const useGitStore = create<GitState>((set, get) => ({
  status: null,
  log: [],
  diff: null,
  loadStatus: "idle",
  operationStatus: "idle",
  error: null,
  commitMessage: "",

  setCommitMessage(message) {
    set({ commitMessage: message });
  },

  async refresh() {
    set({ loadStatus: "loading", error: null });
    try {
      const [status, log, diff] = await Promise.all([
        git().getStatus(),
        git().getLog(20),
        git().getDiff(),
      ]);
      set({ status, log, diff, loadStatus: "ready" });
    } catch (err) {
      set({
        loadStatus: "error",
        error: err instanceof Error ? err.message : "Git error",
      });
    }
  },

  async stageFiles(files) {
    set({ operationStatus: "running", error: null });
    try {
      await git().stageFiles(files);
      await get().refresh();
      set({ operationStatus: "done" });
    } catch (err) {
      set({
        operationStatus: "error",
        error: err instanceof Error ? err.message : "Stage error",
      });
    }
  },

  async stageAll() {
    const status = get().status;
    if (!status) return;
    const unstaged = [
      ...status.not_added,
      ...status.modified,
      ...status.deleted,
    ];
    if (unstaged.length === 0) return;
    await get().stageFiles(unstaged);
  },

  async unstageFiles(files: string[]) {
    set({ operationStatus: "running", error: null });
    try {
      await git().unstageFiles(files);
      await get().refresh();
      set({ operationStatus: "done" });
    } catch (err) {
      set({
        operationStatus: "error",
        error: err instanceof Error ? err.message : "Unstage error",
      });
    }
  },

  async unstageAll() {
    set({ operationStatus: "running", error: null });
    try {
      await git().unstageFiles([]);
      await get().refresh();
      set({ operationStatus: "done" });
    } catch (err) {
      set({
        operationStatus: "error",
        error: err instanceof Error ? err.message : "Unstage error",
      });
    }
  },

  async commit() {
    const { commitMessage } = get();
    if (!commitMessage.trim()) return;
    set({ operationStatus: "running", error: null });
    try {
      await git().commit(commitMessage.trim());
      set({ commitMessage: "" });
      await get().refresh();
      set({ operationStatus: "done" });
    } catch (err) {
      set({
        operationStatus: "error",
        error: err instanceof Error ? err.message : "Commit error",
      });
    }
  },

  async push() {
    set({ operationStatus: "running", error: null });
    try {
      await git().push();
      await get().refresh();
      set({ operationStatus: "done" });
    } catch (err) {
      set({
        operationStatus: "error",
        error: err instanceof Error ? err.message : "Push error",
      });
    }
  },

  async pull() {
    set({ operationStatus: "running", error: null });
    try {
      await git().pull();
      await get().refresh();
      set({ operationStatus: "done" });
    } catch (err) {
      set({
        operationStatus: "error",
        error: err instanceof Error ? err.message : "Pull error",
      });
    }
  },
}));
