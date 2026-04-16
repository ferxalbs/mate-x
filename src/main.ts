import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

import { registerIpcHandlers } from './electron/ipc-handlers';

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

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 840,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    title: 'MaTE X',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
};

app.on('ready', () => {
  registerIpcHandlers();
  createWindow();
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
