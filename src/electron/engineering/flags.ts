/** Re-export shared flags for main-process import paths. */
export {
  attemptDisableControlPlaneInRelease,
  attemptDisableGitGateInRelease,
  canUseDevEngineeringOverrides,
  getEngineeringFeatureFlags,
  isEngineeringControlPlaneEnabled,
  isMainProcessGitGateEnabled,
  isMultiAgentLeasesEnabled,
  isReleaseBuild,
  isStrictValidationNoTextWaive,
  resetEngineeringFeatureFlagsForTests,
  setEngineeringFeatureFlags,
} from '../../lib/engineering-flags';

