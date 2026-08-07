import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "bun:test";

const appState = new Map<string, string>();
let encryptionAvailable = true;
const userDataPath = "/tmp/matex-turso-service-test";

const client = {
  async execute(query: string | { sql: string; args?: unknown[] }) {
    const sql = typeof query === "string" ? query : query.sql;
    const args = typeof query === "string" ? [] : query.args ?? [];
    if (/SELECT sqlite_version/i.test(sql)) return { rows: [{ version: "3.45.0" }] };
    if (/SELECT value FROM app_state/i.test(sql)) {
      const value = appState.get(String(args[0]));
      return { rows: value === undefined ? [] : [{ value }] };
    }
    if (/INSERT INTO app_state/i.test(sql)) {
      appState.set(String(args[0]), String(args[1]));
      return { rows: [] };
    }
    if (/DELETE FROM app_state/i.test(sql)) {
      appState.delete(String(args[0]));
      return { rows: [] };
    }
    return { rows: [] };
  },
  async batch() {
    return [];
  },
};

mock.module("electron", (() => ({
  app: { getPath: () => userDataPath },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
  },
})) as any);
mock.module("@libsql/client", (() => ({
  createClient: () => client,
})) as any);

const { TursoService } = await import("./turso-service");

afterEach(() => {
  appState.clear();
  encryptionAvailable = true;
});

describe("Rainy API key encrypted storage", () => {
  test("stores new keys encrypted and never leaves the legacy row", async () => {
    const service = new TursoService();
    await service.setApiKey("ra-test-key");

    assert.equal(appState.has("rainy_api_key"), false);
    assert.notEqual(appState.get("secure:rainy_api_key"), "ra-test-key");
    assert.equal(await service.getApiKey(), "ra-test-key");
  });

  test("migrates a legacy plaintext key and removes it after encryption", async () => {
    appState.set("rainy_api_key", "legacy-ra-key");
    const service = new TursoService();

    assert.equal(await service.getApiKey(), "legacy-ra-key");
    assert.equal(appState.has("rainy_api_key"), false);
    assert.ok(appState.get("secure:rainy_api_key"));
  });

  test("fails closed when encrypted storage is unavailable", async () => {
    appState.set("rainy_api_key", "legacy-ra-key");
    encryptionAvailable = false;
    const service = new TursoService();

    await assert.rejects(
      () => service.getApiKey(),
      /Encrypted Rainy API key storage is unavailable/,
    );
    assert.equal(appState.get("rainy_api_key"), "legacy-ra-key");
    await assert.rejects(
      () => service.setApiKey("new-ra-key"),
      /Encrypted Rainy API key storage is unavailable/,
    );
  });
});
