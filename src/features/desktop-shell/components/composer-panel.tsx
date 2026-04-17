import { ArrowUpIcon, LoaderCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '../../../components/ui/button';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import type { WorkspaceSummary } from '../../../contracts/workspace';
import { cn } from '../../../lib/utils';

interface ComposerPanelProps {
  isRunning: boolean;
  workspace: WorkspaceSummary | null;
  resolvedTheme: 'light' | 'dark';
  onSubmit: (prompt: string) => Promise<void>;
}

export function ComposerPanel({
  isRunning,
  workspace,
  resolvedTheme,
  onSubmit,
}: ComposerPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [modelValue, setModelValue] = useState('gpt-5.2');
  const [reasoningValue, setReasoningValue] = useState('high');
  const [modeValue, setModeValue] = useState('build');
  const [accessValue, setAccessValue] = useState('full');

  async function handleSubmit() {
    const nextPrompt = prompt.trim();

    if (!nextPrompt || isRunning) {
      return;
    }

    setPrompt('');
    await onSubmit(nextPrompt);
  }

  return (
    <div className="px-6 pb-5 pt-2">
      <div className="mx-auto w-full max-w-[980px]">
        <div className="rounded-[22px] border border-[var(--panel-border)] bg-[var(--panel)] shadow-none">
          <div className="px-4 pt-4">
            <textarea
              className="min-h-[118px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="Ask anything, @tag files/folders, or use / to show available commands"
              value={prompt}
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--panel-border)] px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto turn-chip-strip">
              <InlineSelect value={modelValue} onValueChange={setModelValue}>
                <SelectItem value="gpt-5.2">gpt-5.2</SelectItem>
                <SelectItem value="gpt-5.3-codex">GPT-5.3 Codex</SelectItem>
                <SelectItem value="gpt-5.4-mini">GPT-5.4 Mini</SelectItem>
              </InlineSelect>
              <InlineSelect value={reasoningValue} onValueChange={setReasoningValue}>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="max">Max</SelectItem>
              </InlineSelect>
              <InlineSelect value={modeValue} onValueChange={setModeValue}>
                <SelectItem value="build">Build</SelectItem>
                <SelectItem value="plan">Plan</SelectItem>
              </InlineSelect>
              <InlineSelect value={accessValue} onValueChange={setAccessValue}>
                <SelectItem value="full">Full access</SelectItem>
                <SelectItem value="approval">Approval required</SelectItem>
              </InlineSelect>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                aria-label={isRunning ? 'Thinking' : 'Send'}
                className={cn(
                  'size-9 rounded-full border-0 bg-[#2f5cff] p-0 text-white shadow-none hover:bg-[#3b66ff]',
                  isRunning ? 'opacity-90' : '',
                )}
                disabled={isRunning}
                onClick={handleSubmit}
                size="icon-sm"
                variant="outline"
              >
                {isRunning ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowUpIcon className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span>Current checkout</span>
          <span>{workspace?.branch ?? 'main'}</span>
        </div>
      </div>
    </div>
  );
}

function InlineSelect({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onValueChange(nextValue);
        }
      }}
    >
      <SelectTrigger
        size="xs"
        variant="ghost"
        className="h-6 min-w-fit shrink-0 rounded-md border-0 px-2 text-[12px] text-muted-foreground shadow-none hover:bg-accent"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>{children}</SelectPopup>
    </Select>
  );
}
