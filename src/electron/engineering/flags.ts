/** Re-export shared flags for main-process import paths. */
export {
  getEngineeringFeatureFlags,
  isEngineeringControlPlaneEnabled,
  isMainProcessGitGateEnabled,
  isMultiAgentLeasesEnabled,
  isStrictValidationNoTextWaive,
  resetEngineeringFeatureFlagsForTests,
  setEngineeringFeatureFlags,
} from '../../lib/engineering-flags';

