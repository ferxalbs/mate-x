import type { GitApi, GitHubIntegrationApi, PolicyApi, PrivacyApi, ProofApi, RepoInspectorApi, SettingsApi, UiApi } from './contracts/ipc';

declare global {
  interface Window {
    mate: {
      repo: RepoInspectorApi;
      git: GitApi;
      github: GitHubIntegrationApi;
      proof: ProofApi;
      settings: SettingsApi;
      policy: PolicyApi;
      privacy: PrivacyApi;
      ui: UiApi;
    };
  }
}

export {};
