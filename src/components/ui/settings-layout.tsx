import type { ReactNode } from "react";
import { cn } from "../../lib/utils";


export function SettingsSection({
  title,
  icon,
  headerAction,
  children,
}: {
  title: string;
  icon?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 pb-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="mate-text-metadata flex items-center gap-2 text-muted-foreground/80">
          {icon}
          {title}
        </h2>
        {headerAction}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-[var(--panel)]/60 shadow-none">
        <div className="flex flex-col">
          {children}
        </div>
      </div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  status,
  resetAction,
  control,
  children,
}: {
  title: ReactNode;
  description: string;
  status?: ReactNode;
  resetAction?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-b border-border/25 py-3.5 px-4 sm:px-5 last:border-b-0",
        children ? "pb-0" : ""
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="mate-text-compact break-words font-semibold tracking-[-0.01em]">
              {title}
            </h3>
            {resetAction ? (
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                {resetAction}
              </span>
            ) : null}
          </div>
          <p className="mate-text-secondary break-words">
            {description}
          </p>
          {status ? (
            <div className="mate-text-secondary break-all pt-0.5">
              {status}
            </div>
          ) : null}
        </div>
        {control ? (
          <div className="flex min-w-0 w-full items-center gap-2 sm:w-auto sm:max-w-[min(52%,28rem)] sm:justify-end [&>*]:min-w-0">
            {control}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="pt-3.5 pb-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}

