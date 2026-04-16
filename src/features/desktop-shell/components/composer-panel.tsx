import { ArrowUpRight, LoaderCircle } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../../components/ui/button';
import { Textarea } from '../../../components/ui/textarea';

interface ComposerPanelProps {
  isRunning: boolean;
  onSubmit: (prompt: string) => Promise<void>;
}

export function ComposerPanel({ isRunning, onSubmit }: ComposerPanelProps) {
  const [prompt, setPrompt] = useState('');

  async function handleSubmit() {
    const nextPrompt = prompt.trim();

    if (!nextPrompt || isRunning) {
      return;
    }

    setPrompt('');
    await onSubmit(nextPrompt);
  }

  return (
    <div className="border-t border-[var(--border)] px-3 py-3 sm:px-5">
      <div className="mx-auto w-full max-w-4xl rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-[0_1px_2px_rgba(0,0,0,0.14)]">
        <div>
          <Textarea
            className="rounded-lg"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the audit, review, implementation step, or UI pass you want next."
            value={prompt}
          />

          <div className="mt-3 flex items-center justify-end">
            <Button className="h-8 px-3" disabled={isRunning} onClick={handleSubmit} size="sm">
              {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {isRunning ? 'Running' : 'Send prompt'}
              <ArrowUpRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
