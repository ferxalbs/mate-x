import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckIcon,
  ExternalLinkIcon,
  FileTextIcon,
  Loader2Icon,
  RefreshCcwIcon,
  SaveIcon,
} from 'lucide-react';

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
    <SettingsSection title="Workspace Memory" icon={<FileTextIcon className="size-3.5" />}>
      <div className="flex flex-col gap-4">
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
              className="h-8 rounded-lg px-3 text-[12px] shadow-none"
              onClick={() => void handleReveal()}
              disabled={isBusy || !status}
            >
              <ExternalLinkIcon className="size-3.5" />
              Reveal
            </Button>
          }
        />

        <div className="flex flex-wrap gap-2">
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
                  'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs transition-colors',
                  isActive
                    ? 'border-foreground/20 bg-foreground text-background'
                    : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <FileTextIcon className="size-3.5" />
                <span>{file?.filename ?? kind}</span>
                {fileHasDraft ? (
                  <span className="size-1.5 rounded-full bg-amber-400" />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="rounded-md border border-border/70 bg-background">
          <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border/70 px-3">
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
              <Loader2Icon className="mr-2 size-4 animate-spin" />
              Loading workspace memory
            </div>
          ) : (
            <textarea
              className="min-h-[420px] w-full resize-y bg-transparent p-3 font-mono text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground/50"
              value={activeDraft}
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

        <div className="flex items-center justify-between gap-4">
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
              className="h-9 rounded-lg px-3"
              onClick={() => void handleReset()}
              disabled={isBusy || !activeFile}
            >
              <RefreshCcwIcon className="size-4" />
              Reset file
            </Button>
            <Button
              size="sm"
              className="h-9 rounded-lg px-4"
              onClick={() => void handleSave()}
              disabled={isBusy || !hasDraft}
            >
              {saveState === 'saving' ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : saveState === 'saved' ? (
                <CheckIcon className="size-4" />
              ) : (
                <SaveIcon className="size-4" />
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
