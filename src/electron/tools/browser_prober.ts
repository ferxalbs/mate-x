import { BrowserWindow } from 'electron';
import type { Tool } from '../tool-service';

export const browserProberTool: Tool = {
  name: 'browser_prober',
  description: 'Headless browser tool using native Electron to load a URL and execute DOM scripts. Essential for testing DOM XSS or frontend flows natively.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to navigate to.',
      },
      script: {
        type: 'string',
        description: 'JavaScript code to execute in the page context after it loads. Must return a string or promise.',
      },
    },
    required: ['url', 'script'],
  },
  async execute(args) {
    const { url, script } = args;
    let win: BrowserWindow | null = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: true,
      },
    });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (win) {
            win.destroy();
            win = null;
        }
        resolve('Browser probe timed out after 10000ms.');
      }, 10000);

      win!.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
        clearTimeout(timeout);
        if (win) { win.destroy(); win = null; }
        resolve(`Failed to load URL: ${errorDescription} (${errorCode})`);
      });

      win!.loadURL(url).then(async () => {
        if (!win) return;
        try {
          const result = await win.webContents.executeJavaScript(`
            (async () => {
              try {
                ${script}
              } catch (err) {
                return "Script error: " + err.message;
              }
            })();
          `);
          clearTimeout(timeout);
          if (win) { win.destroy(); win = null; }
          resolve(`Browser Script Result:\n${typeof result === 'object' ? JSON.stringify(result, null, 2) : result}`);
        } catch (err: any) {
          clearTimeout(timeout);
          if (win) { win.destroy(); win = null; }
          resolve(`Error executing script: ${err.message}`);
        }
      }).catch((err) => {
          clearTimeout(timeout);
          if (win) { win.destroy(); win = null; }
          resolve(`Failed to navigate: ${err.message}`);
      });
    });
  },
};
