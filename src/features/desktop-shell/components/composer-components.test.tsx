import assert from "node:assert/strict";
import { afterEach, describe, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import type { WorkspaceSummary } from "../../../contracts/workspace";

if (!globalThis.document) GlobalRegistrator.register();
if (!window.matchMedia) {
  window.matchMedia = () =>
    ({
      addEventListener: () => undefined,
      matches: false,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
}

const { cleanup, render, waitFor } = await import(
  "@testing-library/react"
);
const { ComposerCoreInput, handleComposerSubmitShortcut } = await import("./composer-core-input");
const { restoreRunSettingsFocus } = await import("./composer-run-settings");

afterEach(cleanup);

const workspace: WorkspaceSummary = {
  id: "workspace-1",
  name: "a-very-long-repository-name-that-must-truncate",
  path: "/tmp/example",
  branch: "feature/a-very-long-branch-name-that-must-truncate",
  status: "ready",
  stack: ["typescript"],
  facts: [],
};

describe("composer essentials", () => {
  it("labels the objective with repository context and submits by keyboard", () => {
    let submitted = 0;
    let value = "";
    const view = render(
      <ComposerCoreInput
        attachments={null}
        onChange={(next) => {
          value = next;
        }}
        onSubmit={() => {
          submitted += 1;
        }}
        value={value}
        workspace={workspace}
      />,
    );

    const objective = view.getByLabelText("Objective");
    assert.match(
      objective.getAttribute("placeholder") ?? "",
      /What do you want to verify in a-very-long-repository/,
    );
    let prevented = false;
    handleComposerSubmitShortcut(
      {
        ctrlKey: false,
        key: "Enter",
        metaKey: true,
        preventDefault: () => {
          prevented = true;
        },
      },
      () => {
        submitted += 1;
      },
    );
    assert.equal(submitted, 1);
    assert.equal(prevented, true);
  });

  it("restores focus to the Run settings trigger when dismissed", async () => {
    const trigger = document.createElement("button");
    const elsewhere = document.createElement("button");
    document.body.append(trigger, elsewhere);
    elsewhere.focus();

    restoreRunSettingsFocus(trigger);

    await waitFor(() => assert.equal(document.activeElement, trigger));
    trigger.remove();
    elsewhere.remove();
  });
});
