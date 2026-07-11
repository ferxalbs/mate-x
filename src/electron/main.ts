import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { initializeUpdater } from './updater';

import { registerIpcHandlers } from './ipc-handlers';
import { initStack, teardownStack } from './main-stack';
import { setSDKOrchestratorInitializationError } from './repo-service';

// Some upstream Node/Electron dependencies still emit DEP0040 from `punycode`.
// Ignore that single deprecation noise so actual app warnings stay visible.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const warningCode =
    typeof warning === 'object' && warning !== null && 'code' in warning
      ? String((warning as { code?: unknown }).code)
      : typeof args[1] === 'string'
        ? args[1]
        : typeof args[0] === 'string'
          ? args[0]
          : null;

  if (warningCode === 'DEP0040') {
    return;
  }

  return (originalEmitWarning as (...emitArgs: unknown[]) => void)(warning, ...args);
}) as typeof process.emitWarning;

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in main process:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in main process:', reason);
});

// Chromium/EGL device probing is noisy on some Linux desktops.
// Linux is not a supported target yet. Keep startup behavior explicit.
if (!['darwin', 'win32'].includes(process.platform)) {
  app.whenReady().then(() => {
    console.error(`Unsupported platform: ${process.platform}. MaTE X currently supports macOS and Windows only.`);
    app.quit();
  });
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Enable canvas-draw-element (chrome://flags/#canvas-draw-element) and related
// Blink features required by @liquid-dom/react to capture DOM content into its
// WebGL canvas for glass refraction. Must be set before the app is ready.
app.commandLine.appendSwitch('enable-features', 'CanvasDrawElement');
app.commandLine.appendSwitch('enable-blink-features', 'CanvasDrawElement');

// Packaged self-test: isolate userData BEFORE ready (required by Electron)
if (process.env.MATE_X_PACKAGED_SELF_TEST === '1' && process.env.MATE_X_RELEASE_BUILD !== '1') {
  const userDataDir =
    process.env.MATE_X_TEST_USER_DATA ??
    path.join(app.getPath('temp'), `mate-x-selftest-${Date.now()}`);
  app.setPath('userData', userDataDir);
  process.env.MATE_X_TEST_USER_DATA = userDataDir;
}


const isTrustedAppUrl = (url: string) => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return parsedUrl.origin === new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin;
  }

  return parsedUrl.protocol === 'file:';
};

const hardenWindow = (window: BrowserWindow) => {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('mailto:')) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedAppUrl(url)) {
      event.preventDefault();
      if (url.startsWith('https://')) {
        void shell.openExternal(url);
      }
    }
  });

  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
};

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1275,
    height: 825,
    minWidth: 840,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    title: 'MaTE X',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'under-window',
    backgroundMaterial: 'mica',
    backgroundColor: '#00000000',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  hardenWindow(mainWindow);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    setTimeout(() => {
      initializeUpdater();
    }, 2500);
  });
};

app.on('ready', async () => {
  // Packaged self-test driver (test builds only — impossible in release)
  if (process.env.MATE_X_PACKAGED_SELF_TEST === '1') {
    try {
      const { isPackagedSelfTestEnabled, runPackagedSelfTest } = await import(
        './engineering/packaged-self-test'
      );
      if (process.env.MATE_X_RELEASE_BUILD === '0') {
        process.env.MATE_X_ALLOW_PACKAGED_SELF_TEST = '1';
      }
      if (!isPackagedSelfTestEnabled(process.env)) {
        console.error('Packaged self-test refused (release build or not enabled)');
        app.exit(3);
        return;
      }
      const userDataDir =
        process.env.MATE_X_TEST_USER_DATA ?? app.getPath('userData');
      const fixtureRepoDir =
        process.env.MATE_X_TEST_FIXTURE_REPO ??
        path.join(userDataDir, 'fixture-repo');
      const resultPath =
        process.env.MATE_X_TEST_RESULT_PATH ??
        path.join(userDataDir, 'self-test-result.json');
      // Self-test owns durable DB + GitGate — skip full product stack hang risk
      const result = await runPackagedSelfTest({
        userDataDir,
        fixtureRepoDir,
        resultPath,
      });
      console.log('PACKAGED_SELF_TEST_RESULT', JSON.stringify(result));
      app.exit(result.exitCode);
      return;
    } catch (error) {
      console.error('Packaged self-test crashed', error);
      app.exit(1);
      return;
    }
  }

  try {
    await initStack();
  } catch (error) {
    setSDKOrchestratorInitializationError(error);
    console.error('MaTE X stack initialization failed; starting app with core settings IPC only:', error);
  }
  registerIpcHandlers();
  createWindow();
});

app.on('before-quit', async () => {
  await teardownStack();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
