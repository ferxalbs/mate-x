import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Tick01Icon,
  ExternalLinkIcon,
  File02Icon,
  Loading01Icon,
  ReloadIcon,
  SaveIcon,
} from '@hugeicons/core-free-icons';

import { Button } from '../../components/ui/button';
import { SettingsRow, SettingsSection } from '../../components/ui/settings-layout';
import type {
  WorkspaceMemoryFile,
  WorkspaceMemoryFileKind,
  WorkspaceMemoryStatus,
} from '../../contracts/workspace';
import { cn } from '../../lib/utils';
import {
  getWorkspaceMemoryStatus,
  resetWorkspaceMemoryFile,
  revealWorkspaceMemoryFolder,
  writeWorkspaceMemoryFile,
} from '../../services/repo-client';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const FILE_ORDER: WorkspaceMemoryFileKind[] = ['memory', 'guardrails', 'workstate'];

export function WorkspaceMemorySettings() {
  const [status, setStatus] = useState<WorkspaceMemoryStatus | null>(null);
  const [activeKind, setActiveKind] = useState<WorkspaceMemoryFileKind>('memory');
  const [drafts, setDrafts] = useState<Record<WorkspaceMemoryFileKind, string>>({
    memory: '',
    guardrails: '',
    workstate: '',
  });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const filesByKind = useMemo(() => {
    const files = new Map<WorkspaceMemoryFileKind, WorkspaceMemoryFile>();
    status?.files.forEach((file) => files.set(file.kind, file));
    return files;
  }, [status]);

  const activeFile = filesByKind.get(activeKind);
  const activeDraft = drafts[activeKind];
  const hasDraft = Boolean(activeFile && activeDraft !== activeFile.content);
  const isBusy = isLoading || saveState === 'saving';

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');

    try {
      const nextStatus = await getWorkspaceMemoryStatus();
      setStatus(nextStatus);
      setDrafts({
        memory: nextStatus.files.find((file) => file.kind === 'memory')?.content ?? '',
        guardrails: nextStatus.files.find((file) => file.kind === 'guardrails')?.content ?? '',
        workstate: nextStatus.files.find((file) => file.kind === 'workstate')?.content ?? '',
      });
      setSaveState('idle');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not load workspace memory.');
      setSaveState('error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSave = useCallback(async () => {
    if (!hasDraft) return;

    setSaveState('saving');
    setErrorMessage('');

    try {
      const nextStatus = await writeWorkspaceMemoryFile(activeKind, activeDraft);
      setStatus(nextStatus);
      setDrafts((current) => ({
        ...current,
        [activeKind]: nextStatus.files.find((file) => file.kind === activeKind)?.content ?? activeDraft,
      }));
      setSaveState('saved');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save workspace memory.');
      setSaveState('error');
    }
  }, [activeDraft, activeKind, hasDraft]);

  const handleReset = useCallback(async () => {
    setSaveState('saving');
    setErrorMessage('');

    try {
      const nextStatus = await resetWorkspaceMemoryFile(activeKind);
      setStatus(nextStatus);
      setDrafts((current) => ({
        ...current,
        [activeKind]: nextStatus.files.find((file) => file.kind === activeKind)?.content ?? '',
      }));
      setSaveState('saved');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not reset workspace memory.');
      setSaveState('error');
    }
  }, [activeKind]);

  const handleReveal = useCallback(async () => {
    try {
      await revealWorkspaceMemoryFolder();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not reveal memory folder.');
      setSaveState('error');
    }
  }, []);

  return (
    <SettingsSection title="Workspace Memory" icon={<HugeiconsIcon icon={File02Icon} className="size-3.5" />}>
      <div className="flex min-w-0 flex-col gap-4">
        <SettingsRow
          title="Storage"
          description={
            status
              ? `Private app storage for ${status.repoPath}. Files are not written into the repository.`
              : 'Private app storage for the active workspace.'
          }
          status={status?.storagePath}
          control={
            <Button
              size="xs"
              variant="outline"
              className="h-8 rounded-xl px-3 text-[12px] shadow-none"
              onClick={() => void handleReveal()}
              disabled={isBusy || !status}
            >
              <HugeiconsIcon icon={ExternalLinkIcon} className="size-3.5" />
              Reveal
            </Button>
          }
        />

        <div className="flex flex-wrap gap-2 px-4 sm:px-5">
          {FILE_ORDER.map((kind) => {
            const file = filesByKind.get(kind);
            const isActive = kind === activeKind;
            const fileHasDraft = Boolean(file && drafts[kind] !== file.content);

            return (
              <button
                key={kind}
                type="button"
                onClick={() => setActiveKind(kind)}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs transition-colors cursor-pointer',
                  isActive
                    ? 'border-foreground/20 bg-foreground text-background'
                    : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <HugeiconsIcon icon={File02Icon} className="size-3.5" />
                <span>{file?.filename ?? kind}</span>
                {fileHasDraft ? (
                  <span className="size-1.5 rounded-full bg-amber-400" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mx-4 mb-1 rounded-2xl border border-border/70 bg-background sm:mx-5 overflow-hidden">
          <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border/70 px-3 bg-muted/20">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-foreground">
                {activeFile?.title ?? 'Workspace memory'}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {activeFile?.description ?? 'Loading workspace memory file.'}
              </div>
            </div>
            <div className="shrink-0 text-[11px] text-muted-foreground">
              {activeFile ? `Updated ${formatDateTime(activeFile.updatedAt)}` : null}
            </div>
          </div>

          {isLoading ? (
            <div className="flex min-h-[340px] items-center justify-center text-sm text-muted-foreground">
              <HugeiconsIcon icon={Loading01Icon} className="mr-2 size-4 animate-spin" />
              Loading workspace memory
            </div>
          ) : (
            <textarea
              className="min-h-[420px] w-full resize-y bg-transparent p-4 font-mono text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground/50 transition-colors duration-150 ease-[var(--ease-out)] focus:bg-[var(--accent)]/10"
              value={activeDraft}
              aria-label={activeFile?.title ?? 'Workspace memory file'}
              onChange={(event) => {
                setDrafts((current) => ({
                  ...current,
                  [activeKind]: event.target.value,
                }));
                if (saveState === 'saved') {
                  setSaveState('idle');
                }
              }}
              spellCheck={false}
              disabled={isBusy}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 px-4 pb-4 sm:px-5 sm:pb-5">
          <div className="min-h-5 text-xs text-muted-foreground">
            {saveState === 'error' ? (
              <span className="text-destructive-foreground">{errorMessage}</span>
            ) : hasDraft ? (
              <span>Pending changes in {activeFile?.filename}</span>
            ) : saveState === 'saved' ? (
              <span>Workspace memory saved</span>
            ) : (
              <span>Workspace memory is explicit, editable operational context.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-9 rounded-xl px-3"
              onClick={() => void handleReset()}
              disabled={isBusy || !activeFile}
            >
              <HugeiconsIcon icon={ReloadIcon} className="size-4" />
              Reset file
            </Button>
            <Button
              size="sm"
              className="h-9 rounded-xl px-4"
              onClick={() => void handleSave()}
              disabled={isBusy || !hasDraft}
            >
              {saveState === 'saving' ? (
                <HugeiconsIcon icon={Loading01Icon} className="size-4 animate-spin" />
              ) : saveState === 'saved' ? (
                <HugeiconsIcon icon={Tick01Icon} className="size-4" />
              ) : (
                <HugeiconsIcon icon={SaveIcon} className="size-4" />
              )}
              Save file
            </Button>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
