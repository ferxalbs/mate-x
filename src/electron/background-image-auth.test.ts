import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'bun:test';

import {
  parseLocalImageRequest,
  persistBackgroundImagePath,
  toLocalImageUrl,
} from './background-image-auth';

describe('background image persistence', () => {
  test('preserves macOS filenames when building and parsing a local URL', () => {
    const sourcePath = '/Users/fer/Pictures/School of Athens #1.png';
    assert.equal(parseLocalImageRequest(toLocalImageUrl(sourcePath)), sourcePath);
  });

  test('copies the selected image into app-owned storage', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mate-x-background-'));
    const sourcePath = path.join(root, 'source image.png');
    const userDataPath = path.join(root, 'Application Support');
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10]);

    try {
      await writeFile(sourcePath, bytes);
      const durablePath = await persistBackgroundImagePath(sourcePath, userDataPath);

      assert.equal(durablePath, path.join(userDataPath, 'background-images', 'background.png'));
      assert.deepEqual(await readFile(durablePath), bytes);
      assert.equal(await persistBackgroundImagePath(durablePath, userDataPath), durablePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
