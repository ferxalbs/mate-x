import { useEffect, useMemo, useState } from "react";

import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "../../../components/ui/command";
import { Kbd, KbdGroup } from "../../../components/ui/kbd";
import type { Conversation } from "../../../contracts/chat";

interface SearchModalProps {
  open: boolean;
  workspaceName: string;
  threads: Conversation[];
  activeThreadId: string;
  onOpenChange: (open: boolean) => void;
  onSelectThread: (threadId: string) => void;
}

export function SearchModal({
  open,
  workspaceName,
  threads,
  activeThreadId,
  onOpenChange,
  onSelectThread,
}: SearchModalProps) {
  const [query, setQuery] = useState("");
  const visibleThreads = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return threads
      .filter((thread) => !thread.isArchived)
      .filter((thread) => {
        if (!needle) return true;
        return `${thread.title} ${workspaceName}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt))
      .slice(0, 8);
  }, [query, threads, workspaceName]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup className="max-w-[520px] rounded-[24px] border-[var(--panel-border)]/45 bg-[var(--mate-panel-bg)] text-foreground shadow-2xl shadow-black/20 backdrop-blur-2xl before:hidden">
        <Command>
          <CommandInput
            placeholder="Search chats"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <CommandList className="max-h-[360px]">
            {visibleThreads.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground/75">
                No chats found.
              </div>
            ) : (
              <CommandGroup>
                <CommandGroupLabel className="px-3 py-2 text-[11px] text-muted-foreground/75">
                  Recent chats
                </CommandGroupLabel>
                {visibleThreads.map((thread, index) => (
                  <CommandItem
                    key={thread.id}
                    value={`${thread.title} ${workspaceName}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-2xl px-3 py-2 text-sm data-[highlighted]:bg-accent/80"
                    onClick={() => {
                      onSelectThread(thread.id);
                      onOpenChange(false);
                    }}
                  >
                    <span className="truncate text-foreground/90">
                      {thread.title || "Untitled"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground/70">
                      {workspaceName}
                    </span>
                    <CommandShortcut>⌘{index + 1}</CommandShortcut>
                    {thread.id === activeThreadId ? (
                      <span className="sr-only">Current chat</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="flex items-center justify-between border-t border-[var(--panel-border)]/35 px-4 py-3 text-[11px] text-muted-foreground/70">
            <span>Open chat</span>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </div>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
