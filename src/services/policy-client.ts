import type { PolicyApi } from '../contracts/ipc';
import type { ResolvePolicyStopRequest } from '../contracts/policy';

function getPolicyApi(): PolicyApi {
  if (!window.mate?.policy) {
    throw new Error('Mate policy API is not available in the renderer.');
  }
  return window.mate.policy;
}

export function listPolicyStops(runId?: string) {
  return getPolicyApi().listStops(runId);
}

export function resolvePolicyStop(request: ResolvePolicyStopRequest) {
  return getPolicyApi().resolveStop(request);
}
