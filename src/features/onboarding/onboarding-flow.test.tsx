import assert from "node:assert/strict";
import { afterEach, describe, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  type RenderResult,
} from "@testing-library/react";

import { DEFAULT_APP_SETTINGS } from "../../contracts/settings";
import type { PrivacyModelStatus } from "../../contracts/privacy";
import type {
  WorkspaceSnapshot,
  WorkspaceTrustContract,
} from "../../contracts/workspace";
import type { OnboardingServices } from "./onboarding-flow";

if (!globalThis.document) {
  GlobalRegistrator.register();
}

if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: window.localStorage,
  });
}

if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

const { OnboardingFlowContent } = await import("./onboarding-flow");

afterEach(() => {
  cleanup();
});

describe("OnboardingFlow", () => {
  it("renders a static accessible loading state", () => {
    const services = createServices({
      getAppSettings: () => new Promise(() => undefined),
    });
    const view = render(
      <OnboardingFlowContent onComplete={() => undefined} services={services} />,
    );

    assert.match(view.getByRole("status").textContent ?? "", /Loading setup/);
    assert.equal(view.getByRole("status").querySelector(".animate-spin"), null);
  });

  it("awaits each successful write and completes in order", async () => {
    const events: string[] = [];
    const services = createServices({
      updateAppSettings: async (settings) => {
        events.push(
          settings.onboardingCompleted ? "complete-settings" : "preferences",
        );
        return settings;
      },
      setApiKey: async () => {
        events.push("api-key");
      },
      openWorkspacePicker: async () => {
        events.push("workspace-picker");
        return createWorkspaceSnapshot();
      },
      updateWorkspaceTrustContract: async (contract) => {
        events.push("trust-contract");
        return contract;
      },
    });

    const view = render(
      <OnboardingFlowContent
        onComplete={() => {
          events.push("complete");
        }}
        services={services}
      />,
    );

    await advance(view, "Get started", "Save appearance");
    await advance(view, "Save appearance", "Prepare local privacy checks");
    await advance(view, "Continue", "Connect Rainy API");
    await advance(view, "Continue", "Choose a repository");
    await advance(view, "Select repository", "Set the workspace boundary");
    await advance(view, "Save boundary", "Ready for the first review");
    fireEvent.click(view.getByRole("button", { name: "Open MaTE X" }));

    await waitFor(() => assert.equal(events.at(-1), "complete"));
    assert.deepEqual(events, [
      "preferences",
      "workspace-picker",
      "trust-contract",
      "complete-settings",
      "complete",
    ]);
  });

  it("retains inputs and does not advance when a write fails", async () => {
    const services = createServices({
      updateAppSettings: async () => {
        throw new Error("Settings write failed");
      },
    });
    const view = render(
      <OnboardingFlowContent onComplete={() => undefined} services={services} />,
    );

    await advance(view, "Get started", "Save appearance");
    fireEvent.click(view.getByRole("button", { name: "Save appearance" }));

    await waitFor(() => assert.ok(view.getByRole("alert")));
    assert.match(view.getByRole("alert").textContent ?? "", /Settings write failed/);
    assert.ok(view.getByText("Choose your appearance"));
    assert.ok(await waitFor(() => view.getByLabelText("Interface appearance")));
  });

  it("keeps the repository step open when the picker is cancelled", async () => {
    const services = createServices({
      openWorkspacePicker: async () => null,
    });
    const view = render(
      <OnboardingFlowContent onComplete={() => undefined} services={services} />,
    );

    await reachWorkspaceStep(view);
    fireEvent.click(view.getByRole("button", { name: "Select repository" }));

    await waitFor(() =>
      assert.equal(
        view.getByRole("button", { name: "Select repository" }).hasAttribute(
          "disabled",
        ),
        false,
      ),
    );
    assert.ok(view.getByText("Choose a repository"));
    assert.equal(view.queryByRole("alert"), null);
  });

  it("preserves the selected repository when navigating Back", async () => {
    const view = render(
      <OnboardingFlowContent
        onComplete={() => undefined}
        services={createServices()}
      />,
    );

    await reachWorkspaceStep(view);
    await advance(view, "Select repository", "Set the workspace boundary");
    fireEvent.click(view.getByRole("button", { name: "Back" }));

    await waitFor(() => assert.ok(view.getByText("Choose a repository")));
    assert.ok(await waitFor(() => view.getByText("Example")));
  });

  it("submits with the keyboard and moves focus to the new step heading", async () => {
    const view = render(
      <OnboardingFlowContent
        onComplete={() => undefined}
        services={createServices()}
      />,
    );

    await waitFor(() => assert.ok(view.getByText("Welcome to MaTE X")));
    const form = view.getByRole("button", { name: "Get started" }).closest("form");
    assert.ok(form);
    fireEvent.submit(form);

    await waitFor(() => {
      const heading = view.getByText("Choose your appearance");
      assert.equal(document.activeElement, heading);
    });
  });

  it("waits for completion persistence before leaving onboarding", async () => {
    let resolveCompletion!: (settings: typeof DEFAULT_APP_SETTINGS) => void;
    let completionStarted = false;
    let didComplete = false;
    const services = createServices({
      updateAppSettings: (settings) => {
        if (!settings.onboardingCompleted) return Promise.resolve(settings);
        completionStarted = true;
        return new Promise((resolve) => {
          resolveCompletion = resolve;
        });
      },
    });
    const view = render(
      <OnboardingFlowContent
        onComplete={() => {
          didComplete = true;
        }}
        services={services}
      />,
    );

    await advance(view, "Get started", "Save appearance");
    await advance(view, "Save appearance", "Prepare local privacy checks");
    await advance(view, "Continue", "Connect Rainy API");
    await advance(view, "Continue", "Choose a repository");
    await advance(view, "Select repository", "Set the workspace boundary");
    await advance(view, "Save boundary", "Ready for the first review");
    fireEvent.click(view.getByRole("button", { name: "Open MaTE X" }));

    await waitFor(() => assert.equal(completionStarted, true));
    assert.equal(didComplete, false);
    resolveCompletion({ ...DEFAULT_APP_SETTINGS, onboardingCompleted: true });
    await waitFor(() => assert.equal(didComplete, true));
  });
});

async function reachWorkspaceStep(view: RenderResult) {
  await advance(view, "Get started", "Save appearance");
  await advance(view, "Save appearance", "Prepare local privacy checks");
  await advance(view, "Continue", "Connect Rainy API");
  await advance(view, "Continue", "Choose a repository");
}

async function advance(
  view: RenderResult,
  buttonName: string,
  nextHeading: string,
) {
  await waitFor(() =>
    assert.ok(view.getByRole("button", { name: buttonName })),
  );
  fireEvent.click(view.getByRole("button", { name: buttonName }));
  await waitFor(() => assert.ok(view.getByText(nextHeading)));
}

function createServices(
  overrides: Partial<OnboardingServices> = {},
): OnboardingServices {
  return {
    getAppSettings: async () => ({ ...DEFAULT_APP_SETTINGS }),
    updateAppSettings: async (settings) => settings,
    getApiKeyStatus: async () => ({ configured: false }),
    setApiKey: async () => undefined,
    openWorkspacePicker: async () => createWorkspaceSnapshot(),
    updateWorkspaceTrustContract: async (contract) => contract,
    getPrivacyModelStatus: async () => createPrivacyModelStatus(),
    downloadPrivacyModel: async () => createPrivacyModelStatus(),
    onPrivacyModelDownloadProgress: () => () => undefined,
    ...overrides,
  };
}

function createWorkspaceSnapshot(): WorkspaceSnapshot {
  const trustContract: WorkspaceTrustContract = {
    id: "trust-1",
    workspaceId: "workspace-1",
    name: "Example governed review",
    version: 2,
    autonomy: "approval-required",
    allowedPaths: ["src"],
    forbiddenPaths: [".env"],
    allowedCommands: ["bun test"],
    allowedDomains: [],
    allowedSecrets: [],
    allowedActions: ["read", "search", "patch", "test"],
    blockedActions: ["deploy", "delete"],
    updatedAt: "2026-07-17T00:00:00.000Z",
  };

  return {
    activeWorkspaceId: "workspace-1",
    workspaces: [],
    workspace: {
      id: "workspace-1",
      name: "Example",
      path: "/tmp/example",
      branch: "main",
      status: "ready",
      stack: ["typescript"],
      facts: [],
    },
    trustContract,
    files: [],
    signals: [],
    threads: [],
    activeThreadId: null,
  };
}

function createPrivacyModelStatus(): PrivacyModelStatus {
  return {
    model: "matex-privacy-v0.15",
    loaded: false,
    missing: true,
    assetPath: "",
    userDataPath: "",
    bundledPath: "",
    source: "missing",
    requiredFiles: [],
    externalDataFiles: [],
    presentFiles: [],
    missingFiles: [],
    inferenceReady: false,
  };
}
