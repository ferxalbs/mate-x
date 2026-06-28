import type { GitApi, GitHubIntegrationApi, PolicyApi, PrivacyApi, RepoInspectorApi, SettingsApi, UiApi } from './contracts/ipc';

declare global {
  interface Window {
    mate: {
      repo: RepoInspectorApi;
      git: GitApi;
      github: GitHubIntegrationApi;
      proof: undefined;
      settings: SettingsApi;
      policy: PolicyApi;
      privacy: PrivacyApi;
      ui: UiApi;
    };
  }
}

export {};
