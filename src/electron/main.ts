import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
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

const processBootMs = Number(process.env.MATE_X_PROCESS_BOOT_MS ?? Date.now());
const isTestLifecycle =
  process.env.MATE_X_PACKAGED_SELF_TEST === '1' ||
  process.env.MATE_X_PERF_PROBE === '1' ||
  process.env.MATE_X_GUI_LIFECYCLE === '1';

// Packaged self-test / perf probe: isolate userData BEFORE ready (required by Electron)
if (isTestLifecycle && process.env.MATE_X_RELEASE_BUILD !== '1') {
  const userDataDir =
    process.env.MATE_X_TEST_USER_DATA ??
    path.join(app.getPath('temp'), `mate-x-selftest-${Date.now()}`);
  app.setPath('userData', userDataDir);
  process.env.MATE_X_TEST_USER_DATA = userDataDir;

  // Boot stamp proves main process saw env (stdout may be disconnected on .app)
  try {
    const stampPath =
      process.env.MATE_X_TEST_BOOT_STAMP ??
      path.join(userDataDir, 'boot-stamp.json');
    mkdirSync(path.dirname(stampPath), { recursive: true });
    writeFileSync(
      stampPath,
      JSON.stringify({
        pid: process.pid,
        ppid: process.ppid,
        platform: process.platform,
        arch: process.arch,
        bootMs: processBootMs,
        phase: process.env.MATE_X_TEST_PHASE ?? null,
        packagedSelfTest: process.env.MATE_X_PACKAGED_SELF_TEST ?? null,
        releaseBuild: process.env.MATE_X_RELEASE_BUILD ?? null,
        resultPath: process.env.MATE_X_TEST_RESULT_PATH ?? null,
        timestamp: new Date().toISOString(),
      }),
      'utf8',
    );
  } catch (error) {
    console.error('Failed to write boot stamp', error);
  }
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

type GuiProbeResult = {
  browserWindowOpened: boolean;
  preloadInitialized: boolean;
  rendererInteractive: boolean;
  timingsMs: {
    processStartToReadyToShow?: number;
    processStartToRendererInteractive?: number;
  };
};

/**
 * Open a real BrowserWindow, wait for ready-to-show + renderer interactive + preload.
 * Used by packaged GUI lifecycle and performance probes — not an ASAR import substitute.
 */
async function openGuiAndProbe(options?: {
  show?: boolean;
  timeoutMs?: number;
}): Promise<GuiProbeResult> {
  const timeoutMs = options?.timeoutMs ?? 45_000;
  const show = options?.show ?? false;

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

  const result: GuiProbeResult = {
    browserWindowOpened: false,
    preloadInitialized: false,
    rendererInteractive: false,
    timingsMs: {},
  };

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`ready-to-show timeout after ${timeoutMs}ms`)),
      timeoutMs,
    );
    mainWindow.once('ready-to-show', () => {
      clearTimeout(timer);
      result.timingsMs.processStartToReadyToShow = Date.now() - processBootMs;
      result.browserWindowOpened = true;
      if (show) {
        mainWindow.show();
      }
      resolve();
    });
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  await readyPromise;

  // Renderer interactive: DOM ready + document.readyState complete
  await mainWindow.webContents.executeJavaScript(
    `new Promise((resolve) => {
      const done = () => resolve(document.readyState);
      if (document.readyState === 'complete') done();
      else window.addEventListener('load', done, { once: true });
    })`,
  );
  result.timingsMs.processStartToRendererInteractive = Date.now() - processBootMs;
  result.rendererInteractive = true;

  // Preload exposes window.mate (primary) and/or window.mateX
  const preloadProbe = await mainWindow.webContents.executeJavaScript(`
    (() => {
      const w = window;
      return {
        hasMate: typeof w.mate === 'object' && w.mate !== null,
        hasMateX: typeof w.mateX === 'object' && w.mateX !== null,
        hasEngineering: !!(w.mate && w.mate.engineering),
      };
    })()
  `);
  result.preloadInitialized = Boolean(
    preloadProbe &&
      (preloadProbe.hasMate || preloadProbe.hasMateX || preloadProbe.hasEngineering),
  );

  // Close probe window — lifecycle driver owns quit
  if (!mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }

  return result;
}

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

async function runPackagedLifecycleFromMain(): Promise<void> {
  const {
    isPackagedSelfTestEnabled,
    runPackagedSelfTestPhase,
    assertSelfTestDisabledInRelease,
  } = await import('./engineering/packaged-self-test');

  if (process.env.MATE_X_RELEASE_BUILD === '0') {
    process.env.MATE_X_ALLOW_PACKAGED_SELF_TEST = '1';
  }

  // Release builds hard-block test drivers / perf probes
  if (process.env.MATE_X_RELEASE_BUILD === '1') {
    console.error('Packaged test drivers refused in release build');
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
  const phaseRaw = (process.env.MATE_X_TEST_PHASE ?? 'full').toLowerCase();
  const phase =
    phaseRaw === 'create' || phaseRaw === 'recover' || phaseRaw === 'full'
      ? phaseRaw
      : 'full';
  const wantGui =
    process.env.MATE_X_GUI_LIFECYCLE === '1' ||
    process.env.MATE_X_PERF_PROBE === '1';
  const wantSelfTest = process.env.MATE_X_PACKAGED_SELF_TEST === '1';
  const wantPerfOnly =
    process.env.MATE_X_PERF_PROBE === '1' && !wantSelfTest;

  if (wantSelfTest && !isPackagedSelfTestEnabled(process.env)) {
    console.error('Packaged self-test refused (release build or not enabled)');
    console.log(
      'PACKAGED_SELF_TEST_RESULT',
      JSON.stringify({
        ok: false,
        phase: 'refused',
        exitCode: 3,
        releaseSelfTestDisabled: assertSelfTestDisabledInRelease(),
      }),
    );
    app.exit(3);
    return;
  }

  let guiHints:
    | {
        browserWindowOpened?: boolean;
        preloadInitialized?: boolean;
        rendererInteractive?: boolean;
        timingsMs?: {
          processStartToReadyToShow?: number;
          processStartToRendererInteractive?: number;
        };
      }
    | undefined;

  if (wantGui) {
    try {
      const gui = await openGuiAndProbe({
        show: process.env.MATE_X_GUI_SHOW === '1',
        timeoutMs: 60_000,
      });
      guiHints = {
        browserWindowOpened: gui.browserWindowOpened,
        preloadInitialized: gui.preloadInitialized,
        rendererInteractive: gui.rendererInteractive,
        timingsMs: gui.timingsMs,
      };

      // Append real probe sample for performance aggregation
      if (process.env.MATE_X_PERF_PROBE === '1' && process.env.MATE_X_PERF_SAMPLES_PATH) {
        const sample = {
          coldProcessStartMs: gui.timingsMs.processStartToReadyToShow ?? null,
          readyToShowMs: gui.timingsMs.processStartToReadyToShow ?? null,
          rendererInteractiveMs: gui.timingsMs.processStartToRendererInteractive ?? null,
          timestamp: new Date().toISOString(),
          pid: process.pid,
          platform: process.platform,
          arch: process.arch,
        };
        const samplesPath = process.env.MATE_X_PERF_SAMPLES_PATH;
        mkdirSync(path.dirname(samplesPath), { recursive: true });
        appendFileSync(samplesPath, `${JSON.stringify(sample)}\n`, 'utf8');
      }
    } catch (error) {
      console.error('GUI probe failed', error);
      const fail = {
        ok: false,
        phase: 'gui-probe',
        exitCode: 4,
        error: error instanceof Error ? error.message : String(error),
        electronProcessStarted: true,
        mainProcessInitialized: true,
      };
      writeFileSync(resultPath, JSON.stringify(fail, null, 2), 'utf8');
      console.log('PACKAGED_SELF_TEST_RESULT', JSON.stringify(fail));
      app.exit(4);
      return;
    }
  }

  // Perf-only probe: BrowserWindow timings without EngineeringTask body
  if (wantPerfOnly) {
    const ok = Boolean(
      guiHints?.browserWindowOpened &&
        guiHints?.rendererInteractive &&
        guiHints?.preloadInitialized,
    );
    const perfResult = {
      ok,
      phase: 'perf-probe',
      exitCode: ok ? 0 : 2,
      browserWindowOpened: guiHints?.browserWindowOpened ?? false,
      preloadInitialized: guiHints?.preloadInitialized ?? false,
      rendererInteractive: guiHints?.rendererInteractive ?? false,
      timingsMs: guiHints?.timingsMs,
      pid: process.pid,
    };
    writeFileSync(resultPath, JSON.stringify(perfResult, null, 2), 'utf8');
    console.log('PACKAGED_PERF_PROBE_RESULT', JSON.stringify(perfResult));
    app.exit(ok ? 0 : 2);
    return;
  }

  if (!wantSelfTest) {
    // GUI-only lifecycle without self-test body
    const ok = Boolean(
      guiHints?.browserWindowOpened &&
        guiHints?.rendererInteractive &&
        guiHints?.preloadInitialized,
    );
    const guiResult = {
      ok,
      phase: 'gui-only',
      exitCode: ok ? 0 : 2,
      ...guiHints,
      pid: process.pid,
    };
    writeFileSync(resultPath, JSON.stringify(guiResult, null, 2), 'utf8');
    app.exit(ok ? 0 : 2);
    return;
  }

  const result = await runPackagedSelfTestPhase(phase, {
    userDataDir,
    fixtureRepoDir,
    resultPath,
    expectedTaskId: process.env.MATE_X_TEST_EXPECTED_TASK_ID,
    guiHints,
  });

  // GUI lifecycle requires real window proof when requested
  if (wantGui) {
    if (
      !result.browserWindowOpened ||
      !result.rendererInteractive ||
      !result.preloadInitialized
    ) {
      result.ok = false;
      result.error =
        result.error ??
        'GUI lifecycle incomplete (BrowserWindow / renderer / preload)';
      result.exitCode = 2;
      writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
    }
  }

  console.log('PACKAGED_SELF_TEST_RESULT', JSON.stringify(result));
  app.exit(result.exitCode);
}

app.on('ready', async () => {
  // Packaged self-test / GUI lifecycle / perf probe (test builds only)
  if (
    process.env.MATE_X_PACKAGED_SELF_TEST === '1' ||
    process.env.MATE_X_PERF_PROBE === '1' ||
    process.env.MATE_X_GUI_LIFECYCLE === '1'
  ) {
    try {
      await runPackagedLifecycleFromMain();
    } catch (error) {
      console.error('Packaged self-test crashed', error);
      app.exit(1);
    }
    return;
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

