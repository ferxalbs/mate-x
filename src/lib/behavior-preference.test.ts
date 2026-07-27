import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadBehaviorPreference, saveBehaviorPreference } from "./behavior-preference";

describe("workspace behavior persistence", () => {
  it("persists selection independently per workspace", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } } });
    saveBehaviorPreference("one", { mode: "plan" });
    assert.equal(loadBehaviorPreference("one").mode, "plan");
    assert.equal(loadBehaviorPreference("two").mode, "execute");
    Reflect.deleteProperty(globalThis, "window");
  });
});
