declare module "vitest" {
  export const describe: (name: string, fn: () => void) => void;
  export const it: (name: string, fn: () => void) => void;
  export const expect: (value: unknown) => {
    toContain: (expected: string) => void;
    not: {
      toContain: (expected: string) => void;
    };
  };
  export const assert: {
    equal: (actual: unknown, expected: unknown) => void;
    deepEqual: (actual: unknown, expected: unknown) => void;
  };
}

declare module "bun:test" {
  export const describe: (name: string, fn: () => void) => void;
  export const test: (name: string, fn: () => void) => void;
  export const expect: (value: unknown) => {
    toMatch: (expected: RegExp) => void;
    toThrow: () => void;
  };
}
