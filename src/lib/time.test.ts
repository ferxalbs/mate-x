import { expect, test, describe } from "bun:test";
import { formatTimestamp } from "./time";

describe("formatTimestamp", () => {
  test("formats a valid ISO string", () => {
    const result = formatTimestamp("2023-10-27T10:30:00Z");
    // Matches "h:mm AM/PM" format
    expect(result).toMatch(/^\d{1,2}:\d{2}\s(AM|PM)$/);
  });

  test("formats a standard date string", () => {
    const result = formatTimestamp("2023-10-27 15:45");
    expect(result).toMatch(/^\d{1,2}:\d{2}\s(AM|PM)$/);
  });

  test("throws on invalid date string", () => {
    expect(() => formatTimestamp("invalid-date")).toThrow();
  });
});
