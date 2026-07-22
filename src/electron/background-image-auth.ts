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

import path from 'node:path';

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
