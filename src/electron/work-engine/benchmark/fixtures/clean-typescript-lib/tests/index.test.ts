import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import { add } from "../src/index";

describe("add", () => {
  test("adds numbers", () => {
    assert.equal(add(2, 3), 5);
  });
});
