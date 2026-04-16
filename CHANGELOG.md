# CHANGELOG

## Unreleased - 2026.04.16 (1) [Workspace Persistence and Turso Foundation]

- Added real workspace management for the desktop shell, including folder import, workspace switching, removal, and active project tracking from the sidebar.
- Connected source control and repository inspection to the active workspace instead of a fixed `process.cwd()`, so each imported folder has its own live git context.
- Implemented persistent workspace and AI session storage on top of `@libsql/client`, with Turso-compatible configuration and local-first fallback for Electron user data.
- Persisted conversation threads per workspace, including active thread restoration after app restart or workspace changes.
- Wired system actions for the active workspace, including open folder, open in VS Code, and desktop-level workspace session synchronization through IPC.
