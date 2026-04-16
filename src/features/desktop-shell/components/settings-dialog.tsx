import { Dialog } from '@base-ui/react/dialog';
import { FolderGit2, Search, Sparkles, X } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import type { SearchMatch, WorkspaceSummary } from '../../../contracts/workspace';

interface SettingsDialogProps {
  workspace: WorkspaceSummary | null;
  repoFiles: string[];
  repoSignals: SearchMatch[];
}

export function SettingsDialog({ workspace, repoFiles, repoSignals }: SettingsDialogProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        render={
          <Button size="icon-sm" variant="ghost" aria-label="Open workspace overview">
            <Sparkles className="size-4" />
          </Button>
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[4px]" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex w-[min(760px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] border border-[var(--panel-border)] bg-[var(--panel)] shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--panel-border)] px-6 py-5">
            <div>
              <Dialog.Title className="text-lg font-semibold text-[var(--foreground)]">
                Workspace overview
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[var(--muted-foreground)]">
                Repo surface, AI runtime readiness, and the files currently shaping the shell.
              </Dialog.Description>
            </div>
            <Dialog.Close
              render={
                <Button size="icon-sm" variant="ghost" aria-label="Close overview">
                  <X className="size-4" />
                </Button>
              }
            />
          </div>

          <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-[1.1fr_0.9fr]">
            <section className="min-h-0 overflow-y-auto border-r border-[var(--panel-border)] px-6 py-5">
              <div className="flex items-start gap-3 rounded-[22px] border border-[var(--panel-border)] bg-[var(--surface)] p-4">
                <div className="rounded-2xl bg-[var(--surface-soft)] p-3 text-[var(--foreground)]">
                  <FolderGit2 className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
                    Workspace
                  </p>
                  <h3 className="mt-1 truncate text-base font-semibold text-[var(--foreground)]">
                    {workspace?.name ?? 'Loading'}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {workspace?.path ?? 'Collecting repo metadata'}
                  </p>
                  <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                    Branch {workspace?.branch ?? '...'} · Live snapshot
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-2">
                {workspace?.facts.map((fact) => (
                  <div
                    key={fact.label}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--panel-border)] bg-[var(--surface)] px-4 py-3"
                  >
                    <span className="text-sm text-[var(--muted-foreground)]">{fact.label}</span>
                    <span className="text-sm font-medium text-[var(--foreground)]">{fact.value}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid min-h-0 grid-rows-[auto_1fr] overflow-hidden">
              <div className="border-b border-[var(--panel-border)] px-6 py-5">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
                  <Search className="size-3.5" />
                  Prompt-linked files
                </div>
                <div className="mt-3 space-y-2">
                  {repoSignals.length > 0 ? (
                    repoSignals.slice(0, 5).map((signal) => (
                      <div
                        key={`${signal.file}:${signal.line}`}
                        className="rounded-2xl border border-[var(--panel-border)] bg-[var(--surface)] px-4 py-3"
                      >
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          {signal.file}:{signal.line}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-[var(--muted-foreground)]">
                          {signal.text}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-[var(--panel-border)] px-4 py-4 text-sm text-[var(--muted-foreground)]">
                      No repo signals loaded yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="min-h-0 overflow-y-auto px-6 py-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
                  File inventory
                </p>
                <div className="mt-3 space-y-2">
                  {repoFiles.map((file) => (
                    <div
                      key={file}
                      className="rounded-2xl border border-[var(--panel-border)] bg-[var(--surface)] px-4 py-2.5 font-mono text-xs text-[var(--foreground)]"
                    >
                      {file}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
