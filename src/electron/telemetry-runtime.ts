import { app } from "electron";

import { resolveRainyPrivateRuntimeConfig } from "../config/rainy";
import type { AppSettings } from "../contracts/settings";
import { telemetryService } from "./telemetry-service";
import { tursoService } from "./turso-service";

function osFamily(): "macos" | "windows" | "other" {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "other";
}

export async function applyTelemetryPreference(
  settings: Pick<AppSettings, "telemetryEnabled">,
): Promise<void> {
  if (!settings.telemetryEnabled) {
    await telemetryService.disable();
    return;
  }

  try {
    const [storedApiKey, clientId] = await Promise.all([
      tursoService.getApiKey(),
      tursoService.getTelemetryClientId(),
    ]);
    const runtime = resolveRainyPrivateRuntimeConfig({ storedApiKey });
    await telemetryService.initialize({
      enabled: true,
      endpoint: runtime.endpoint,
      apiKey: runtime.apiKey,
      clientId,
      appVersion: app.getVersion(),
      osFamily: osFamily(),
    });
  } catch {
    // Missing config or collector failure must never block MaTE X.
  }
}
