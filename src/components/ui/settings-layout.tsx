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
    <section className="space-y-4 pb-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/50">
          <span className="inline-block h-px w-3 bg-border" aria-hidden />
          {icon}
          {title}
        </h2>
        {headerAction}
      </div>
      <div className="flex flex-col">
        {children}
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
        "border-b border-border/40 py-4 last:border-b-0",
        children ? "pb-0" : ""
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-1">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
              {title}
            </h3>
            {resetAction ? (
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                {resetAction}
              </span>
            ) : null}
          </div>
          <p className="break-words text-xs leading-relaxed text-muted-foreground/80">
            {description}
          </p>
          {status ? (
            <div className="pt-0.5 break-all text-[11px] text-muted-foreground">
              {status}
            </div>
          ) : null}
        </div>
        {control ? (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end px-1 sm:px-0">
            {control}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="px-1 pt-4 pb-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}
