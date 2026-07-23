import { app, BrowserWindow, nativeTheme, shell, protocol, net } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../contracts/settings';
import { initializeUpdater } from './updater';
import {
  parseLocalImageRequest,
  persistBackgroundImagePath,
  setAuthorizedBackgroundImagePath,
  getAuthorizedBackgroundImagePath,
} from './background-image-auth';

import { registerIpcHandlers } from './ipc-handlers';
import { initStack, teardownStack } from './main-stack';
import { setSDKOrchestratorInitializationError } from './sdk-orchestrator-state';
import { startupPerfBegin, startupPerfMark } from './startup-perf';
import { tursoService } from './turso-service';
import { resolveWindowAppearance } from './window-appearance';
import { linearOAuthCancellationMessage } from './linear/linear-oauth';

// Electron Forge can start the app more than once when a dev process is
// restarted quickly. Keep one runtime and bring the existing window forward.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mate-local',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

app.setAsDefaultProtocolClient('matex');
app.on('open-url', (event, rawUrl) => {
  event.preventDefault();
  void completeLinearOAuthCallback(rawUrl);
});

async function completeLinearOAuthCallback(rawUrl: string): Promise<void> {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== 'linear' || url.pathname !== '/callback') return;
    const { getLinearConnectionService } = await import('./linear');
    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      getLinearConnectionService().cancel(linearOAuthCancellationMessage(oauthError));
      return;
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) throw new Error('Linear OAuth callback is missing code or state');
    await getLinearConnectionService().complete(code, state);
  } catch (error) {
    console.error('Linear OAuth callback failed:', error);
    try {
      const { getLinearConnectionService } = await import('./linear');
      getLinearConnectionService().failCallback(
        error instanceof Error && error.message.includes('verified')
          ? error.message
          : 'Linear authorization could not be completed. Try again.',
      );
    } catch { /* Optional integration may be unavailable; app startup remains unaffected. */ }
  }
}

app.on('second-instance', () => {
  const [mainWindow] = BrowserWindow.getAllWindows();
  if (!mainWindow) return;

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

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


const createWindow = (settings: AppSettings) => {
  const windowAppearance = resolveWindowAppearance(
    settings,
    process.platform,
    nativeTheme.shouldUseDarkColors,
  );
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
    // Native vibrancy/mica permanently disabled — window frame is opaque for CSS glass rendering.
    transparent: false,
    backgroundColor: windowAppearance.backgroundColor,
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
  startupPerfBegin('app-ready');

  protocol.handle('mate-local', async (request) => {
    const requestedFileName = parseLocalImageRequest(request.url);
    if (!requestedFileName) return new Response('Not found', { status: 404 });

    // ── Authorization check ──────────────────────────────────────────────────
    // Only serve the single path the user explicitly saved as their background.
    // The authorized path is an in-memory cache populated from the DB at startup
    // and kept current by setAuthorizedBackgroundImagePath(). A cache miss can
    // happen after a renderer/main-process reload in development, so recover it
    // from persisted settings before rejecting the request.
    let authorizedPath = getAuthorizedBackgroundImagePath();
    if (!authorizedPath || path.basename(authorizedPath) !== requestedFileName) {
      try {
        const persistedSettings = await tursoService.getAppSettings();
        const persistedPath = persistedSettings.customBackgroundImage
          ? path.resolve(persistedSettings.customBackgroundImage)
          : null;
        if (persistedPath && path.basename(persistedPath) === requestedFileName) {
          setAuthorizedBackgroundImagePath(persistedPath);
          authorizedPath = persistedPath;
        }
      } catch (error) {
        console.warn('Could not recover persisted background image authorization:', error);
      }
    }
    if (!authorizedPath || path.basename(authorizedPath) !== requestedFileName) {
      console.warn('Rejected mate-local background image request:', {
        requestedExtension: path.extname(requestedFileName),
        authorizationRecovered: false,
      });
      return new Response('Not found', { status: 404 });
    }

    try {
      const file = await stat(authorizedPath);
      if (!file.isFile()) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(authorizedPath).toString());
    } catch (error) {
      console.warn('Could not read authorized mate-local background image:', error);
      return new Response('Not found', { status: 404 });
    }
  });

  // Initialize durable storage first so settings IPC and vibrancy resolve quickly.
  // initStack also calls tursoService.initialize() (idempotent after this).
  try {
    await tursoService.initialize();
    startupPerfMark('turso-ready');
  } catch (error) {
    console.error('Turso initialization failed during startup:', error);
  }

  let appSettings = DEFAULT_APP_SETTINGS;
  try {
    appSettings = await tursoService.getAppSettings();
    if (appSettings.customBackgroundImage) {
      try {
        const durablePath = await persistBackgroundImagePath(
          appSettings.customBackgroundImage,
          app.getPath('userData'),
        );
        if (path.resolve(appSettings.customBackgroundImage) !== durablePath) {
          appSettings = await tursoService.updateAppSettings({
            ...appSettings,
            customBackgroundImage: durablePath,
          });
        }
      } catch (error) {
        // Keep the setting intact so a transient read failure never destroys a
        // user's saved preference. The renderer can show it as unavailable.
        console.warn('Saved background image could not be migrated to app storage:', error);
      }
    }
    // Prime the protocol authorization cache from DB so the renderer can
    // load the saved background image immediately after startup.
    setAuthorizedBackgroundImagePath(appSettings.customBackgroundImage);
    startupPerfMark('settings-loaded');
  } catch (error) {
    console.warn('Failed to load window appearance settings on startup, using defaults:', error);
  }

  // Full stack (engineering repo, storage adapter, orchestrator). Window creation
  // waits for this so SDK readiness is consistent, but turso/settings above are
  // no longer serialized behind optional migration / config work inside initStack.
  try {
    await initStack();
    startupPerfMark('stack-ready');
  } catch (error) {
    setSDKOrchestratorInitializationError(error);
    console.error('MaTE X stack initialization failed; starting app with core settings IPC only:', error);
  }

  registerIpcHandlers();
  startupPerfMark('ipc-registered');

  createWindow(appSettings);
  startupPerfMark('window-created');
});

// Electron does not wait for async before-quit handlers. Prevent default once,
// finish teardown, then quit so durable services are not left half-closed.
let isQuitting = false;
app.on('before-quit', (event) => {
  if (isQuitting) {
    return;
  }
  event.preventDefault();
  isQuitting = true;
  void teardownStack()
    .catch((error) => {
      console.error('MaTE X stack teardown failed during quit:', error);
    })
    .finally(() => {
      app.quit();
    });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    let appSettings = DEFAULT_APP_SETTINGS;
    try {
      appSettings = await tursoService.getAppSettings();
    } catch { /* use default window appearance */ }
    createWindow(appSettings);
  }
});
