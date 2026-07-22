import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { SettingsRow } from "../../components/ui/settings-layout";
import type { LinearIntegrationStatus } from "../../contracts/linear-integration";

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Linear could not complete that action.";
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, "").slice(0, 240);
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</div>
      <div className="flex min-w-0 gap-2">
        <Input nativeInput readOnly value={value} aria-label={label} className="min-w-0 flex-1" />
        <Button variant="outline" className="rounded-xl shadow-none" onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
          });
        }}>{copied ? "Copied" : "Copy"}</Button>
      </div>
    </div>
  );
}

export function LinearIntegrationSettings() {
  const [status, setStatus] = useState<LinearIntegrationStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => window.mate.settings.getLinearStatus().then(setStatus).catch((cause) => setError(errorMessage(cause))), []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_500);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const connected = status?.state === "connected" || status?.state === "permission_changed";
  const needsSetup = status?.configurationSource === "missing";
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await action(); await refresh(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  return (
    <SettingsRow
      title="Linear"
      description={connected ? `Connected to ${status?.organizationName ?? "Linear"}.` : needsSetup ? "Create a Linear OAuth app, then paste its public Client ID." : "Connect a Linear workspace to use MaTE X from issues and agent sessions."}
      status={error ?? status?.message}
      control={!needsSetup ? (
        <Button
          variant={connected ? "outline" : "default"}
          className="rounded-full shadow-none"
          disabled={busy || !status || status.state === "connecting"}
          onClick={() => void run(connected ? window.mate.settings.disconnectLinear : window.mate.settings.connectLinear)}
        >
          {busy || status?.state === "connecting" ? "Connecting…" : connected ? "Disconnect" : "Connect Linear"}
        </Button>
      ) : undefined}
    >
      {needsSetup && status ? (
        <div className="space-y-3 rounded-2xl border border-border/70 bg-transparent p-3 shadow-none">
          <Button variant="outline" className="rounded-xl shadow-none" onClick={() => void run(window.mate.settings.openLinearDeveloperSetup)} disabled={busy}>Create Linear App</Button>
          <CopyValue label="Callback URL" value={status.setup.callbackUrl} />
          <CopyValue label="Webhook URL" value={status.setup.webhookUrl} />
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Client ID</div>
            <Input nativeInput value={clientId} onChange={(event) => setClientId(event.currentTarget.value)} placeholder="Paste the generated Client ID" aria-label="Linear Client ID" />
          </div>
          <Button className="rounded-full shadow-none" disabled={busy || clientId.trim().length === 0} onClick={() => void run(() => window.mate.settings.saveLinearClientIdAndConnect(clientId))}>
            {busy ? "Connecting…" : "Save and Connect"}
          </Button>
        </div>
      ) : null}
    </SettingsRow>
  );
}
