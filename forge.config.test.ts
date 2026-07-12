import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const forgeConfig = readFileSync("forge.config.ts", "utf8");

describe("Forge release configuration", () => {
  it("targets only supported public platforms", () => {
    assert.match(forgeConfig, /new MakerSquirrel/);
    assert.match(forgeConfig, /new MakerDMG/);
    assert.match(forgeConfig, /new MakerZIP\(\{\}, \['darwin'\]\)/);
    assert.doesNotMatch(forgeConfig, /MakerDeb|maker-deb|MakerRpm|maker-rpm/);
  });

  it("keeps security fuses enabled for packaged builds", () => {
    assert.match(forgeConfig, /RunAsNode\]: false/);
    assert.match(forgeConfig, /EnableCookieEncryption\]: true/);
    assert.match(forgeConfig, /EnableNodeOptionsEnvironmentVariable\]: false/);
    assert.match(forgeConfig, /EnableNodeCliInspectArguments\]: false/);
    assert.match(forgeConfig, /EnableEmbeddedAsarIntegrityValidation\]: true/);
    assert.match(forgeConfig, /OnlyLoadAppFromAsar\]: true/);
  });

  it("packages @vscode/ripgrep runtime and constrains platform assets to host", () => {
    assert.match(forgeConfig, /@vscode\/ripgrep/);
    assert.match(forgeConfig, /@vscode\/ripgrep-darwin-x64/);
    assert.match(forgeConfig, /@vscode\/ripgrep-darwin-arm64/);
    assert.match(forgeConfig, /@vscode\/ripgrep-win32-x64/);
    assert.match(forgeConfig, /ripgrepPlatformPackageForHost/);
    assert.match(forgeConfig, /packageAfterCopy: ripgrep binary missing/);
    // Host platform binaries must unpack outside ASAR (basename-safe on Windows).
    assert.match(forgeConfig, /rg\.exe/);
    assert.match(forgeConfig, /\{\*\.node,rg,rg\.exe\}/);
  });

  it("excludes qa/tests/artifacts from package ignore surface", () => {
    assert.match(forgeConfig, /qa\(\\\/\|\$\)/);
    assert.match(forgeConfig, /tests\(\\\/\|\$\)/);
    assert.match(forgeConfig, /artifacts\(\\\/\|\$\)/);
  });
});
