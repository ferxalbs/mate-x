import { useState } from 'react';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';

import { Button } from '../../../components/ui/button';

interface ComposerProps {
  isRunning: boolean;
  onSubmit: (prompt: string) => Promise<void>;
}

const starterPrompts = [
  'Audit this repo for architectural blockers',
  'Review the desktop boundary and IPC design',
  'List the modules needed for a real repo inspector',
];

export function Composer({ isRunning, onSubmit }: ComposerProps) {
  const [prompt, setPrompt] = useState('');

  async function handleSubmit() {
    const nextPrompt = prompt.trim();

    if (!nextPrompt) {
      return;
    }

    setPrompt('');
    await onSubmit(nextPrompt);
  }

  return (
    <div className="rounded-[1.75rem] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.18)]">
      <div className="flex flex-wrap gap-2">
        {starterPrompts.map((item) => (
          <button
            key={item}
            className="rounded-full border border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_80%,white)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
            onClick={() => setPrompt(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <textarea
          className="min-h-32 resize-none rounded-[1.5rem] border border-[var(--border)] bg-[color-mix(in_oklab,var(--background)_14%,transparent)] px-4 py-4 text-sm leading-7 outline-none transition placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)]"
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask for an audit, repo review, execution plan, or next implementation step."
          value={prompt}
        />

        <div className="flex items-end justify-end">
          <Button className="w-full lg:w-auto" disabled={isRunning} onClick={handleSubmit}>
            {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {isRunning ? 'Running audit' : 'Run prompt'}
            <ArrowUpRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
