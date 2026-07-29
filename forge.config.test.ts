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

  it("keeps v0.1.3 publication as a draft prerelease and signing credential-gated", () => {
    assert.match(forgeConfig, /prerelease: true/);
    assert.match(forgeConfig, /draft: true/);
    assert.match(forgeConfig, /hasAppleReleaseCredentials/);
    assert.match(forgeConfig, /process\.env\.APPLE_ID_PASSWORD/);
    assert.match(forgeConfig, /process\.env\.APPLE_TEAM_ID/);
  });

  it("keeps security fuses enabled for packaged builds", () => {
    assert.match(forgeConfig, /RunAsNode\]: false/);
    assert.match(forgeConfig, /EnableCookieEncryption\]: true/);
    assert.match(forgeConfig, /EnableNodeOptionsEnvironmentVariable\]: false/);
    assert.match(forgeConfig, /EnableNodeCliInspectArguments\]: false/);
    assert.match(forgeConfig, /EnableEmbeddedAsarIntegrityValidation\]: true/);
    assert.match(forgeConfig, /OnlyLoadAppFromAsar\]: true/);
  });

  it("packages model and ripgrep runtimes with host-native binaries", () => {
    assert.match(forgeConfig, /@huggingface\/transformers/);
    assert.match(forgeConfig, /onnxruntime-node/);
    assert.match(forgeConfig, /onnxruntime_binding\.node/);
    assert.match(forgeConfig, /libonnxruntime\./);
    assert.match(forgeConfig, /\*\*\/\*\.dylib/);
    assert.match(forgeConfig, /@vscode\/ripgrep/);
    assert.match(forgeConfig, /@vscode\/ripgrep-darwin-x64/);
    assert.match(forgeConfig, /@vscode\/ripgrep-darwin-arm64/);
    assert.match(forgeConfig, /@vscode\/ripgrep-win32-x64/);
    assert.match(forgeConfig, /ripgrepPlatformPackageForHost/);
    assert.match(forgeConfig, /packageAfterCopy: ripgrep binary missing/);
    // Host platform binaries must unpack outside ASAR (Windows-backslash-safe).
    assert.match(forgeConfig, /rg\.exe/);
    assert.match(forgeConfig, /\*\*\/\*\.node/);
    assert.match(forgeConfig, /\*\*\/rg\.exe/);
  });

  it("excludes qa/tests/artifacts from package ignore surface", () => {
    assert.match(forgeConfig, /qa\(\\\/\|\$\)/);
    assert.match(forgeConfig, /tests\(\\\/\|\$\)/);
    assert.match(forgeConfig, /artifacts\(\\\/\|\$\)/);
  });
});
