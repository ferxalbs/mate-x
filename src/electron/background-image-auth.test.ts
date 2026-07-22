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
    assert.equal(parseLocalImageRequest(toLocalImageUrl(sourcePath)), 'School of Athens #1.png');
    assert.equal(
      toLocalImageUrl(sourcePath),
      'mate-local://background/School%20of%20Athens%20%231.png',
    );
    assert.equal(parseLocalImageRequest('mate-local:///Users/fer/Pictures/image.png'), null);
  });

  test('copies the selected image into app-owned storage', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mate-x-background-'));
    const sourcePath = path.join(root, 'source image.png');
    const userDataPath = path.join(root, 'Application Support');
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10]);

    try {
      await writeFile(sourcePath, bytes);
      const durablePath = await persistBackgroundImagePath(sourcePath, userDataPath);

      assert.equal(path.dirname(durablePath), path.join(userDataPath, 'background-images'));
      assert.match(path.basename(durablePath), /^background-[0-9a-f-]+\.png$/);
      assert.deepEqual(await readFile(durablePath), bytes);
      assert.equal(await persistBackgroundImagePath(durablePath, userDataPath), durablePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
