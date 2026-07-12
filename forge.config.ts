import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const supportsIconComposerIcon = () => {
  if (process.platform !== 'darwin' || !existsSync('./assets/icon.icon')) return false;

  try {
    const version = execSync('sw_vers -productVersion', { encoding: 'utf8' }).trim();
    return Number(version.split('.')[0]) >= 26;
  } catch {
    return false;
  }
};

const macIcons = supportsIconComposerIcon()
  ? ['./assets/icon.icns', './assets/icon.icon']
  : './assets/matex';

const libsqlRuntimePackages = [
  '@libsql/client',
  '@libsql/core',
  '@libsql/darwin-arm64',
  '@libsql/darwin-x64',
  '@libsql/hrana-client',
  '@libsql/isomorphic-ws',
  '@libsql/win32-x64-msvc',
  '@neon-rs/load',
  'detect-libc',
  'js-base64',
  'libsql',
  'promise-limit',
  'ws',
];

// Vite marks @vscode/ripgrep as external (native binary resolver). Forge's
// .vite-only ignore would otherwise omit it from the package → crash on launch.
// Only ship the host platform binary where practical (smaller release surface).
const ripgrepCorePackage = '@vscode/ripgrep';

const ripgrepPlatformPackageForHost = (): string => {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return '@vscode/ripgrep-darwin-arm64';
  }
  if (process.platform === 'darwin') {
    return '@vscode/ripgrep-darwin-x64';
  }
  if (process.platform === 'win32' && process.arch === 'arm64') {
    return '@vscode/ripgrep-win32-arm64';
  }
  if (process.platform === 'win32') {
    return '@vscode/ripgrep-win32-x64';
  }
  throw new Error(
    `Unsupported packaging host for ripgrep: ${process.platform}/${process.arch}`,
  );
};

/** Documented platform package names — used by package config tests. */
export const RIPGREP_PLATFORM_PACKAGES = [
  '@vscode/ripgrep-darwin-arm64',
  '@vscode/ripgrep-darwin-x64',
  '@vscode/ripgrep-win32-x64',
  '@vscode/ripgrep-win32-arm64',
] as const;

const requiredRuntimePackagesForHost = (): string[] => [
  ...libsqlRuntimePackages,
  ripgrepCorePackage,
  ripgrepPlatformPackageForHost(),
];

const copyPackageToBuild = (packageName: string, buildPath: string) => {
  const source = join(process.cwd(), 'node_modules', packageName);
  if (!existsSync(source)) {
    throw new Error(
      `packageAfterCopy: required package missing: ${packageName} (install failed or wrong platform)`,
    );
  }

  const target = join(buildPath, 'node_modules', packageName);
  mkdirSync(join(target, '..'), { recursive: true });
  cpSync(source, target, { recursive: true });
};

const config: ForgeConfig = {
  packagerConfig: {
    icon: process.platform === 'darwin' ? macIcons : './assets/icon',
    asar: {
      // Native addons + ripgrep platform binaries must live outside the asar.
      unpack: '{**/*.node,**/node_modules/@vscode/ripgrep*/**}',
    },
    // Using a function suppresses the Forge Vite-plugin warning while letting
    // us keep our custom exclusions on top of its default ".vite-only" logic.
    ignore: (file: string) => {
      const normalizedFile = file.replace(/\\/g, '/').replace(/^\/+/, '');
      // Replicate the Forge Vite plugin default: only ship the .vite output dir.
      if (normalizedFile && !normalizedFile.startsWith('.vite')) return true;
      // Additionally strip source test/fixture/qa artefacts that may end up there.
      if (/(^|\/).*\.test\.ts$/.test(normalizedFile)) return true;
      if (/(^|\/)__tests__(\/|$)/.test(normalizedFile)) return true;
      if (/(^|\/)fixtures(\/|$)/.test(normalizedFile)) return true;
      if (/(^|\/)qa(\/|$)/.test(normalizedFile)) return true;
      if (/(^|\/)tests(\/|$)/.test(normalizedFile)) return true;
      if (/(^|\/)artifacts(\/|$)/.test(normalizedFile)) return true;
      return false;
    },
    executableName: 'mate-x',
    ...(process.env.APPLE_ID && {
      osxSign: {},
      osxNotarize: {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_ID_PASSWORD || '',
        teamId: process.env.APPLE_TEAM_ID || '',
      },
    }),
  },
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      const packages = requiredRuntimePackagesForHost();
      for (const packageName of packages) {
        // Optional platform-specific libsql packages may be absent on other hosts.
        const isOptionalCrossPlatformNative =
          packageName.startsWith('@libsql/darwin-') ||
          packageName.startsWith('@libsql/win32-');
        const source = join(process.cwd(), 'node_modules', packageName);
        if (!existsSync(source)) {
          if (isOptionalCrossPlatformNative) {
            continue;
          }
          throw new Error(
            `packageAfterCopy: required package missing: ${packageName}`,
          );
        }
        copyPackageToBuild(packageName, buildPath);
      }

      // Fail closed: host ripgrep binary must exist after copy.
      const rgPkg = ripgrepPlatformPackageForHost();
      const rgBin =
        process.platform === 'win32'
          ? join(buildPath, 'node_modules', rgPkg, 'bin', 'rg.exe')
          : join(buildPath, 'node_modules', rgPkg, 'bin', 'rg');
      if (!existsSync(rgBin)) {
        throw new Error(
          `packageAfterCopy: ripgrep binary missing at ${rgBin} — packaging aborted`,
        );
      }
    },
  },
  rebuildConfig: {},
  // Public release targets are macOS (Intel/Apple Silicon) and Windows 10/11.
  // Linux makers are intentionally omitted until Linux is a supported product target.
  makers: [
    new MakerSquirrel({
      name: 'mate_x',
      setupIcon: './assets/icon.ico',
      ...(process.env.WINDOWS_CERTIFICATE_PATH && {
        certificateFile: process.env.WINDOWS_CERTIFICATE_PATH,
        certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
      }),
    }),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({
      format: 'ULFO',
      icon: './assets/icon.icns',
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: 'ferxalbs',
        name: 'mate-x',
      },
      prerelease: false,
      draft: true,
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
