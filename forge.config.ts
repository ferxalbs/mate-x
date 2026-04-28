import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

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

const config: ForgeConfig = {
  packagerConfig: {
    icon: process.platform === 'darwin' ? macIcons : './assets/icon',
    asar: true,
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
