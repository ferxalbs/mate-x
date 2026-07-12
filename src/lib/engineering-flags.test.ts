import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  attemptDisableControlPlaneInRelease,
  attemptDisableGitGateInRelease,
  canUseDevEngineeringOverrides,
  getEngineeringFeatureFlags,
  isEngineeringControlPlaneEnabled,
  isMainProcessGitGateEnabled,
  isReleaseBuild,
  resetEngineeringFeatureFlagsForTests,
  setEngineeringFeatureFlags,
} from './engineering-flags';

afterEach(() => {
  resetEngineeringFeatureFlagsForTests();
});

describe('engineering feature flags release policy [R3]', () => {
  it('defaults enable control plane and GitGate', () => {
    const f = getEngineeringFeatureFlags();
    assert.equal(f.engineeringControlPlane, true);
    assert.equal(f.mainProcessGitGate, true);
  });

  it('dev overrides can disable when not release', () => {
    process.env.MATE_X_RELEASE_BUILD = '0';
    assert.equal(isReleaseBuild(), false);
    assert.equal(canUseDevEngineeringOverrides(), true);
    setEngineeringFeatureFlags({
      engineeringControlPlane: false,
      mainProcessGitGate: false,
    });
    assert.equal(isEngineeringControlPlaneEnabled(), false);
    assert.equal(isMainProcessGitGateEnabled(), false);
  });

  it('release builds reject disable attempts', () => {
    process.env.MATE_X_RELEASE_BUILD = '1';
    assert.equal(isReleaseBuild(), true);
    assert.equal(canUseDevEngineeringOverrides(), false);

    setEngineeringFeatureFlags({
      engineeringControlPlane: false,
      mainProcessGitGate: false,
      legacyFactoryUi: true,
    });
    const f = getEngineeringFeatureFlags();
    assert.equal(f.engineeringControlPlane, true);
    assert.equal(f.mainProcessGitGate, true);
    assert.equal(f.legacyFactoryUi, false);

    const cp = attemptDisableControlPlaneInRelease();
    assert.equal(cp.effective, true);
    assert.equal(cp.accepted, false);

    const gg = attemptDisableGitGateInRelease();
    assert.equal(gg.effective, true);
    assert.equal(gg.accepted, false);
  });
});
