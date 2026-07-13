import { AgentRuntimeReadiness } from './orchestration/agent-runtime-readiness';
import type { SDKOrchestrator } from './orchestration/sdk-orchestrator';

/**
 * Shared SDK orchestrator readiness state.
 * Kept outside repo-service so main/main-stack can wire readiness without
 * pulling the full assistant / work-engine dependency graph at startup.
 */
const sdkOrchestratorReadiness = new AgentRuntimeReadiness<SDKOrchestrator>();

export function setSDKOrchestrator(orchestrator: SDKOrchestrator | null) {
  sdkOrchestratorReadiness.setRuntime(orchestrator);
}

export function setSDKOrchestratorInitializationError(error: unknown) {
  sdkOrchestratorReadiness.setInitializationError(error);
}

export function getSDKOrchestratorReadinessError() {
  return sdkOrchestratorReadiness.getErrorMessage();
}

export function getSDKOrchestrator() {
  return sdkOrchestratorReadiness.getRuntime();
}
