import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';

import {
  compareVersions,
  resolveOfficialReleaseUrl,
  selectLatestRelease,
} from './updater-release';

describe('manual updater release selection', () => {
  it('compares stable and prerelease-tagged semantic versions by numeric core', () => {
    assert.equal(compareVersions('0.1.3', '0.1.2'), 1);
    assert.equal(compareVersions('v0.1.3-preview.1', '0.1.3'), 0);
    assert.equal(compareVersions('invalid', '0.1.3'), 0);
  });

  it('selects the newest non-draft release, including public previews', () => {
    const selected = selectLatestRelease(
      [
        {
          draft: true,
          prerelease: false,
          tag_name: 'v9.0.0',
          html_url: 'https://github.com/ferxalbs/mate-x/releases/tag/v9.0.0',
        },
        {
          draft: false,
          prerelease: true,
          tag_name: 'v0.1.3',
          html_url: 'https://github.com/ferxalbs/mate-x/releases/tag/v0.1.3',
        },
        {
          draft: false,
          prerelease: false,
          tag_name: 'v0.1.2',
          html_url: 'https://github.com/ferxalbs/mate-x/releases/tag/v0.1.2',
        },
      ],
      '0.1.2',
    );

    assert.deepEqual(selected, {
      draft: false,
      htmlUrl: 'https://github.com/ferxalbs/mate-x/releases/tag/v0.1.3',
      prerelease: true,
      tagName: 'v0.1.3',
      version: '0.1.3',
    });
  });

  it('rejects malformed payloads and unofficial download destinations', () => {
    assert.equal(selectLatestRelease({ releases: [] }, '0.1.2'), null);
    assert.equal(
      selectLatestRelease(
        [{
          draft: false,
          prerelease: true,
          tag_name: 'v0.1.3',
          html_url: 'https://example.com/mate-x-v0.1.3.dmg',
        }],
        '0.1.2',
      ),
      null,
    );
    assert.equal(
      resolveOfficialReleaseUrl('https://github.com/other/repo/releases/tag/v0.1.3'),
      'https://github.com/ferxalbs/mate-x/releases',
    );
  });
});
