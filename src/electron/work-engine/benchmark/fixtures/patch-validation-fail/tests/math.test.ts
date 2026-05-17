import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import { multiply } from "../src/math";

describe("multiply", () => {
  test("multiplies numbers", () => {
    assert.equal(multiply(2, 3), 6);
  });
});
