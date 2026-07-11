/**
 * Engineering control-plane feature flags (shared; safe for renderer + main).
 */

import {
  DEFAULT_ENGINEERING_FEATURE_FLAGS,
  type EngineeringFeatureFlags,
} from '../contracts/engineering-task';

let flags: EngineeringFeatureFlags = { ...DEFAULT_ENGINEERING_FEATURE_FLAGS };

export function getEngineeringFeatureFlags(): EngineeringFeatureFlags {
  return { ...flags };
}

export function setEngineeringFeatureFlags(
  next: Partial<EngineeringFeatureFlags>,
): EngineeringFeatureFlags {
  flags = { ...flags, ...next };
  return getEngineeringFeatureFlags();
}

export function resetEngineeringFeatureFlagsForTests(): void {
  flags = { ...DEFAULT_ENGINEERING_FEATURE_FLAGS };
}

export function isEngineeringControlPlaneEnabled(): boolean {
  return flags.engineeringControlPlane;
}

export function isMainProcessGitGateEnabled(): boolean {
  return flags.mainProcessGitGate;
}

export function isStrictValidationNoTextWaive(): boolean {
  return flags.strictValidationNoTextWaive;
}

export function isMultiAgentLeasesEnabled(): boolean {
  return flags.multiAgentLeases;
}
