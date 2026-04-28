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

const copyPackageToBuild = (packageName: string, buildPath: string) => {
  const source = join(process.cwd(), 'node_modules', packageName);
  if (!existsSync(source)) return;

  const target = join(buildPath, 'node_modules', packageName);
  mkdirSync(join(target, '..'), { recursive: true });
  cpSync(source, target, { recursive: true });
};

const config: ForgeConfig = {
  packagerConfig: {
    icon: process.platform === 'darwin' ? macIcons : './assets/icon',
    asar: {
      unpack: '**/*.node',
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
      for (const packageName of libsqlRuntimePackages) {
        copyPackageToBuild(packageName, buildPath);
      }
    },
  },
  rebuildConfig: {},
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
