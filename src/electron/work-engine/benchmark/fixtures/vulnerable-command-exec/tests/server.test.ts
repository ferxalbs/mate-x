import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import { route } from "../src/server";

describe("route", () => {
  test("returns child process handle", () => {
    const child = route({ host: "localhost" });
    child.kill();
    assert.equal(typeof child.pid, "number");
  });
});
