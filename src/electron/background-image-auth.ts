/**
 * Shared in-memory state for the mate-local:// custom protocol handler.
 *
 * Extracted into its own module to avoid a circular import between main.ts
 * (which registers the protocol handler) and ipc-handlers.ts (which updates
 * settings and must keep the cache current).
 *
 * Lifecycle:
 *  - Initialised from the DB by main.ts after tursoService.initialize().
 *  - Updated by ipc-handlers.ts whenever settings:update-app-settings runs.
 *  - Read synchronously by the protocol handler on every mate-local:// request.
 */

import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const BACKGROUND_IMAGE_MAX_BYTES = 40 * 1024 * 1024;

/** Formats Chromium can render as a local CSS/image resource on macOS. */
export const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.tiff',
  '.tif',
  '.svg',
  '.heic',
  '.heif',
  '.ico',
]);

let _authorizedPath: string | null = null;

/**
 * Update the authorized background image path.
 * Pass `undefined` or `null` to revoke access.
 */
export function setAuthorizedBackgroundImagePath(p: string | undefined | null): void {
  _authorizedPath = p ? path.resolve(p) : null;
}

/**
 * Return the currently authorized background image path (already resolved),
 * or `null` if no image is authorized.
 */
export function getAuthorizedBackgroundImagePath(): string | null {
  return _authorizedPath;
}

/**
 * Build a URL without exposing a file:// URL to renderer content.
 * Encoding each path segment preserves spaces, #, ?, %, and unicode in macOS
 * filenames instead of allowing them to change URL parsing semantics.
 */
export function toLocalImageUrl(filePath: string): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  return `mate-local://${normalized.split('/').map(encodeURIComponent).join('/')}`;
}

/** Parse and validate a mate-local request before it reaches the filesystem. */
export function parseLocalImageRequest(
  requestUrl: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  try {
    const parsedUrl = new URL(requestUrl);
    if (parsedUrl.protocol !== 'mate-local:') return null;

    let requestedPath = decodeURIComponent(parsedUrl.pathname);
    if (platform === 'win32' && /^\/[a-zA-Z]:/.test(requestedPath)) {
      requestedPath = requestedPath.slice(1);
    }

    if (!path.isAbsolute(requestedPath)) return null;
    const resolvedPath = path.resolve(requestedPath);
    return ALLOWED_IMAGE_EXTENSIONS.has(path.extname(resolvedPath).toLowerCase())
      ? resolvedPath
      : null;
  } catch {
    return null;
  }
}

/**
 * Copy a selected image into app-owned storage. Persisting the source path is
 * not durable on macOS because Downloads, iCloud, and temporary providers can
 * move or evict the original file.
 */
export async function persistBackgroundImagePath(
  sourcePath: string,
  userDataPath: string,
): Promise<string> {
  const resolvedSourcePath = path.resolve(sourcePath);
  const extension = path.extname(resolvedSourcePath).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error('Choose a supported image format such as PNG, JPEG, WebP, GIF, or HEIC.');
  }

  const sourceStat = await stat(resolvedSourcePath);
  if (!sourceStat.isFile()) {
    throw new Error('The selected background image is not a regular file.');
  }
  if (sourceStat.size > BACKGROUND_IMAGE_MAX_BYTES) {
    throw new Error('Choose an image smaller than 40 MB to keep the interface responsive.');
  }

  const destinationDirectory = path.join(userDataPath, 'background-images');
  const destinationPath = path.join(destinationDirectory, `background${extension}`);
  if (resolvedSourcePath === destinationPath) {
    return destinationPath;
  }

  await mkdir(destinationDirectory, { recursive: true });
  const temporaryPath = path.join(
    destinationDirectory,
    `.background-${randomUUID()}${extension}.tmp`,
  );
  try {
    await copyFile(resolvedSourcePath, temporaryPath);
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return destinationPath;
}
