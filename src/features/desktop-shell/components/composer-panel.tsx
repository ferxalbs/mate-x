import { ArrowUpRight, LoaderCircle, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../../components/ui/button';
import { Textarea } from '../../../components/ui/textarea';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import { getWorkspaceFact } from '../model';

interface ComposerPanelProps {
  isRunning: boolean;
  workspace: WorkspaceSummary | null;
  onSubmit: (prompt: string) => Promise<void>;
}

export function ComposerPanel({ isRunning, workspace, onSubmit }: ComposerPanelProps) {
  const [prompt, setPrompt] = useState('');
  const aiProvider = getWorkspaceFact(workspace, 'AI provider');

  async function handleSubmit() {
    const nextPrompt = prompt.trim();

    if (!nextPrompt || isRunning) {
      return;
    }

    setPrompt('');
    await onSubmit(nextPrompt);
  }

  return (
    <div className="border-t border-[var(--border)] px-4 py-4 sm:px-6">
      <div className="mx-auto w-full max-w-[880px] rounded-[28px] border border-[var(--border)] bg-[linear-gradient(180deg,var(--panel)_0%,var(--surface)_100%)] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--panel-border)] pb-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--muted-foreground)]">
              Composer
            </p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Ship the next desktop step, review a file, or ask for a repo-grounded plan.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs text-[var(--foreground)]">
            <Sparkles className="size-3.5" />
            {aiProvider ?? 'Checking provider'}
          </div>
        </div>

        <div className="mt-4">
          <Textarea
            className="rounded-[22px]"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder="Describe the UI step, repo change, or implementation pass you want next."
            value={prompt}
          />

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--muted-foreground)]">Press `Cmd/Ctrl + Enter` to send.</p>
            <Button className="h-9 px-4" disabled={isRunning} onClick={handleSubmit} size="sm">
              {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {isRunning ? 'Thinking' : 'Send to Mate-X'}
              <ArrowUpRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
