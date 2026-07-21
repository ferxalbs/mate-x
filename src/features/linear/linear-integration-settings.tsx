import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { SettingsRow } from "../../components/ui/settings-layout";
import type { LinearIntegrationStatus } from "../../contracts/linear-integration";

export function LinearIntegrationSettings() {
  const [status, setStatus] = useState<LinearIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => window.mate.settings.getLinearStatus().then(setStatus);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, []);
  const connected = status?.state === "connected" || status?.state === "permission_changed";
  return (
    <SettingsRow
      title="Linear agent"
      description={status ? `${status.organizationName ?? "Not connected"} · Relay ${status.relayConnected ? "online" : "offline"}${status.message ? ` · ${status.message}` : ""}` : "Loading Linear status…"}
      control={
        <Button
          variant="outline"
          className="rounded-full shadow-none"
          disabled={busy || !status}
          onClick={async () => {
            setBusy(true);
            try {
              if (connected) await window.mate.settings.disconnectLinear();
              else await window.mate.settings.connectLinear();
              await refresh();
            } finally { setBusy(false); }
          }}
        >
          {busy ? "Working…" : connected ? "Disconnect" : "Connect"}
        </Button>
      }
    />
  );
}
