/**
 * Engineering control-plane feature flags (shared; safe for renderer + main).
 * R3: release/packaged builds force control plane + GitGate ON — no bypass.
 */

import {
  DEFAULT_ENGINEERING_FEATURE_FLAGS,
  type EngineeringFeatureFlags,
} from '../contracts/engineering-task';

let flags: EngineeringFeatureFlags = { ...DEFAULT_ENGINEERING_FEATURE_FLAGS };

/**
 * True when running a packaged/release binary or explicit release marker.
 * Development and unit tests are non-release unless MATE_X_RELEASE_BUILD=1.
 */
export function isReleaseBuild(): boolean {
  if (process.env.MATE_X_RELEASE_BUILD === '1') {
    return true;
  }
  if (process.env.MATE_X_RELEASE_BUILD === '0') {
    return false;
  }
  // Electron main: app.isPackaged when available
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as {
      app?: { isPackaged?: boolean };
    };
    if (electron?.app && typeof electron.app.isPackaged === 'boolean') {
      return electron.app.isPackaged;
    }
  } catch {
    // not in electron
  }
  return false;
}

/**
 * Dev-only overrides are rejected in release builds.
 */
export function canUseDevEngineeringOverrides(): boolean {
  return !isReleaseBuild();
}

export function getEngineeringFeatureFlags(): EngineeringFeatureFlags {
  const base = { ...flags };
  if (isReleaseBuild()) {
    return {
      ...base,
      engineeringControlPlane: true,
      mainProcessGitGate: true,
      legacyFactoryUi: false,
    };
  }
  return base;
}

export function setEngineeringFeatureFlags(
  next: Partial<EngineeringFeatureFlags>,
): EngineeringFeatureFlags {
  if (isReleaseBuild()) {
    // Ignore attempts to disable hard requirements in release
    const sanitized = { ...next };
    if (sanitized.engineeringControlPlane === false) {
      delete sanitized.engineeringControlPlane;
    }
    if (sanitized.mainProcessGitGate === false) {
      delete sanitized.mainProcessGitGate;
    }
    if (sanitized.legacyFactoryUi === true) {
      delete sanitized.legacyFactoryUi;
    }
    flags = { ...flags, ...sanitized };
    return getEngineeringFeatureFlags();
  }
  flags = { ...flags, ...next };
  return getEngineeringFeatureFlags();
}

export function resetEngineeringFeatureFlagsForTests(): void {
  flags = { ...DEFAULT_ENGINEERING_FEATURE_FLAGS };
  delete process.env.MATE_X_RELEASE_BUILD;
}

export function isEngineeringControlPlaneEnabled(): boolean {
  return getEngineeringFeatureFlags().engineeringControlPlane;
}

export function isMainProcessGitGateEnabled(): boolean {
  return getEngineeringFeatureFlags().mainProcessGitGate;
}

export function isStrictValidationNoTextWaive(): boolean {
  return getEngineeringFeatureFlags().strictValidationNoTextWaive;
}

export function isMultiAgentLeasesEnabled(): boolean {
  return getEngineeringFeatureFlags().multiAgentLeases;
}

/** Negative API: prove release rejects disable attempts. */
export function attemptDisableControlPlaneInRelease(): {
  accepted: boolean;
  effective: boolean;
} {
  setEngineeringFeatureFlags({ engineeringControlPlane: false });
  return {
    accepted: !isReleaseBuild() && !flags.engineeringControlPlane,
    effective: isEngineeringControlPlaneEnabled(),
  };
}

export function attemptDisableGitGateInRelease(): {
  accepted: boolean;
  effective: boolean;
} {
  setEngineeringFeatureFlags({ mainProcessGitGate: false });
  return {
    accepted: !isReleaseBuild() && !flags.mainProcessGitGate,
    effective: isMainProcessGitGateEnabled(),
  };
}
