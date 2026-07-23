import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { SettingsRow } from "../../components/ui/settings-layout";
import type { LinearIntegrationStatus } from "../../contracts/linear-integration";

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Linear could not complete that action.";
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, "").slice(0, 240);
}

export function LinearIntegrationSettings() {
  const [status, setStatus] = useState<LinearIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => window.mate.settings.getLinearStatus().then(setStatus).catch((cause) => setError(errorMessage(cause))), []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const connected = status?.state === "connected" || status?.state === "permission_changed";
  const retryable = retryAvailable || status?.state === "error" || status?.state === "revoked";
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setRetryAvailable(false);
      await refresh();
    } catch (cause) {
      setRetryAvailable(true);
      setError(errorMessage(cause));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsRow
      title="Linear"
      description={connected ? `Connected to ${status?.workspaceName ?? status?.organizationName ?? "Linear"}.` : "Connect a Linear workspace to use MaTE X from issues and agent sessions."}
      status={error ?? status?.message}
      control={
        <Button
          variant={connected ? "outline" : "default"}
          className="rounded-full shadow-none"
          disabled={busy || !status || status.state === "connecting"}
          onClick={() => void run(connected ? window.mate.settings.disconnectLinear : window.mate.settings.connectLinear)}
        >
          {busy || status?.state === "connecting" ? "Connecting…" : connected ? "Disconnect" : retryable ? "Retry" : "Connect Linear"}
        </Button>
      }
    >
      {connected && status ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="break-words">Workspace: {status.workspaceName ?? status.organizationName ?? "Linear"}</div>
          <div className="break-words">Installation: {status.installationState ?? status.state}</div>
        </div>
      ) : null}
    </SettingsRow>
  );
}
