import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import { label } from "../src/index";

describe("label", () => {
  test("labels values", () => {
    assert.equal(label("a"), "value:a");
  });
});
