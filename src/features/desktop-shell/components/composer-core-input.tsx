import { HugeiconsIcon } from "@hugeicons/react";
import { FolderIcon, GitBranchIcon } from "@hugeicons/core-free-icons";

import type { KeyboardEvent, ReactNode } from "react";

import type { WorkspaceSummary } from "../../../contracts/workspace";

export function ComposerCoreInput({
  attachments,
  onChange,
  onSubmit,
  value,
  workspace,
}: {
  attachments: ReactNode;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
  workspace: WorkspaceSummary | null;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="relative z-10 px-5 pt-3 sm:px-6">
      {workspace ? (
        <div
          aria-label={`Repository ${workspace.name}, branch ${workspace.branch?.trim() || "detached"}`}
          className="mb-2 flex min-w-0 items-center gap-3 text-[11px] font-medium text-muted-foreground"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <HugeiconsIcon icon={FolderIcon} aria-hidden className="size-3.5 shrink-0" />
            <span className="max-w-[18rem] truncate">{workspace.name}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <HugeiconsIcon icon={GitBranchIcon} aria-hidden className="size-3.5 shrink-0" />
            <span className="max-w-[14rem] truncate" data-testid="composer-branch">
              {workspace.branch?.trim() || "detached"}
            </span>
          </span>
          <span className="ml-auto hidden shrink-0 text-muted-foreground/70 min-[1024px]:inline">
            Local repository
          </span>
        </div>
      ) : null}
      <textarea
        aria-label="Objective"
        className="min-h-[56px] w-full resize-none bg-transparent text-[15px] font-medium leading-6 text-foreground outline-none placeholder:text-foreground/45 focus:placeholder:text-foreground/60"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          workspace
            ? `What do you want to verify in ${workspace.name}?`
            : "Open a repository to start"
        }
        value={value}
      />
      {attachments}
    </div>
  );
}
