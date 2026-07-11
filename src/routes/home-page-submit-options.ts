import type { AssistantRunOptions } from '../contracts/chat';
import { defaultAmbientSafetyRunOptions } from '../features/desktop-shell/components/ambient-safety-actions';

export function buildHomePageSubmitOptions(
  overrides?: Partial<AssistantRunOptions>,
): AssistantRunOptions {
  return {
    ...defaultAmbientSafetyRunOptions,
    ...overrides,
  };
}
