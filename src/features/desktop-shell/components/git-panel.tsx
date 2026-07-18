import { useEffect, useRef } from 'react';
import {
  ArrowClockwiseIcon,
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  GitBranchIcon,
  GitCommitIcon,
  MinusSquareIcon,
  PlusSquareIcon,
  SpinnerGapIcon,
} from '@phosphor-icons/react';

import { useGitStore } from '../../../store/git-store';
import { cn } from '../../../lib/utils';
import { useChatStore } from '../../../store/chat-store';
import { shouldGateGitAction, type GitSafetyAction } from './git-safety';

// ─── Helpers ────────────────────────────────────────────────────────────────

function fileStatusBadge(index: string, working_dir: string) {
  const combo = `${index}${working_dir}`.trim().toUpperCase();
  if (combo.includes('A')) return { label: 'A', cls: 'text-emerald-500' };
  if (combo.includes('M')) return { label: 'M', cls: 'text-amber-400' };
  if (combo.includes('D')) return { label: 'D', cls: 'text-red-400' };
  if (combo.includes('R')) return { label: 'R', cls: 'text-sky-400' };
  if (combo.includes('?')) return { label: 'U', cls: 'text-zinc-400' };
  return { label: '·', cls: 'text-zinc-500' };
}

function basename(path: string) {
  return path.split('/').pop() ?? path;
}

function repoNeedsShipGate(action: GitSafetyAction) {
  // Mirror only: main-process GitGate is authoritative (NES-6.2/6.3).
  // Prefer IPC-evaluated gate state; never trust a window global.
  const state = (globalThis as { __mateGitGateMirror?: { validated?: boolean; status?: string } })
    .__mateGitGateMirror;
  return shouldGateGitAction(action, state);
}

function requestShipGate() {
  window.dispatchEvent(new Event('mate:ship-gate-request'));
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mate-text-metadata">
      {children}
    </span>
  );
}


function FileRow({
  path,
  index,
  workingDir,
  isStaged,
  onStage,
  onUnstage,
}: {
  path: string;
  index: string;
  workingDir: string;
  isStaged: boolean;
  onStage?: () => void;
  onUnstage?: () => void;
}) {
  const badge = fileStatusBadge(index, workingDir);

  return (
    <div className="group flex items-center gap-1.5 rounded-md px-1.5 py-[3px] hover:bg-accent/40">
      <span className={cn('shrink-0 font-mono text-[10px] font-bold leading-none', badge.cls)}>
        {badge.label}
      </span>
      <span className="flex-1 truncate text-xs text-foreground/80" title={path}>
        {basename(path)}
      </span>
      <span className="hidden truncate text-[10px] text-muted-foreground group-hover:block" title={path}>
        {path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : ''}
      </span>
      {isStaged ? (
        <button
          type="button"
          onClick={onUnstage}
          title="Unstage file"
          aria-label={`Unstage ${basename(path)}`}
          className="ml-1 hidden size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 group-hover:inline-flex focus:inline-flex"
        >
          <MinusSquareIcon className="size-4" weight="regular" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onStage}
          title="Stage file"
          aria-label={`Stage ${basename(path)}`}
          className="ml-1 hidden size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 group-hover:inline-flex focus:inline-flex"
        >
          <PlusSquareIcon className="size-4" weight="regular" />
        </button>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function GitPanel() {
  const activeWorkspaceId = useChatStore((state) => state.activeWorkspaceId);
  const {
    status,
    log,
    diff,
    loadStatus,
    operationStatus,
    error,
    commitMessage,
    refresh,
    stageFiles,
    stageAll,
    unstageFiles,
    unstageAll,
    commit,
    push,
    pull,
    setCommitMessage,
  } = useGitStore();

  const isRunning = operationStatus === 'running';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-refresh on mount
  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }

    void refresh();
  }, [activeWorkspaceId, refresh]);

  const staged = status?.files.filter((f) => f.index !== ' ' && f.index !== '?') ?? [];
  const unstaged = status?.files.filter((f) => f.working_dir !== ' ' || f.index === '?') ?? [];

  const canCommit = staged.length > 0 && commitMessage.trim().length > 0 && !isRunning;
  const canPush = (status?.ahead ?? 0) > 0 && !isRunning;
  const canPull = !isRunning;

  useEffect(() => {
    const handleGitAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;

      if (action === 'commit' || action === 'commit-push') {
        if (!canCommit) {
          textareaRef.current?.focus();
          return;
        }

        if ((action === 'commit' || action === 'commit-push') && repoNeedsShipGate(action)) {
          requestShipGate();
          return;
        }

        void (async () => {
          await commit();
          await refresh();
          if (action === 'commit-push') {
            await push();
          }
        })();
        return;
      }

      if (action === 'push-pr') {
        if (repoNeedsShipGate('push-pr')) {
          requestShipGate();
          return;
        }
        void push();
      }
    };

    window.addEventListener('mate:git-action', handleGitAction);
    return () => window.removeEventListener('mate:git-action', handleGitAction);
  }, [canCommit, commit, push, refresh]);

  return (
    <div className="flex flex-col gap-0">
      {/* Branch header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5">
          <GitBranchIcon className="size-3 text-muted-foreground/60" />
          <span className="text-xs font-medium text-foreground/80">
            {status?.current ?? '—'}
          </span>
          {(status?.ahead ?? 0) > 0 && (
            <span className="rounded-full bg-sky-500/15 px-1.5 text-[10px] font-semibold text-sky-400">
              ↑{status!.ahead}
            </span>
          )}
          {(status?.behind ?? 0) > 0 && (
            <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-400">
              ↓{status!.behind}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Pull */}
          <button
            type="button"
            onClick={() => void pull()}
            disabled={!canPull}
            title="Pull"
            aria-label="Pull from remote"
            className="inline-flex size-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowLineDownIcon className="size-4" weight="regular" />
          </button>
          {/* Push */}
          <button
            type="button"
            onClick={() => {
              if (repoNeedsShipGate('push')) {
                requestShipGate();
                return;
              }
              void push();
            }}
            disabled={!canPush}
            title="Push"
            aria-label="Push to remote"
            className="inline-flex size-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowLineUpIcon className="size-4" weight="regular" />
          </button>
          {/* Refresh */}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loadStatus === 'loading'}
            title="Refresh"
            aria-label="Refresh git status"
            className="inline-flex size-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowClockwiseIcon className={cn('size-4', loadStatus === 'loading' && 'animate-spin')} weight="regular" />
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-2 mb-1 rounded-md bg-red-500/10 px-2 py-1.5 text-[10px] text-red-400">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loadStatus === 'loading' && !status && (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <SpinnerGapIcon className="size-4 animate-spin motion-reduce:animate-none" weight="regular" />
        </div>
      )}

      {status && (
        <>
          {/* ── Staged files ── */}
          <div className="px-2 pb-1">
            <div className="mb-0.5 flex items-center justify-between px-1">
              <SectionLabel>Staged ({staged.length})</SectionLabel>
              {staged.length > 0 && (
                <button
                  type="button"
                  onClick={() => void unstageAll()}
                  className="min-h-8 rounded-xl px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
                  title="Unstage all"
                  aria-label="Unstage all files"
                >
                  unstage all
                </button>
              )}
            </div>

            {staged.length === 0 ? (
              <p className="mate-text-secondary px-1 italic">No staged changes</p>
            ) : (
              staged.map((f) => (
                <FileRow
                  key={`staged-${f.path}`}
                  path={f.path}
                  index={f.index}
                  workingDir={f.working_dir}
                  isStaged
                  onUnstage={() => void unstageFiles([f.path])}
                />
              ))
            )}
          </div>

          {/* ── Unstaged / untracked ── */}
          <div className="px-2 pb-1">
            <div className="mb-0.5 flex items-center justify-between px-1">
              <SectionLabel>Changes ({unstaged.length})</SectionLabel>
              {unstaged.length > 0 && (
                <button
                  type="button"
                  onClick={() => void stageAll()}
                  className="min-h-8 rounded-xl px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
                  title="Stage all"
                  aria-label="Stage all files"
                >
                  stage all
                </button>
              )}
            </div>

            {unstaged.length === 0 ? (
              <p className="mate-text-secondary px-1 italic">Working tree clean</p>
            ) : (
              unstaged.map((f) => (
                <FileRow
                  key={`unstaged-${f.path}`}
                  path={f.path}
                  index={f.index}
                  workingDir={f.working_dir}
                  isStaged={false}
                  onStage={() => void stageFiles([f.path])}
                />
              ))
            )}
          </div>

          {/* ── Commit box ── */}
          <div className="mx-2 mt-1 flex flex-col gap-1.5 rounded-lg border border-border/40 bg-muted/20 p-2">
            <textarea
              ref={textareaRef}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Commit message…"
              rows={2}
              className="w-full resize-none rounded-xl bg-transparent px-1 py-0.5 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
            />
            <button
              type="button"
              onClick={() => void commit()}
              disabled={!canCommit}
              aria-label="Commit staged changes"
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all',
                canCommit
                  ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                  : 'cursor-not-allowed bg-muted/20 text-muted-foreground',
              )}
            >
              {isRunning ? (
                <SpinnerGapIcon className="size-4 animate-spin motion-reduce:animate-none" weight="regular" />
              ) : (
                <GitCommitIcon className="size-4" weight="regular" />
              )}
              Commit {staged.length > 0 ? `(${staged.length})` : ''}
            </button>
          </div>

          {/* ── Diff summary ── */}
          {diff && (diff.insertions > 0 || diff.deletions > 0) && (
            <div className="mx-2 mt-2 flex items-center gap-2 rounded-md bg-muted/20 px-2 py-1.5 text-[10px]">
              <span className="text-emerald-400">+{diff.insertions}</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-red-400">-{diff.deletions}</span>
              <span className="ml-auto text-muted-foreground">diff</span>
            </div>
          )}

          {/* ── Commit log ── */}
          {log.length > 0 && (
            <div className="mt-2 px-2 pb-2">
              <div className="mb-0.5 px-1">
                <SectionLabel>History</SectionLabel>
              </div>
              <div className="flex flex-col gap-0.5">
                {log.slice(0, 8).map((entry) => (
                  <div
                    key={entry.hash}
                    className="flex items-start gap-1.5 rounded-md px-1.5 py-[3px] hover:bg-accent/30"
                  >
                    <GitCommitIcon className="mt-[1px] size-4 shrink-0 text-muted-foreground" weight="regular" />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[11px] text-foreground/70">{entry.message}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {entry.author_name} · {entry.hash.slice(0, 7)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
