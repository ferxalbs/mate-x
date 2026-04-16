# CHANGELOG

## Unreleased - 2026.04.16 (2) [Rainy API v3 Integration and Settings Panel]

- Migrated the AI provider from OpenAI to Rainy API v3 across the full pipeline: `repo-service.ts` now builds the client with a constant `baseURL` and reads the API key at request time from the local database, eliminating all runtime environment variable dependencies.
- Replaced the generic English system prompt with a security-focused Spanish prompt that establishes MaTE X as a local code review agent with precise, evidence-grounded behavior.
- Extended `turso-service.ts` with `getApiKey`, `setApiKey`, and `clearApiKey` methods persisted in the existing `app_state` table, so the user's key survives restarts without any additional schema changes.
- Added three new IPC channels (`settings:get-api-key`, `settings:set-api-key`, `settings:clear-api-key`) registered in `ipc-handlers.ts` and wired through a new `SettingsApi` contract in `contracts/ipc.ts`.
- Exposed `window.mate.settings` in the contextBridge preload so the renderer can read and write the API key safely without accessing the Node.js layer directly.
- Created `services/settings-client.ts` as the renderer-side façade for the settings IPC channels, following the same pattern as `repo-client.ts`.
- Replaced the renderer-side `lib/openai.ts` client to use Rainy API v3 and resolve the API key through `window.mate.settings.getApiKey()` instead of environment variables or localStorage.
- Built a Settings dialog (`settings-dialog.tsx`) with API key input, masked display, connected/not-connected status badge, save and remove actions, and a security note — visually consistent with the existing workspace overview dialog using Base UI, custom CSS properties, and the same surface and typography patterns.
- Renamed the previous `settings-dialog.tsx` to `workspace-dialog.tsx` to preserve the workspace overview feature without breaking existing props.
- Wired the Settings dialog into the sidebar footer so clicking the "Settings" row opens the API key panel, while theme toggles remain functional with `stopPropagation`.

## Unreleased - 2026.04.16 (1) [Workspace Persistence and Turso Foundation]

- Added real workspace management for the desktop shell, including folder import, workspace switching, removal, and active project tracking from the sidebar.
- Connected source control and repository inspection to the active workspace instead of a fixed `process.cwd()`, so each imported folder has its own live git context.
- Implemented persistent workspace and AI session storage on top of `@libsql/client`, with Turso-compatible configuration and local-first fallback for Electron user data.
- Persisted conversation threads per workspace, including active thread restoration after app restart or workspace changes.
- Wired system actions for the active workspace, including open folder, open in VS Code, and desktop-level workspace session synchronization through IPC.