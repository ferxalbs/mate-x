import type { AssistantRunOptions } from '../contracts/chat';
import { behaviorRunOptions, type BehaviorPreference } from '../contracts/behavior-mode';
import { defaultAmbientSafetyRunOptions } from '../features/desktop-shell/components/ambient-safety-actions';

export function buildHomePageSubmitOptions(
  overrides?: Partial<AssistantRunOptions>,
): AssistantRunOptions {
  return {
    reasoningEnabled: defaultAmbientSafetyRunOptions.reasoningEnabled ?? true,
    reasoning: defaultAmbientSafetyRunOptions.reasoning ?? 'high',
    pathKind: defaultAmbientSafetyRunOptions.pathKind ?? 'verify_only',
    access: defaultAmbientSafetyRunOptions.access ?? 'approval',
    serviceTier: defaultAmbientSafetyRunOptions.serviceTier ?? 'standard',
    ...overrides,
  };
}

export function buildHomePageSubmission(
  prompt: string,
  behavior: BehaviorPreference,
  overrides?: Partial<AssistantRunOptions>,
) {
  return {
    prompt,
    options: buildHomePageSubmitOptions({
      ...behaviorRunOptions(behavior),
      ...overrides,
    }),
  };
}
