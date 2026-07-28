import type { PolicyApi } from '../contracts/ipc';
import type {
  PolicyStopListScope,
  ResolvePolicyStopRequest,
} from '../contracts/policy';

function getPolicyApi(): PolicyApi {
  if (!window.mate?.policy) {
    throw new Error('Mate policy API is not available in the renderer.');
  }
  return window.mate.policy;
}

export function listPolicyStops(scope: PolicyStopListScope) {
  return getPolicyApi().listStops(scope);
}

export function resolvePolicyStop(request: ResolvePolicyStopRequest) {
  return getPolicyApi().resolveStop(request);
}
