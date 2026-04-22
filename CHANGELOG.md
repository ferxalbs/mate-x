# CHANGELOG

## Unreleased - 2026.04.22 (3) [Unrestricted Workspace Trust Mode]

- Introduced a new `unrestricted` autonomy mode for Workspace Trust Contracts, granting AI models full access to read/write any file, run any shell command, and access any network domain.
- Added a high-risk confirmation modal in Settings > Trust that requires explicit user acceptance of security risks before enabling Unrestricted mode.
- Updated the trust evaluation engine in the main process to bypass all security blocks when Unrestricted mode is active.
- Enhanced the system prompt generation to explicitly communicate full permission status to the AI model when running in Unrestricted mode.

## Unreleased - 2026.04.22 (2) [Evidence Pack Runtime Artifact and Modular Finalization]

- Added a first-class `evidencePack` contract on chat messages with structured fields for verdict, status, modified files, commands, tools used, tests, warnings, unresolved risks, touched paths, and recommendation.
- Implemented runtime Evidence Pack assembly from execution traces and tool metadata, including parsed structured tool outputs and git status-derived file impact.
- Captured per-tool execution records during agent loops so Evidence Pack evidence is grounded in runtime actions rather than inferred from narrative text.
- Added a dedicated Evidence Pack panel in assistant messages and kept RunTimeline as the separate raw operational log.
- Modularized implementation by extracting Evidence Pack runtime logic into `src/electron/evidence-pack.ts` and UI rendering into `src/features/desktop-shell/components/evidence-pack-card.tsx`.
- Added `src/electron/evidence-finalization.ts` to parse agent-authored judgment sections (`Verdict`, `Verdict summary`, `Confidence`, `Warnings`, `Unresolved risks`, `Final recommendation`) and merge them with runtime-derived evidence.
- Updated agent final-answer guidance so those judgment headings are emitted consistently when applicable, improving reliability of structured finalization extraction.

## Unreleased - 2026.04.22 (1) [AgentTrace v2 Inline Streaming Repair]

- Switched Rainy chat completions to the streaming API path for agentic runs, emitting assistant content deltas live instead of waiting for the full completion.
- Updated the agent loop so models can answer from existing workspace context, emit brief natural-language progress before tools, and avoid forced investigation/tool use when it is not needed.
- Reworked AgentTrace v2 inline rendering so internal run metadata stays hidden while real tool activity remains available as compact collapsed action groups.
- Fixed v2 pending states to avoid exposing internal events such as `Agent pass`, `workspace metadata`, `prompt-linked files`, and `response complete`.
- Added fallback rendering for tool events that were emitted by the runtime but not referenced by model-inserted inline trace markers, preventing used tools from disappearing.
- Added visible-text normalization for provider/model channel artifacts and reasoning tags, including `<think>`, `<thinking>`, `<thought>`, `<reasoning>`, `<analysis>`, and OpenAI-style channel tokens.
- Rewrote the MaTE X system prompt in English with stricter guidance for scoped tool use, evidence-driven responses, inline progress updates, and avoiding redundant repository exploration.
- Verified the repair with `bun run lint` and `bunx tsc --noEmit --ignoreDeprecations 6.0`.

## Unreleased - 2026.04.21 (3) [Agent Trace v2 UX and Settings Integration]

- Added a persisted `agentTraceVersion` app setting (`v1` or `v2`) with strict normalization and default value `v2` in shared settings contracts and Turso persistence.
- Added a new Settings → General control (`Agent Trace mode`) so users can switch between trace versions from the existing app shell.
- Upgraded composer model selection UX to better handle full catalog browsing by showing both model label and raw model id in the dropdown options.
- Wired chat route hydration to read persisted app settings and pass `agentTraceVersion` into the message stream renderer.
- Introduced dual trace rendering paths in message stream:
  - `v1`: legacy run activity timeline behavior.
  - `v2`: inline model-actions trace integrated directly into assistant response flow.
- Reworked v2 trace interaction to be collapsed by default, expandable on demand, and visually staggered for action rows so it feels embedded in chat rather than a standalone timeline panel.
- Added full-action inspection for v2 with a dedicated modal (`View all actions`) that lists all executed tool actions extracted from the streamed run events.
- Improved v2 modal interaction with close controls via dedicated button, backdrop click, and `Esc` keyboard shortcut.

## Unreleased - 2026.04.21 (2) [Real Settings Persistence and Theme/Time Wiring]

- Added a real app-settings contract (`AppSettings`) with persisted fields for theme preference, time format, diff line wrapping, assistant streaming output, archive confirmation, and delete confirmation.
- Extended settings IPC and preload bridges with `settings:get-app-settings` and `settings:update-app-settings`, plus renderer-side settings client helpers for reading, updating, and applying settings.
- Persisted app settings in the existing `app_state` table through `turso-service`, including strict normalization and defaults fallback for malformed or missing values.
- Rewired `/settings` General and Archive sections to load persisted values on entry, track pending changes against saved state, save through IPC, and restore defaults by section.
- Connected theme preference to persisted app settings and shell hydration, so startup now applies the stored DB theme as the source of truth instead of isolated local-only toggles.
- Connected time-format preference to chat timestamp formatting (`system`, `12h`, `24h`) and ensured renderer hydration applies it globally after boot.

## Unreleased - 2026.04.21 (1) [Workspace Trust Contracts]

- Added workspace-scoped trust contracts that define allowed paths, forbidden paths, allowed commands, allowed network domains, allowed secrets, allowed actions, blocked actions, and autonomy level per workspace.
- Persisted each contract in the local workspace database and included the active contract in workspace snapshots so renderer state, settings, and assistant runs share the same governed profile.
- Added a same-shell Settings section at `/settings/trust` for editing the active workspace contract without leaving the existing MaTE X desktop chrome.
- Displayed the active contract version, autonomy level, allowed scope, and blocked actions in the composer before each run.
- Enforced contracts in the Electron tool layer before execution, including action checks, command allowlists, path scope checks, forbidden-path checks, and plan-only autonomy restrictions.
- Scoped ripgrep searches through the active contract and prevented Rainy API calls when the provider domain is not allowed by the contract.
- Added a narrow `bun:test` type shim so repository type-checking remains clean with the existing colocated tests.

## Unreleased - 2026.04.19 (1) [Tool Service Hardening and Native Tool Reliability]

- Added native tools `read_many` and `json_probe` so agent can read many files fast and query JSON values directly.
- Added shared safe-path helpers in `src/electron/tools/tool-utils.ts` to block traversal and keep tool file access inside workspace root.
- Hardened `ToolService` registration/execution: duplicate-name guard, cached tool definitions, strict schema normalization, runtime arg validation before tool run.
- Registered new tools in both chat and responses tool-definition paths so agent can call them natively in both loops.
- Secured core tools (`read`, `ls`, `metadata`, `auto_patch`, `mutation`, `flow`) with safer path handling, bounded output, safer command execution, and fixed regex term matching.
- Reduced tool batch concurrency in `repo-service.ts` to improve stability and avoid overload during multi-tool turns.
- Verified integration and quality: `bun run lint` and `bun run typecheck` pass; new tools present in runtime registry.

## Unreleased - 2026.04.17 (4) [Chat Flow and Context Extraction Repair]

- Reworked the assistant conversation surface to remove the dedicated `Agent trace` / execution-trace blocks from chat and present in-flight progress as normal inline assistant updates, matching the T3CODE-style flow more closely.
- Removed the visible artifact pill strip from assistant messages so the main conversation stays focused on the reply itself instead of internal telemetry.
- Fixed the broken `ast_grep` context extraction path that was incorrectly parsing ripgrep output with escaped newline and digit patterns, which caused valid matches to degrade into the useless `Matches found, but context extraction failed.` error.
- Added a safer fallback in `ast_grep` so when full block reconstruction is not possible, the tool still returns usable local snippet context instead of collapsing into a hard failure string.
- Corrected assistant history replay inside the tool loop so prior turns are reconstructed from their stored `user:` / `assistant:` roles rather than being reassigned by index parity, improving multi-pass model behavior during iterative tool use.

## Unreleased - 2026.04.17 (3) [Ultimate Enterprise Security Arsenal Expansion]

- Expanded the MaTE X intelligence suite from basic static analysis to an enterprise-grade agent with 24 specialized security tools for localized auditing.
- Implemented **Deep Code Auditing Tools (`read`, `ls`, `git_diag`)** allowing the agent to perform vulnerability archaeology via commit history and precise line-range reads of the local filesystem.
- Added a **"Perfect" Security Toolset (`secret_scan`, `file_metadata`, `tree`)** capable of confidently finding hardcoded secrets, analyzing file permissions, and creating structural project map visualizations.
- Introduced **Advanced Intelligence Forensics (`security_audit`, `dependency_check`)** to run categorized, pattern-based audits for logic flaws (e.g., `innerHTML`, `exec()`) and identify supply-chain risks in package manifests.
- Deployed **Infrastructure & Compliance Scanners (`network_map`, `sql_audit`, `env_audit`, `container_audit`)** that actively map the application's external boundaries, database sinks, and container definitions (Docker/Kube) for deployment compliance.
- Powered up the agent with the **Extreme Intelligence Suite (`flow_trace`, `entropy_scan`, `auth_audit`, `security_report`)** for iterating through variables across multiple files, detecting encrypted/hashed tokens mathematically via Shannon entropy, and outputting top-tier prioritized POSTURE reports.
- Achieved **Grade A Active Remediation (`auto_patch`, `fuzzer`, `cve_audit`)**, equipping the agent with the autonomy to actively fuzzy-test endpoints using live DAST payloads, pull exact offline CVE numbers via package managers, and safely generate plus inject code modifications (patches) back into the repository with `.bak` rollback safety.
- Mastered the state with the **Enterprise Attack Simulation Suite (`sandbox_run`, `traffic_poison`, `mock_poison`)**, allowing the tool to spin up the local application inside an isolated background sandbox, simulate highly advanced context-aware logic breaks (Mass Assignment, Logic Bombs), and launch "poisoned" external HTTP servers to test application deserialization resilience.
- Integrated the **Mutation Testing Engine (`mutation`)** to safely and temporarily inject invisible glitches into the source code to statistically unearth missing test coverage.
- All tools dynamically registered under the unified `ToolService`, instantly available to the OpenAI-compatible Rainy payload schemas over standard IPC links, and thoroughly checked free of any TypeScript compiler or ESLint warnings.

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
