import assert from "node:assert/strict";
import { afterEach, describe, it } from "bun:test";

import { setModel, subscribeToModelChanges } from "./settings-client";

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("setModel", () => {
  it("notifies renderer subscribers only after the IPC write succeeds", async () => {
    const calls: string[] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        mate: {
          settings: {
            setModel: async (model: string) => {
              calls.push(`ipc:${model}`);
            },
          },
        },
      },
    });

    const observed: string[] = [];
    const unsubscribe = subscribeToModelChanges((model) => observed.push(model));

    await setModel("openai/gpt-5.6-sol");
    unsubscribe();

    assert.deepEqual(calls, ["ipc:openai/gpt-5.6-sol"]);
    assert.deepEqual(observed, ["openai/gpt-5.6-sol"]);
  });

  it("does not notify subscribers when the IPC write fails", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        mate: {
          settings: {
            setModel: async () => {
              throw new Error("selection rejected");
            },
          },
        },
      },
    });

    const observed: string[] = [];
    const unsubscribe = subscribeToModelChanges((model) => observed.push(model));

    await assert.rejects(() => setModel("openai/gpt-5.6-sol"));
    unsubscribe();

    assert.deepEqual(observed, []);
  });
});
