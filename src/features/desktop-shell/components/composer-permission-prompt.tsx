import { Button } from "../../../components/ui/button";
import type { PolicyStop, PolicyStopAction } from "../../../contracts/policy";

export function ComposerPermissionPrompt({
  disabled,
  onAction,
  stop,
}: {
  disabled: boolean;
  onAction: (action: PolicyStopAction) => void;
  stop: PolicyStop;
}) {
  const toolName = stop.attemptedAction.toolName ?? "tool action";
  const target =
    stop.attemptedAction.command ??
    stop.attemptedAction.target ??
    stop.policyId;
  const canApprove = stop.availableActions.includes("approve_once");
  const canDecline =
    stop.availableActions.includes("safer_alternative") ||
    stop.availableActions.includes("abort");

  return (
    <section
      aria-label="Approval required"
      className="border-b border-border/40 px-5 py-3.5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Approval required
            </span>
            <span className="text-muted-foreground">{toolName}</span>
            <span className="max-w-full truncate font-mono text-[10px] text-muted-foreground">
              {target}
            </span>
          </div>
          <p className="mt-2 break-words text-[13px] font-medium text-foreground">
            {stop.title}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canDecline ? (
            <Button
              className="h-8 rounded-full px-3.5 text-[11px] shadow-none"
              disabled={disabled}
              onClick={() =>
                onAction(
                  stop.availableActions.includes("safer_alternative")
                    ? "safer_alternative"
                    : "abort",
                )
              }
              size="xs"
              variant="outline"
            >
              Review command
            </Button>
          ) : null}
          {canApprove ? (
            <Button
              className="h-8 rounded-full px-3.5 text-[11px] shadow-none"
              disabled={disabled}
              onClick={() => onAction("approve_once")}
              size="xs"
            >
              Approve once
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
