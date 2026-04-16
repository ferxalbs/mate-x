import { useEffect, useRef } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  GitBranchIcon,
  GitCommitHorizontal,
  Loader2,
  MinusSquare,
  PlusSquare,
  RefreshCwIcon,
} from 'lucide-react';

import { useGitStore } from '../../../store/git-store';
import { cn } from '../../../lib/utils';
import { useChatStore } from '../../../store/chat-store';

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

// ─── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
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
      <span className="hidden truncate text-[9px] text-muted-foreground/30 group-hover:block" title={path}>
        {path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : ''}
      </span>
      {isStaged ? (
        <button
          onClick={onUnstage}
          title="Unstage file"
          className="ml-1 hidden shrink-0 text-muted-foreground/40 transition-colors hover:text-foreground group-hover:block"
        >
          <MinusSquare className="size-3" />
        </button>
      ) : (
        <button
          onClick={onStage}
          title="Stage file"
          className="ml-1 hidden shrink-0 text-muted-foreground/40 transition-colors hover:text-emerald-400 group-hover:block"
        >
          <PlusSquare className="size-3" />
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
    void refresh();
  }, [activeWorkspaceId, refresh]);

  const staged = status?.files.filter((f) => f.index !== ' ' && f.index !== '?') ?? [];
  const unstaged = status?.files.filter((f) => f.working_dir !== ' ' || f.index === '?') ?? [];

  const canCommit = staged.length > 0 && commitMessage.trim().length > 0 && !isRunning;
  const canPush = (status?.ahead ?? 0) > 0 && !isRunning;
  const canPull = !isRunning;

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
            <span className="rounded-full bg-sky-500/15 px-1.5 text-[9px] font-semibold text-sky-400">
              ↑{status!.ahead}
            </span>
          )}
          {(status?.behind ?? 0) > 0 && (
            <span className="rounded-full bg-amber-500/15 px-1.5 text-[9px] font-semibold text-amber-400">
              ↓{status!.behind}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Pull */}
          <button
            onClick={() => void pull()}
            disabled={!canPull}
            title="Pull"
            className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowDownToLine className="size-3" />
          </button>
          {/* Push */}
          <button
            onClick={() => void push()}
            disabled={!canPush}
            title="Push"
            className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUpFromLine className="size-3" />
          </button>
          {/* Refresh */}
          <button
            onClick={() => void refresh()}
            disabled={loadStatus === 'loading'}
            title="Refresh"
            className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          >
            <RefreshCwIcon className={cn('size-3', loadStatus === 'loading' && 'animate-spin')} />
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
        <div className="flex items-center justify-center py-6 text-muted-foreground/40">
          <Loader2 className="size-4 animate-spin" />
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
                  onClick={() => void unstageAll()}
                  className="text-[9px] text-muted-foreground/40 hover:text-foreground"
                  title="Unstage all"
                >
                  unstage all
                </button>
              )}
            </div>

            {staged.length === 0 ? (
              <p className="px-1 text-[10px] text-muted-foreground/30 italic">No staged changes</p>
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
                  onClick={() => void stageAll()}
                  className="text-[9px] text-muted-foreground/40 hover:text-emerald-400"
                  title="Stage all"
                >
                  stage all
                </button>
              )}
            </div>

            {unstaged.length === 0 ? (
              <p className="px-1 text-[10px] text-muted-foreground/30 italic">Working tree clean</p>
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
              className="w-full resize-none rounded-md bg-transparent px-1 py-0.5 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none"
            />
            <button
              onClick={() => void commit()}
              disabled={!canCommit}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all',
                canCommit
                  ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                  : 'cursor-not-allowed bg-muted/20 text-muted-foreground/30',
              )}
            >
              {isRunning ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <GitCommitHorizontal className="size-3" />
              )}
              Commit {staged.length > 0 ? `(${staged.length})` : ''}
            </button>
          </div>

          {/* ── Diff summary ── */}
          {diff && (diff.insertions > 0 || diff.deletions > 0) && (
            <div className="mx-2 mt-2 flex items-center gap-2 rounded-md bg-muted/20 px-2 py-1.5 text-[10px]">
              <span className="text-emerald-400">+{diff.insertions}</span>
              <span className="text-muted-foreground/40">/</span>
              <span className="text-red-400">-{diff.deletions}</span>
              <span className="ml-auto text-muted-foreground/30">diff</span>
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
                    <GitCommitHorizontal className="mt-[1px] size-3 shrink-0 text-muted-foreground/30" />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[11px] text-foreground/70">{entry.message}</span>
                      <span className="text-[9px] text-muted-foreground/30">
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
