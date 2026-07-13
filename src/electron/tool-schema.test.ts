import assert from "node:assert/strict";
import { describe, test } from "bun:test";
import { toStrictObjectSchema, validateToolArguments } from "./tool-schema";
import type { Tool } from "./tool-types";

function makeTool(partial: Partial<Tool> & Pick<Tool, "parameters">): Tool {
  return {
    name: partial.name ?? "test_tool",
    description: partial.description ?? "test",
    parameters: partial.parameters,
    execute: async () => "ok",
  };
}

describe("validateToolArguments", () => {
  const tool = makeTool({
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 10 },
        count: { type: "number", minimum: 1, maximum: 5 },
        flag: { type: "boolean" },
        mode: { type: "string", enum: ["a", "b"] },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 2,
          items: { type: "string" },
        },
      },
      required: ["query"],
    },
  });

  test("accepts valid args", () => {
    assert.equal(
      validateToolArguments(tool, {
        query: "ok",
        count: 2,
        flag: true,
        mode: "a",
        items: ["x"],
      }),
      null,
    );
  });

  test("rejects non-object args", () => {
    assert.match(String(validateToolArguments(tool, null)), /JSON object/);
    assert.match(String(validateToolArguments(tool, [])), /JSON object/);
    assert.match(String(validateToolArguments(tool, "x")), /JSON object/);
  });

  test("rejects missing required", () => {
    assert.match(
      String(validateToolArguments(tool, {})),
      /Missing required argument "query"/,
    );
  });

  test("rejects unexpected keys", () => {
    assert.match(
      String(validateToolArguments(tool, { query: "ok", extra: 1 })),
      /Unexpected argument "extra"/,
    );
  });

  test("enforces string length", () => {
    assert.match(String(validateToolArguments(tool, { query: "" })), /at least 1/);
    assert.match(
      String(validateToolArguments(tool, { query: "01234567890" })),
      /at most 10/,
    );
  });

  test("enforces number bounds", () => {
    assert.match(
      String(validateToolArguments(tool, { query: "ok", count: 0 })),
      />= 1/,
    );
    assert.match(
      String(validateToolArguments(tool, { query: "ok", count: 6 })),
      /<= 5/,
    );
    assert.match(
      String(validateToolArguments(tool, { query: "ok", count: Number.NaN })),
      /finite number/,
    );
  });

  test("enforces enum and array bounds", () => {
    assert.match(
      String(validateToolArguments(tool, { query: "ok", mode: "z" })),
      /must be one of/,
    );
    assert.match(
      String(validateToolArguments(tool, { query: "ok", items: [] })),
      /at least 1/,
    );
    assert.match(
      String(validateToolArguments(tool, { query: "ok", items: ["a", "b", "c"] })),
      /at most 2/,
    );
  });
});

describe("toStrictObjectSchema", () => {
  test("sets additionalProperties false and caches", () => {
    const schema = {
      type: "object" as const,
      properties: {
        nested: {
          type: "object",
          properties: { a: { type: "string" } },
        },
      },
      required: ["nested"],
    };

    const first = toStrictObjectSchema(schema);
    const second = toStrictObjectSchema(schema);
    assert.equal(first, second);
    assert.equal(first.additionalProperties, false);
    assert.equal((first.properties.nested as any).additionalProperties, false);
    assert.deepEqual(first.required, ["nested"]);
  });
});
