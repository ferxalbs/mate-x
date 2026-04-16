import { ArrowUpRight, LoaderCircle, Lock, MessageSquareText, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '../../../components/ui/button';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import { cn } from '../../../lib/utils';
import { getWorkspaceFact } from '../model';

interface ComposerPanelProps {
  isRunning: boolean;
  workspace: WorkspaceSummary | null;
  resolvedTheme: 'light' | 'dark';
  onSubmit: (prompt: string) => Promise<void>;
}

export function ComposerPanel({ isRunning, workspace, resolvedTheme, onSubmit }: ComposerPanelProps) {
  const [prompt, setPrompt] = useState('');
  const provider = getWorkspaceFact(workspace, 'AI provider');
  const model = getWorkspaceFact(workspace, 'Model') ?? 'gpt-5.2';

  async function handleSubmit() {
    const nextPrompt = prompt.trim();

    if (!nextPrompt || isRunning) {
      return;
    }

    setPrompt('');
    await onSubmit(nextPrompt);
  }

  return (
    <div className="border-t border-[var(--panel-border)] bg-[var(--background)] px-6 py-5">
      <div className="mx-auto w-full max-w-[860px]">
        <div className="rounded-[28px] border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-4">
          <textarea
            className={cn(
              'min-h-[152px] w-full resize-none rounded-[24px] border border-transparent bg-transparent px-1 py-1 text-[15px] leading-7 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]',
              'selection:bg-[color-mix(in_srgb,var(--primary)_22%,transparent)]',
            )}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder="Ask anything, @tag files/folders, or use /model"
            value={prompt}
          />

          <div className="mt-4 flex flex-col gap-3 border-t border-[var(--panel-border)] pt-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <ControlChip icon={<Sparkles className="size-3.5" />} label={model} />
              <ControlChip label="High" />
              <ControlChip icon={<MessageSquareText className="size-3.5" />} label="Chat" />
              <ControlChip icon={<Lock className="size-3.5" />} label="Full access" />
              <ControlChip label={provider ?? 'OpenAI'} tone="subtle" />
              <ControlChip label={resolvedTheme === 'dark' ? 'Night' : 'Day'} tone="subtle" />
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[var(--muted-foreground)]">
                Press `Cmd/Ctrl + Enter` to send.
              </p>
              <Button
                className="h-12 rounded-full border-[#ff4567] bg-[#ff4567] px-5 text-white shadow-none hover:border-[#ff5b78] hover:bg-[#ff5b78]"
                disabled={isRunning}
                onClick={handleSubmit}
                size="sm"
                variant="outline"
              >
                {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {isRunning ? 'Thinking' : 'Send'}
                <ArrowUpRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlChip({
  label,
  icon,
  tone = 'default',
}: {
  label: string;
  icon?: ReactNode;
  tone?: 'default' | 'subtle';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.18em]',
        tone === 'subtle'
          ? 'border-[var(--panel-border)] bg-[var(--surface)] text-[var(--muted-foreground)]'
          : 'border-[var(--panel-border)] bg-[var(--surface)] text-[var(--foreground)]',
      )}
    >
      {icon}
      {label}
    </span>
  );
}
