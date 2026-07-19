/**
 * Settings writes initiated by the user from the app UI already carry explicit
 * user intent. They must not wait for the agent-run approval surface, which is
 * reserved for actions proposed by an agent or an external device.
 */
const DIRECT_USER_SETTING_ACTIONS = new Set([
  "settings:set-api-key",
]);

export function requiresSensitiveIpcApproval(action: string): boolean {
  return !DIRECT_USER_SETTING_ACTIONS.has(action);
}
