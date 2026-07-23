import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { LinearStore } from "../../electron/linear/linear-store";
import type { RainyLinearStatus } from "../../electron/linear/rainy-linear-client";
import { LinearIntegrationSettings } from "./linear-integration-settings";

if (!globalThis.document) {
  GlobalRegistrator.register();
}

mock.module("electron", (() => ({
  safeStorage: {
    decryptString: () => "",
  },
  shell: {
    openExternal: async () => true,
  },
})) as any);

const { LinearConnectionService } = await import("../../electron/linear/linear-connection-service");

afterEach(() => {
  cleanup();
});

describe("Linear integration settings", () => {
  it("transitions from Connecting to Connected after the OAuth callback persists an installation", async () => {
    const store = new LinearStore(":memory:");
    await store.initialize();
    let callbackCompleted = false;
    const rainyStatus = (): RainyLinearStatus => callbackCompleted
      ? {
          state: "connected",
          installationState: "connected",
          workspaceId: "linear-workspace",
          workspaceName: "Fer’s",
          organizationName: "Fer’s",
          scopes: ["read", "write"],
          message: null,
        }
      : {
          state: "disconnected",
          installationState: "not_connected",
          workspaceId: null,
          workspaceName: null,
          organizationName: null,
          scopes: [],
          message: null,
        };
    const rainy = {
      start: async () => {
        callbackCompleted = true;
        return "https://linear.app/oauth/authorize?state=test";
      },
      status: async () => rainyStatus(),
      disconnect: async () => {},
    } as any;
    const service = new LinearConnectionService(store, rainy);

    Object.defineProperty(window, "mate", {
      configurable: true,
      value: {
        settings: {
          getLinearStatus: () => service.status(),
          connectLinear: () => service.begin(),
          disconnectLinear: () => service.revoke(),
        },
      },
    });

    const view = render(<LinearIntegrationSettings />);
    const button = await waitFor(() => view.getByRole("button") as HTMLButtonElement);
    await waitFor(() => assert.equal(button.disabled, false));
    fireEvent.click(button);

    await waitFor(() => assert.match(button.textContent ?? "", /Connecting/));
    await waitFor(() => assert.match(button.textContent ?? "", /Disconnect/), { timeout: 3_000 });
    assert.match(view.getByText(/Installation: connected/).textContent ?? "", /connected/);
  });
});
