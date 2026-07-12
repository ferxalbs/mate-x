import { useState, useEffect, useRef } from "react";
import { cn } from "../../../lib/utils";
import { formatRelativeTimestamp } from "../model";
import type { Conversation, RunStatus } from "../../../contracts/chat";
import { useChatStore } from "../../../store/chat-store";
import { Button } from "../../../components/ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";

interface ThreadMenuItemProps {
  thread: Conversation;
  isActive: boolean;
  runStatus: RunStatus;
  onSelectThread: (threadId: string) => void;
  onArchiveThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => Promise<void>;
  getThreadStatusLabel: (
    thread: Conversation,
    isActive: boolean,
    runStatus: RunStatus,
  ) => {
    dotClass: string;
    pulse: boolean;
  };
}

export function ThreadMenuItem({
  thread,
  isActive,
  runStatus,
  onSelectThread,
  onArchiveThread,
  onDeleteThread,
  onRenameThread,
  getThreadStatusLabel,
}: ThreadMenuItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renamingTitle, setRenamingTitle] = useState(thread.title);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const settings = useChatStore((s) => s.settings);
  const inputRef = useRef<HTMLInputElement>(null);

  const status = getThreadStatusLabel(thread, isActive, runStatus);

  useEffect(() => {
    const handleTriggerRename = (event: CustomEvent<{ threadId: string }>) => {
      if (event.detail.threadId === thread.id) {
        setIsRenaming(true);
        setRenamingTitle(thread.title);
      }
    };

    const handleTriggerArchive = (event: CustomEvent<{ threadId: string }>) => {
      if (event.detail.threadId === thread.id) {
        if (settings.archiveConfirmation) {
          setShowArchiveConfirm(true);
        } else {
          onArchiveThread(thread.id);
        }
      }
    };

    const handleTriggerDelete = (event: CustomEvent<{ threadId: string }>) => {
      if (event.detail.threadId === thread.id) {
        if (settings.deleteConfirmation) {
          setShowDeleteConfirm(true);
        } else {
          onDeleteThread(thread.id);
        }
      }
    };

    window.addEventListener(
      "mate:trigger-rename-thread",
      handleTriggerRename as EventListener,
    );
    window.addEventListener(
      "mate:trigger-archive-thread",
      handleTriggerArchive as EventListener,
    );
    window.addEventListener(
      "mate:trigger-delete-thread",
      handleTriggerDelete as EventListener,
    );

    return () => {
      window.removeEventListener(
        "mate:trigger-rename-thread",
        handleTriggerRename as EventListener,
      );
      window.removeEventListener(
        "mate:trigger-archive-thread",
        handleTriggerArchive as EventListener,
      );
      window.removeEventListener(
        "mate:trigger-delete-thread",
        handleTriggerDelete as EventListener,
      );
    };
  }, [
    thread.id,
    thread.title,
    settings.archiveConfirmation,
    settings.deleteConfirmation,
    onArchiveThread,
    onDeleteThread,
  ]);

  const handleRenameSubmit = async () => {
    if (renamingTitle.trim() && renamingTitle.trim() !== thread.title) {
      await onRenameThread(thread.id, renamingTitle.trim());
    }
    setIsRenaming(false);
  };

  return (
    <>
      <button
        onClick={() => onSelectThread(thread.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          void (window as any).mate.ui.showChatContextMenu(thread.id);
        }}
        data-active={isActive}
        className={cn(
          "group relative grid h-[30px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-hidden rounded-lg px-2 text-left text-[12px] outline-none transition-all duration-200",
          isActive
            ? "bg-foreground/[0.06] text-foreground font-medium"
            : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
        )}
        type="button"
      >
        <div className="flex min-w-0 items-center gap-2 pl-1">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              status.dotClass,
              status.pulse ? "animate-pulse" : "",
            )}
          />
          <span className="min-w-0 flex-1 truncate">
            {isRenaming ? (
              <input
                ref={inputRef}
                autoFocus
                className="w-full bg-transparent outline-none"
                value={renamingTitle}
                onChange={(e) => setRenamingTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleRenameSubmit();
                  } else if (e.key === "Escape") {
                    setIsRenaming(false);
                  }
                }}
                onBlur={() => void handleRenameSubmit()}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              thread.title || "New thread"
            )}
          </span>
        </div>

        {!isRenaming && (
          <div className="flex h-full w-[44px] shrink-0 items-center justify-end pr-1">
            <span className="text-[10px] text-muted-foreground/35">
              {formatRelativeTimestamp(thread.lastUpdatedAt)}
            </span>
          </div>
        )}
      </button>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Thread</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{thread.title || "New thread"}"?
              This action cannot be undone and will remove the local chat
              history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onDeleteThread(thread.id)}
                />
              }
            >
              Delete
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showArchiveConfirm}
        onOpenChange={setShowArchiveConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Thread</AlertDialogTitle>
            <AlertDialogDescription>
              Move "{thread.title || "New thread"}" to archive? It will be
              hidden from your active threads list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button size="sm" onClick={() => onArchiveThread(thread.id)} />
              }
            >
              Archive
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
