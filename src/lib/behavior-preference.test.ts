import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_BEHAVIOR_PREFERENCE } from "../contracts/behavior-mode";
import { loadBehaviorPreference, saveBehaviorPreference } from "./behavior-preference";

describe("workspace behavior persistence", () => {
  it("persists selection independently per workspace", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } } });
    const guided = { ...DEFAULT_BEHAVIOR_PREFERENCE };
    guided.mode = "guided";
    saveBehaviorPreference("one", guided);
    assert.equal(loadBehaviorPreference("one").mode, "guided");
    assert.equal(loadBehaviorPreference("two").mode, "auto");
    Reflect.deleteProperty(globalThis, "window");
  });
});
