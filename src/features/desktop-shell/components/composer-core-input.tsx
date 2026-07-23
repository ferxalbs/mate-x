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
    <div className="relative z-10 px-5 pt-4 sm:px-6">
      {workspace?.branch ? (
        <span className="sr-only" data-testid="composer-branch">
          {workspace.branch.trim()}
        </span>
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
