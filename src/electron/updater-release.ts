const OFFICIAL_RELEASES_URL = 'https://github.com/ferxalbs/mate-x/releases';

interface GitHubRelease {
  draft: boolean;
  htmlUrl: string;
  prerelease: boolean;
  tagName: string;
  version: string;
}

function parseVersion(value: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!match) return null;
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return 0;

  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts[index] - rightParts[index];
    if (diff !== 0) return Math.sign(diff);
  }

  return 0;
}

export function resolveOfficialReleaseUrl(value: unknown): string {
  if (typeof value !== 'string') return OFFICIAL_RELEASES_URL;

  try {
    const url = new URL(value);
    const officialPath = /^\/ferxalbs\/mate-x\/releases(?:\/|$)/.test(url.pathname);
    return url.protocol === 'https:' && url.hostname === 'github.com' && officialPath
      ? url.toString()
      : OFFICIAL_RELEASES_URL;
  } catch {
    return OFFICIAL_RELEASES_URL;
  }
}

function parseRelease(value: unknown): GitHubRelease | null {
  if (!value || typeof value !== 'object') return null;
  const release = value as Record<string, unknown>;
  if (release.draft !== false || typeof release.tag_name !== 'string') return null;
  if (!parseVersion(release.tag_name)) return null;

  const htmlUrl = resolveOfficialReleaseUrl(release.html_url);
  if (htmlUrl === OFFICIAL_RELEASES_URL) return null;

  return {
    draft: false,
    htmlUrl,
    prerelease: release.prerelease === true,
    tagName: release.tag_name,
    version: release.tag_name.replace(/^v/, ''),
  };
}

export function selectLatestRelease(
  payload: unknown,
  currentVersion: string,
): GitHubRelease | null {
  if (!Array.isArray(payload) || !parseVersion(currentVersion)) return null;

  let latest: GitHubRelease | null = null;
  for (const value of payload) {
    const release = parseRelease(value);
    if (!release || compareVersions(release.version, currentVersion) <= 0) continue;
    if (!latest || compareVersions(release.version, latest.version) > 0) {
      latest = release;
    }
  }

  return latest;
}
