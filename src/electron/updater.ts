import { app, autoUpdater, dialog, shell } from 'electron';
import { updateElectronApp } from 'update-electron-app';

import {
  selectLatestRelease,
} from './updater-release';

// Native silent updates stay disabled until release artifacts are signed and
// notarized with production Apple credentials and the update feed is qualified.
const HAS_CRYPTOGRAPHIC_KEYS = false;
const RELEASES_API_URL = 'https://api.github.com/repos/ferxalbs/mate-x/releases?per_page=20';

export function initializeUpdater() {
  if (HAS_CRYPTOGRAPHIC_KEYS) {
    updateElectronApp();
  } else {
    void checkForUpdates(false);
  }
}

export async function checkForUpdates(showUpToDateDialog = true) {
  if (HAS_CRYPTOGRAPHIC_KEYS) {
    autoUpdater.checkForUpdates();
    return;
  }

  try {
    const currentVersion = app.getVersion();
    const response = await fetch(RELEASES_API_URL, {
      headers: { 'User-Agent': 'MaTE-X-Updater' },
    });

    if (!response.ok) {
      throw new Error('GitHub Releases request failed');
    }

    const release = selectLatestRelease(await response.json(), currentVersion);
    if (release) {
      const previewLabel = release.prerelease ? ' Public Preview' : '';
      const { response: userChoice } = await dialog.showMessageBox({
        type: 'info',
        title: 'MaTE X update available',
        message: `MaTE X ${release.version}${previewLabel} is available.\n\nInstalled: ${currentVersion}\nAvailable: ${release.version}`,
        detail: 'MaTE X will open the official GitHub Releases page. This unsigned preview never downloads or installs updates silently.',
        buttons: ['Open download page', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });

      if (userChoice === 0) {
        await shell.openExternal(release.htmlUrl);
      }
    } else if (showUpToDateDialog) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'MaTE X',
        message: 'You have the latest available MaTE X release.',
        buttons: ['OK'],
      });
    }
  } catch (error) {
    if (showUpToDateDialog) {
      console.error('Failed to check for updates:', error);
      dialog.showErrorBox(
        'Update check failed',
        'MaTE X could not check GitHub Releases. Check your connection and try again.',
      );
    }
  }
}
