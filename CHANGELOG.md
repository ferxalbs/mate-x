# CHANGELOG

## MaTE X v0.1.2 — Native Engineering Control System

MaTE X v0.1.2 introduces a major redesign of the engineering workflow, focused on turning a single development objective into controlled, traceable, and verified repository work.

This release establishes **EngineeringTask** as the canonical workflow authority and replaces fragmented internal flows with one unified system for intent, execution, validation, evidence, and Git safety.

### Highlights

#### Native engineering workflow

MaTE X now maintains a persistent engineering task across the complete lifecycle:

**Intent → Investigation → Plan → Execution → Validation → Ship Proof**

Specifications and plans remain available internally without forcing users to manage unnecessary workflow ceremony.

#### Behavior modes

MaTE X now supports four autonomy profiles:

* **Auto** — safely investigates, edits, and validates within the active workspace.
* **Guided** — inspects automatically and requests approval before mutations.
* **Review** — read-only repository analysis.
* **Custom** — granular control over edits, commands, network access, Git, and validation.

Auto mode uses **scoped autonomy** and never grants unrestricted system access.

#### Conversational product experience

* Removed the large persistent workflow card.
* Added compact task details and inline activity.
* Reduced unnecessary questions and approval interruptions.
* Improved composer sizing and message visibility.
* Removed dead and contradictory workflow actions.
* Technical evidence remains available without dominating the conversation.

#### Trust and Git protection

* Git commit and push are protected by the main-process GitGate.
* Stale repository state invalidates previous proof.
* Provider text cannot authorize workflow transitions or evidence.
* Review mode cannot mutate the repository.
* Writes outside the active workspace require explicit approval.
* Dependency installation and destructive actions remain gated.

#### Validation and evidence

* Typed validation records replace prose-based completion claims.
* Evidence is linked to the active repository state.
* Coverage convergence detects incomplete requirements, tasks, and validation.
* Ship Proof summarizes what changed, what was validated, and what remains unproven.

#### Persistence and recovery

* Engineering tasks are stored durably using libSQL.
* Tasks can be restored after restarting MaTE X.
* Approvals, workflow state, validation, and evidence remain associated with the same task.
* Legacy v0.1.1 state is migrated into the new canonical system.

#### Production hardening

* Removed embedded self-test and performance harnesses from the production runtime.
* Moved QA and release qualification tooling outside `src/`.
* Removed fake agents and generated evidence from distributed artifacts.
* Added package-purity verification.
* Corrected packaged ripgrep resolution.
* Standardized the local MaTE X namespace as `.mate-x/`.

## Unreleased - 2026.07.11 [Native Engineering Control System]

* Introduced the canonical `EngineeringTask` aggregate with typed status transitions, immutable ledger events, and optimistic concurrency (`aggregateVersion`).
* Added main-process control plane: intent freeze, clarification decisions, plan/task-graph compilers, ID-only consistency, serial leases, coverage convergence, Ship Proof registry, and GitGate.
* Git commit/push now fail closed without a fresh `ProofHandle` (`mainProcessGitGate`); stale HEAD/diff/policy hashes deny writes. Renderer window globals are not enforcement.
* Hardened validation gate so mutation ledger entries cannot be waived by model prose (“no changes” text).
* Evidence status no longer treats “Response complete” alone as complete; validation tool evidence is required.
* Disabled FactoryRun write authority when `engineeringControlPlane` is on; legacy Factory stages are not product truth for new work.
* Removed user-facing “Factory verification” product CTA language in favor of conversational EngineeringTask projection; `pathKind` remains internal routing only.
* Trust defaults use detect-or-deny: non-JS workspaces no longer receive a universal bun command allowlist.
* libSQL schema extended with EngineeringTask tables (idempotent migrations).
* Preload exposes `mate.engineering` for command dispatch and gate evaluation.
* Behavior modes: **Auto** (`auto_scoped`), **Guided**, **Review** (read-only), and **Custom** with per-control toggles; Auto never maps to unrestricted Full access.
* Conversational product flow: optional collapsible task details; removed dead “Start execution” / “Run validation” CTAs while work is already active.
* Production packaging purity: QA/self-test harnesses live under `qa/` and `scripts/release/`; fake adapters under `tests/helpers/`.
* macOS is the qualified v0.1.2 platform; Windows qualification is deferred (non-blocking).
* Canonical workspace namespace remains `.mate-x/` (default evidence bucket aligned).

## Unreleased - 2026.07.11 (1) [Model Power Selector and Agent Runtime Readiness]

* Rebuilt the composer model-power selector around explicit GPT-5.6 and Claude family modes instead of an unstable keyword score across the entire model catalog.
* Added deterministic Faster-to-Smartest ordering for available family variants, covering Luna Light/Haiku, Luna, Terra/Sonnet, Sol/Opus, and declared Pro/Max/Ultra variants, with provider pricing used to order models within the same capability tier.
* Extracted model-family filtering, power classification, pricing comparison, and mode labels into a focused `model-power-selector` module with unit coverage, keeping unrelated models out of the power slider without inventing unavailable catalog entries.
* Fixed slider dragging and track selection by removing parent pointer-event interception and using Base UI's controlled numeric `onValueChange` contract directly.
* Redesigned Advanced as two mutually exclusive menu views: the normal view shows Model, Effort, and Speed, while slider mode hides those controls and shows only Advanced, Faster/Smartest, the power slider, the selected mode, and the exact selected model.
* Improved selector responsiveness with a compact flat panel, theme-aware border, no heavy shadow, reduced backdrop blur, a 150 ms snappy transition, functional disclosure state updates, and no drag-time mounting or unmounting of menu sections.
* Added a configurable accessible thumb label to the shared Slider primitive and disabled model-power interaction cleanly when fewer than two matching catalog models are available.
* Hardened agent startup diagnostics by retaining the original SDK orchestrator initialization failure when the Electron shell continues in core-settings mode, replacing the late generic error with an actionable runtime-readiness message.
* Extracted SDK orchestrator readiness and initialization-error state into a dependency-free `AgentRuntimeReadiness` module so startup recovery clears stale errors atomically and the behavior can be tested without loading Electron.
* Added focused regression coverage for GPT-5.6/Claude filtering and ordering, endpoint and intermediate mode labels, pricing tie-breaking, preserved startup failures, not-ready fallback guidance, and readiness recovery.
* Verified the focused selector and runtime-readiness tests (6 passing), `bun run typecheck`, lint with zero errors, and `git diff --check`. The full Bun suite reached 297 passing tests with one unrelated pre-existing GPT-5.6 pricing-notice assertion failure.

## Unreleased - 2026.07.10 (3) [Public Release Hardening]

* Repositioned public copy around “The trust layer for AI-written code,” removed open-source/IDE/chatbot/factory ambiguity, and aligned README, package metadata, security language, licence terminology, supported platforms, runtime versions, Rainy requirements, and release commands.
* Added the canonical `bun run verify` release contract covering lint, typecheck, Bun tests, and packaging configuration validation.
* Documented and tested public packaging targets as macOS and Windows only; Linux makers remain intentionally omitted until Linux is supported.
* Added provider-neutral verification model profiles (Fast, Balanced, Deep, Critical) with Luna/Terra/Sol routing, declared-only Pro selection, reasoning effort/mode separation, requested vs effective tier tracking, high-context pricing disclosure, and explainable escalation reasons.
* Added privacy-safe local product metrics primitives that drop paths, prompts, code, commands, evidence, secrets, API keys, and raw repository identifiers while preserving value metrics such as validation counts, latency, costs, model profile, escalation, blocks, remediations, cancellations, and failure categories.
* Tightened Ship Proof unlock logic so Git is allowed only when a complete proof includes executed validation command evidence with no failed or missing evidence; model prose alone remains blocked.
* Standardized user-facing decision language toward Ready, Needs check, Risk found, Blocked, and Not proven.

## Unreleased - 2026.07.10 (2) [Rainy Launch Card Presentation]

* Redesigned the Rainy model-launch card around `launch.presentation` (gradient, accent, surface, on_surface, muted, aurora animation) with no hardcoded launch colors.
* Replaced technical staged/billing chrome with calm title/summary copy, family model chips (availability on interaction), a single availability message, pricing disclosure, and “Not available yet” / “Continue with current model” CTAs.
* Respects `prefers-reduced-motion` (static gradient), responsive mobile bottom-sheet vs desktop ~480px modal, and keeps catalog-only callable gating.
* Added presentation helpers and visual/component tests for desktop, mobile, reduced-motion, and staged/callable states.
* Verified with `bun test src/lib/rainy-model-launches.test.ts src/features/desktop-shell/components/model-launch-card.test.tsx src/electron/rainy-service.test.ts`.

## Unreleased - 2026.07.10 (1) [Rainy Model Launch Readiness]

* Added non-blocking Rainy model launch feed support for `GET /api/v1/models/launches`, with main-process fetch/cache, IPC/preload/settings-client plumbing, and soft-fail so a missing feed never blocks app startup.
* Added a “new model” launch card (title, summary, variants, staged/available status, pricing note) that shows only unseen launch IDs and persists dismissal per user key (API key prefix or local) and launch ID.
* Gated “Try model” strictly on `/models/catalog`: launch-feed listing alone never makes staged models callable; catalog remains the cloud allowlist client consumers trust.
* Wired launch `app_controls` in the composer: `reasoning` (toggle; request fields only `reasoning`, `reasoning_effort`, `include_reasoning`), `reasoning_pro` (UI-only model-variant selection via declared launch `variants`, never a `reasoning_pro` request param and never blind `-pro` suffix guessing), and `service_tier` (listed values only, including `scale`; Standard omits the field).
* Rendered staged controls as disabled “Coming soon” even when the launch feed is cached; availability stays `staged` vs `available` from the feed, not flipped client-side by cache.
* Surfaced GPT-5.6 high-context pricing notice (base pricing changes above ~272K **input/prompt tokens**); never estimates from message or prompt count.
* Preserved provider-returned effective service tier for UI/billing display (Rainy response/meta first, then nested provider chat metadata `service_tier`); requested tier remains on run artifacts.
* Kept existing model selection, aliases, chat/run options, and billing display behavior intact while extending tier/reasoning request serialization safely.
* Added focused tests for feed parsing, dismissal persistence, staged catalog gating, declared Pro variant mapping (including “no guessed `-pro` for arbitrary model IDs”), reasoning serialization, service-tier serialization, effective-tier preference, and no unknown parameters.
* Verified with `bun test src/lib/rainy-model-launches.test.ts src/electron/rainy-service.test.ts` (43 pass), `bun run typecheck`, and `bun run lint`.

## v0.1.1 - 2026.07.05 [Ambient Safety and Active Gate]

* Changed Ship Status from always-on warning into contextual Ambient Safety and Active Gate flows, making MaTE X calm during normal work and strict before commit/push/ship.
* Reworked Ship Status from repeated internal readiness cards into a single decision-first cockpit with progressive review/details/advanced views.
* Appended contextual action buttons ("Run safety check", "Review changes") directly in the message stream below ambient repo safety notes for a lightweight inline experience without triggering a large warning card.
* Renamed the ambiguous "Low" badge in Review Queue to "Low risk" to prevent conflict with the "Needs check" state.
* Added Trust Gate verdicts for AI-made changes, showing whether the current workspace is trusted, needs validation, risky, blocked, or not proven.
* Added the "Make it trustworthy" flow using existing repo intelligence, validation planning, proof generation, policy stops, Privacy Firewall, Agent Trace, and VTS signals.
* Reframed Evidence Pack as user-facing Ship Proof and receipts in casual UI while preserving Evidence Pack naming for compliance exports and disk artifacts.
* Refined Trust Gate UX from internal telemetry into a plain-language ship/readiness verdict with progressive details.
* Strengthened honest states for missing validation, risky touched surfaces, unresolved policy stops, stale local diffs, weak proof, and unsupported release/readiness claims.
* Fixed casual active runs so prompts like "hello" stay in Ambient Safety instead of opening the large Active Gate.
* Hardened Ambient Safety contextual actions so "Run safety check" and "Review changes" submit through the canonical composer path, preserve safety/review runbook intent, create normal chat turns, guard double clicks, disable while runs are active, and surface visible failures.
* Unified the topbar safety default with the canonical gate state so it starts at Needs check and never implies Clean before proof arrives.
* Strengthened commit, push, and Commit & push interception so unvalidated actions fail closed and open the Active Gate before Git writes continue.
* Restored explicit `sandbox_run` direct mode while preserving the policy stop that requires approval before direct workspace execution.
* Polished conversational intent so casual prompts stay calm while repo safety gates remain strict for audit, validation, commit, push, and ship intent.
* Implemented Work Engine verdict cleanup so partial and unvalidated states correctly show 'Needs check' instead of incorrectly surfacing 'Ready'.
* Removed verbose machine-room output like Work Engine verdicts, primary targets, and validation plans from casual chat responses, preserving them only for full Active Gate audits.
* Hardened Repo Health for v0.1.1 by making package-manager detection evidence-based across `packageManager`, `devEngines.packageManager`, Bun, pnpm, Yarn, and npm lockfiles; surfacing conflicting package-manager evidence; adding Build and Types signals; and replacing vague weak verdict copy with specific missing-signal detail.
* Added Factory Mode Lite as a structured engineering run flow across Chat, Review, Factory, and Ship modes, with Factory/Ship attaching visible Spec, Repo context, Risk surfaces, Validation plan, Agent actions, Verification result, Ratchet suggestions, and Ship Proof stages.
* Hardened Factory/Ship behavior so approval-required access is enforced in both renderer submission and main-process option normalization, Ship uses the proof-producing verification runbook, and direct renderer or IPC input cannot silently escalate Factory/Ship to full access.
* Tightened FactoryRun truthfulness so missing validation, missing repo-context evidence, missing risk-surface evidence, and fake proof remain visible as missing or blocked instead of surfacing trusted, ready, or validated states.
* Updated the blocked Git flow so unproven commit/push attempts show "Blocked because this change has no proof yet." with the "Run Factory verification" CTA, and that CTA now starts a Factory verification run instead of a generic safety check.
* Added approval-gated ratchet rule suggestions for repeated command/tool/package-manager/workspace failures without auto-writing repo rules.
* Cleaned v0.1.1 release lint polish by removing unused Factory-adjacent UI symbols in composer, message stream, home, and settings surfaces, keeping lint at zero warnings without changing Factory/Ship behavior.
* Verified with `~/.bun/bin/bun test src/lib/factory-run.test.ts src/features/desktop-shell/components/git-safety.test.ts src/store/chat-store.test.ts src/electron/assistant-runbooks.test.ts`, `~/.bun/bin/bun run typecheck`, and `~/.bun/bin/bun run lint`.

## Unreleased - 2026.07.05 (3) [Efficient Repo Semantic Memory]

* Reworked RepoGraph embeddings to use change-gated indexing with per-file index state, incremental embedding upserts, stale embedding cleanup, and no full workspace embedding wipe on refresh.
* Added compact semantic profiles for indexed files, covering role, runtime, symbols, imports, IPC channels, env vars, dependencies, trust boundaries, risk tags, confidence, and summary.
* Added agent-facing semantic memory operations for semantic search, file semantic profiles, architecture summaries, and change detection across the RepoGraph IPC, preload, contract, and tool surfaces.
* Strengthened agent system prompt and `repo_graph` tool guidance so agents use semantic memory before broad file reads, reducing token and API usage while keeping graph results separate from proof.
* Verified with `~/.bun/bin/bun run typecheck`; lint is currently blocked by local ESLint/TypeScript package resolution error `ERR_PACKAGE_PATH_NOT_EXPORTED` before source diagnostics.

## Unreleased - 2026.07.05 (2) [Evidence Panel Confidence and Bun Health]

* Reworked the Live Enhancement Panel into a thinner container with dedicated header/tab chrome and clearer Evidence and Repo Health cards, keeping the compact side-panel shell intact.
* Changed Evidence confidence rendering so incomplete or signal-less packs show `Pending` / `Needs evidence` instead of misleading numeric low scores such as `18/100`.
* Fixed workspace health package-manager detection to respect `packageManager` and lockfile evidence, including `bun.lock`, and to avoid inventing `npm run ...` validation commands when the manager is unknown.
* Anchored Repo Health display to the active workspace name, path, and branch so health signals are visibly scoped to the current repo.
* Added focused coverage for Bun/unknown package-manager detection and Evidence confidence score gating.
* Verified with `~/.bun/bin/bun run lint`, `~/.bun/bin/bun run typecheck`, and `~/.bun/bin/bun test src/electron/repo-service/workspace-health.test.ts src/features/desktop-shell/components/enhancement-panel-utils.test.ts` (all clean).

## Unreleased - 2026.07.05 (1) [Live Repo Health Profile]

* Reworked the Live Enhancement Panel Repo Health system so it uses real workspace health data instead of placeholder-style fallback cells for tests, lint, secrets, and profile state.
* Added main-process workspace health profiling from actual git status, workspace file inventory, `package.json` scripts, package manager lockfiles, detected stack, test runner signals, secret-risk filenames, dependency warnings, and dirty-state evidence.
* Extracted the health-profile builder into `src/electron/repo-service/workspace-health.ts` so `workspace.ts` stays focused on workspace summary orchestration and the health system can grow with future detectors.
* Updated Repo Health panel copy and signal mapping to separate real workspace metadata from generated health profiles, avoiding fake scan claims when profile data is absent.
* Verified with `~/.bun/bin/bun run lint` and `~/.bun/bin/bun run typecheck` (both clean).

## Unreleased - 2026.07.04 (3) [Trust Stabilization]

* Aligned product metadata and legal fields with the MaTE X OpenCore model by replacing the generic desktop-shell package description, removing the incorrect MIT package licence claim, and matching the licensed work name to the secure local-repository agent positioning.
* Restored green quality gates by fixing the mobile bridge empty-interface lint error, adding typed `ScrollArea` behavior props, narrowing the sidebar trigger prop surface, and asserting semantic context before test property reads.
* Removed unsafe active-workspace fallbacks from workspace snapshots, RepoGraph loading, IPC active workspace path resolution, and Git service construction so repository operations fail closed instead of silently targeting `workspaces[0]` or the launch directory.
* Hardened RepoGraph embedding privacy by sending metadata-only content for `.env` and sensitive path names, locally redacting secret-bearing lines and PEM blocks before any embedding request, and adding focused coverage for env omission and token redaction.
* Made assistant autonomy safer by defaulting run options to approval-required access, preserving explicit trusted `full` access only when supplied, validating IPC access values, and preventing renderer runs from silently escalating based on trust contract state.
* Tightened Mobile Companion safety by enforcing `canRunAssistant` and `canResolvePolicyStops` in command routing, keeping mobile assistant runs approval-only, preserving fail-closed Git write/push behavior, and enforcing private-LAN host selection when enabled.
* Verified with `~/.bun/bin/bun run lint` and `~/.bun/bin/bun run typecheck` (both clean), plus focused tests for RepoGraph embedding privacy, assistant access defaults, and Mobile Companion private-LAN detection.

## Unreleased - 2026.07.04 (2) [Mission Cockpit and Semantic Working Set]

* Reworked the empty workspace start state into a mission cockpit that makes the core MaTE X workflow immediate: open repo, map risk, run focused audit, verify, and preserve evidence.
* Updated quick prompts around high-signal security work: audit repo, triage risk, verify fix, and export evidence, with explicit runtime-surface, proof, confidence, verification, and noise-exclusion expectations.
* Added Working Set compiler v2 semantic context for runtime surfaces, trust boundaries, source roles, dependency signals, and excluded-noise policy so agent runs start with compact repo intelligence instead of generic chat context.
* Added a pure semantic-context helper plus focused unit coverage for classifying active runtime code, docs/reference signals, tests, dependency signals, and trust boundaries.
* Added sandbox report power-policy visibility documenting the idle-light default and explicit keep-awake behavior for long or interactive validations.
* Verified targeted semantic-context test and touched-file ESLint clean. Full `~/.bun/bin/bun run lint` remains blocked by pre-existing `src/contracts/mobile-bridge.ts` empty-interface lint error; full `~/.bun/bin/bun run typecheck` remains blocked by pre-existing UI primitive type errors in `src/components/ui/*`.

## Unreleased - 2026.07.04 (1) [Frontier Foundations]

* Added shared frontier contracts for performance metrics, benchmark snapshots, power run policy, agent firewall decisions, threat graph nodes/edges, and Evidence Pack v2 metadata.
* Added `powerMode` and `agentFirewallMode` app settings with defaults and Turso normalization so new settings persist safely without being dropped or overwritten.
* Added IPC/preload surfaces for `perf:get-snapshot`, `perf:run-benchmark`, `repo:get-threat-graph`, `agent-firewall:list-decisions`, and `agent-firewall:evaluate-command`.
* Added a lightweight threat graph snapshot built from existing RepoGraph entrypoint, IPC, env, and dependency surfaces with source-role classification for active/test/docs/generated paths.
* Added a benchmark snapshot path that records main-process uptime, memory, warm threat-graph timing, and the resolved power policy.
* Added an agent command risk classifier that flags remote fetch/script execution, DNS payload lookup, package lifecycle install risk, destructive filesystem commands, and secret-bearing command patterns.
* Verified `git diff --check` clean. `~/.bun/bin/bun run lint` remains blocked by a pre-existing `src/contracts/mobile-bridge.ts` empty-interface lint error. `~/.bun/bin/bun run typecheck` remains blocked by pre-existing UI primitive type errors in `src/components/ui/*` around unsupported `ScrollAreaRootProps` props and `TooltipTriggerState`.

## Unreleased - 2026.07.03 (4) [Secure Mobile Companion Bridge Foundation]

* Added the desktop-side Mobile Companion bridge foundation with a main-process-only local WebSocket service, QR pairing payloads, one-time pairing secrets, pairing expiry, replay protection, rate limiting, scoped command routing, and audit logging that avoids storing secrets or raw prompts.
* Added shared mobile bridge contracts for pairing state, bridge status, device sessions, permissions, command envelopes, assistant run requests, progress events, workspace summaries, policy approvals, and read-only Git summaries.
* Added IPC/preload support under `window.mate.mobile` for starting/stopping pairing, reading bridge status, listing/revoking devices, and approving pending pairings from the desktop UI.
* Added Settings > Connections controls for enabling Mobile Companion, requiring desktop approval, session TTL, LAN-only mode, and future typed Git write/push permissions while keeping write commands blocked.
* Routed mobile assistant runs through the existing `runAssistant` pipeline with `access: "approval"` so WorkPlan, Privacy Preflight, Trust Contract, Policy Stops, evidence generation, and existing progress semantics remain authoritative.
* Fixed the approval-required pairing path so an approved mobile device receives its session over the original waiting WebSocket instead of requiring a second scan.
* Verified the mobile companion app first-connection path with `bun run typecheck` and `expo export --platform android --clear` in `/Users/fer/Projects/mate-x-app`. Desktop `~/.bun/bin/bun run typecheck` remains blocked by pre-existing UI primitive type errors in `src/components/ui/*` around unsupported `ScrollAreaRootProps` props and `TooltipTriggerState`.

## Unreleased - 2026.07.03 (3) [Repo Health Real Context]

* Reworked the Live Enhancement Panel Repo Health card so it no longer stays in a misleading `Workspace profile loading` state when no full health profile exists.
* Wired Repo Health to the real `WorkspaceSummary` passed from the desktop shell, allowing the card to show actual workspace status, branch, and detected stack even before test, lint, secret, or dependency health scans are available.
* Updated missing-profile copy to explicitly say the full health profile is unavailable and that unavailable test/lint/secret signals are not being claimed as scanned results.
* Verified with `~/.bun/bin/bun run lint` (clean). `~/.bun/bin/bun run typecheck` remains blocked by pre-existing UI type errors in `src/components/ui/*` around `ScrollAreaRootProps` and `TooltipTriggerState`.

## Unreleased - 2026.07.03 (2) [Evidence Pack Metric Transparency]

* Updated the Live Enhancement Panel Evidence Pack view so file and command metrics come only from the attached `EvidencePack`, preventing local scan fallback data from being presented as verified pack evidence.
* Added a visible score basis row that derives the displayed percentage from `verifiedTaskScore.signals` using satisfied signal weight over total signal weight, plus passed signal count, making low confidence scores such as `18/100` explainable from real runtime data.
* Added an explicit local-scan notice when changed files or possible validation commands exist but no Evidence Pack has been generated yet, keeping scan state separate from attested evidence state.
* Verified with `~/.bun/bin/bun run lint` (clean). `~/.bun/bin/bun run typecheck` remains blocked by pre-existing UI type errors in `src/components/ui/*` around `ScrollAreaRootProps` and `TooltipTriggerState`.

## Unreleased - 2026.07.03 (1) [Agent Trace Reality and Efficiency Upgrade]

* Redesigned the assistant Agent Trace stream to surface real captured `ToolEvent` data instead of noisy runtime phrasing: live/recorded status, real event counts, active/done/issue totals, parsed command rows, policy stops, and compact latest-event rendering now reflect actual run state.
* Updated the side-panel Agent TRACE view into connected `System links` and `Runtime events` sections with real event counters, status-specific icons, and explicit empty states so the panel no longer presents mock-like rows or marks completed events as active.
* Normalized leaked runtime wording such as `await`/`awaiting` into user-facing action language while preserving the underlying event data, keeping trace output faster to scan without inventing timestamps, phases, or fake progress.
* Verified targeted ESLint for `message-stream.tsx` and `enhancement-panel-sections.tsx` (clean). Full typecheck remains blocked by pre-existing unrelated UI type errors in `src/components/ui/*` around `ScrollAreaRootProps` and `TooltipTriggerState`.

## Unreleased - 2026.07.02 (2) [Live Agent Trace Runtime]

* Reworked the enhancement panel Agent Trace into a live runtime summary connected to local git status, RepoGraph impact, validation routes, Evidence Pack state, workspace health, and recent tool events instead of showing raw placeholder-style event rows.
* Updated Trace, Impact, and Repo Health empty/loading states to describe actionable system state (`Local trace active`, `RepoGraph impact scoped`, `Workspace profile loading`) and normalize incoming `awaiting`/`pending` runtime text into active `Resolving`/`Queued` language.
* Preserved the existing app shell and compact panel design while making the trace more useful for real security review workflows: changed paths, downstream fan-out, validation command signals, and attached evidence now surface directly in the panel.
* Verified with `~/.bun/bin/bun run lint` (clean). `~/.bun/bin/bun run typecheck` remains blocked by pre-existing UI type errors in `src/components/ui/*` around `ScrollAreaRootProps` and `TooltipTriggerState`.

## Unreleased - 2026.07.02 (1) [Tool Error Streaming State Clarity]

* Clarified the assistant stream UI when a tool event fails while the run is still active: messages with `error` tool events now show `Recovering after tool error` with an alert icon instead of continuing to present the state as a normal `Thinking process`.
* This makes Workspace Trust Contract read failures, such as blocked access to `.mate-x/config/agent-identity.json`, visibly distinct from ordinary model reasoning while preserving the run's ability to recover and finish.
* Verified with `~/.bun/bin/bun run lint` (clean). `~/.bun/bin/bun run typecheck` remains blocked by pre-existing UI type errors in `src/components/ui/*` around `ScrollAreaRootProps` and `TooltipTriggerState`.

## Unreleased - 2026.06.04 (1) [Evidence Pack Overhaul: Real Grounding, Standalone Access, and Full Verification]

* Performed a thorough end-to-end review of the entire Evidence Pack system (triggered by discovery that it was effectively a placeholder producing fake/useless data that undermined the whole MaTE X app). Reviewed CHANGELOG, contracts, repo-service, evidence-pack.ts, attestation/complianceExport/agentIdentity, tool-executor, VTS, runs-page, IPC/preload, and related compliance flows. Identified root causes: heavy reliance on brittle LLM text parsing for structured fields (verdict, reproduction, stages, checks), layout-biased filesModified extraction (hard-coded "src/" filter + legacy tool names), thin commandsExecuted, low/meaningless VTS for common audit/read-only runs, late synthetic taskId, no first-class standalone access to the .mate-x/evidence tree, and incomplete artifact enrichment in exports.
* **Phase A – Grounded the data in reality (core "not fake" fixes)**:
  * `src/electron/evidence-pack.ts`: Rewrote `extractToolTouchedPaths` to be fully layout-agnostic (no "src/" bias, broadened to current `file_editor`/`auto_patch` + parsedOutput heuristics, defensive repo-path filtering). Made `reproduction`, `stages`, `checks`, and `unresolvedRisks` prefer runtime derivation from `toolExecutions` + events + work engine data before falling back to `extractEvidenceFinalization`. Commands/tests now better reflect security actions.
  * `src/electron/repo-service/agentic-runtime/tool-executor.ts`: Added `enrichParsedForEvidence` post-processing for proof/mutation/validation tools (`file_editor`, `security_path_trace`, `candidate_revalidator`, `sandbox_run`/`run_tests`, `browser_prober`, etc.). Normalizes stable keys (`path`, `status`, `hasStructuredEvidence`, `evidenceType`, `exitCode`, `diffSummary`, etc.) into `parsedOutput`. Error/decline paths now consistent. This data flows to packs, VTS, cards, and sidecars.
  * `src/electron/verified-task-score.ts`: Broadened `patchTools`/`fileInspectionTools`/`proofTools` sets. Added credit for enriched proof signals and reliable `filesModified`. Audit/read-only/proof-heavy runs (no patch) now produce informative `partially_verified` (or better) scores with useful `missingEvidence` instead of near-zero "unverified" or the historic "16/18" trap. Kept resilience wrapper.
  * Demoted LLM heading parsing (in `buildEvidencePack` + `evidence-finalization`) to narrative verdict/recommendation only. Core machine fields now come from real tool/git/runtime evidence.
* **Phase B – Enriched standalone artifacts** (so the on-disk tree and ZIPs are actually useful):
  * `src/features/compliance/attestation.ts`: After privacy gate + Ed25519 signing, now also writes `commands-executed.json`, `files-modified.json`, and `proof-summary.json` (reproduction, stages, checks, VTS, toolsWithEvidence, policyStops, unresolvedRisks). These are added to the in-toto Statement v1 subjects with SHA-256 digests so the attestation covers the full bundle. Sidecars written only in success path (after gate).
  * `src/features/compliance/complianceExport.ts`: Export now always includes the three sidecars (derived from the authoritative pack for consistency) + updates manifest `files` hashes and ZIP entries. `buildComplianceReportPdf` greatly expanded with VTS signals, actual files list, proof/validation steps, stages, reproduction, policy hash + identity, governance notes, and explicit sidecar inventory (still zero-dep hand-rolled PDF 1.4). Manifest/ZIP integrity and blocking logic updated.
  * `src/features/compliance/agentIdentity.ts`: `buildAgentRunbook` + `renderAgentRunbookMarkdown` now surface stages, checks, reproduction, and policyStops as a real execution trace (not just flat lists).
* **Phase C – Made it first-class and standalone** (addressing "no real purpose / can't browse independently"):
  * Stable `taskId` linkage (`src/electron/repo-service.ts`): Now generated early in `runAssistant` and tied to `progressReporter?.runId` (when provided by UI/handler) → `task-${effectiveRunId}`. Makes `.mate-x/evidence/<taskId>` predictable, survives reloads/history, and enables disk-authoritative queries.
  * New main-process IPC surface (`src/electron/ipc-handlers.ts`): `evidence:list-packs` (scans workspace `.mate-x/evidence/*` authoritatively, returns lightweight metadata + attestationStatus), `evidence:get-pack`, `evidence:verify-attestation`, `evidence:export-compliance-zip`. Reuses `loadVerifiedEvidencePackForExport`, `collectRepoSnapshot`, etc. Added `readdir` import and `listLocalEvidencePacks` helper. These work purely from the on-disk tree (the real source of truth).
  * Preload wiring (`src/electron/preload/contracts.ts` + `src/electron/preload/index.ts`): Added `EVIDENCE_LIST`/`GET`/`VERIFY`/`EXPORT_ZIP` constants and exposed `localList`/`get`/`verifyAttestation`/`exportZip` under the existing `evidencePack` bridge (in addition to the prior storage publish paths).
  * Standalone UI (`src/routes/runs-page.tsx`): Added "Browse Evidence Packs (disk)" button in header. On activation: loads list via new IPC (independent of chat threads/runs), renders compact cards with taskId, verdict/score, file count, attestation status + Verify/Export ZIP actions. Selecting shows detail panel (reuses visual language: rounded-2xl, borders, etc.). Fully additive; existing chat-run evidence rendering untouched. Uses `(window as any).mate.evidencePack.*`.
* **Phase D – Tests, compliance, and gates**:
  * Added/extended colocated tests:
    * `src/features/compliance/attestation.test.ts`: New tests for sidecar writing + inclusion in attestation subjects (commands/files/proof-summary with digests), and privacy block (no sidecars on blocked runs; "no raw P0 persisted").
    * `src/features/compliance/complianceExport.test.ts`: Updated manifest expectations to include the three new sidecars; enhanced PDF test for richer Phase B content (Files Modified, Proof & Validation Steps, Sidecar Artifacts, etc.); new test asserting sidecars always appear in ZIP + manifest (even when derived at export time).
  * Privacy Firewall: All sidecar paths respect the existing gate (written only post-scan on allowed packs; export starts from verified load). Tests explicitly cover blocked case.
  * No new shapes added to the core `EvidencePack` contract (sidecars are separate on-disk files; runbook extensions local), so no `turso-service.ts` normalization changes required.
  * Final `bun run lint && bun run typecheck` clean after every slice and at phase end. Specific new tests all pass.
* Preserved every local-first invariant: agentIdentity + deterministic policy hash (from AGENTS.md/RULES.md), Privacy Firewall, in-toto Statement v1 + SLSA provenance + Ed25519, manifest zipDigest + integrity verification, unrestricted governance warnings, SOC 2 control references, etc.
* The Evidence Pack system is now genuinely functional: it captures and surfaces the project's *actual* security review status and work performed (real files changed, real proof steps, real validation/repro outcomes, real traces), produces rich attested artifacts on disk and in ZIPs, and supports standalone browsing/export/verify without requiring the original chat thread. Directly addresses the original report that the feature was "fake and useless" and made the whole app feel pointless.
* Verified with `bun run lint && bun run typecheck` (clean). All phases followed the strict token-budget / read-only-what-you-modify rules.

## Unreleased - 2026.06.02 (2) [Evidence Pack Real Data Grounding and Artifact Enrichment]

* Grounded Evidence Pack data in actual runtime evidence instead of primarily model-authored narrative text (the root cause of "feels fake / always 0 files / low scores / placeholder").
  * `src/electron/evidence-pack.ts`: Rewrote `extractToolTouchedPaths` (now layout-agnostic, no `src/` hard filter, pulls from modern `file_editor`/`auto_patch` + parsedOutput + all plausible repo paths). Commands, filesModified, reproduction, stages, and checks now prefer derivation from `toolExecutions` + `events` + enriched parsed data before falling back to `extractEvidenceFinalization`.
  * `src/electron/repo-service/agentic-runtime/tool-executor.ts`: Added `enrichParsedForEvidence` that normalizes proof/mutation/validation results (`file_editor`, `security_path_trace`, `candidate_revalidator`, `sandbox_run`/`run_tests`, `browser_prober`, etc.) into stable `parsedOutput` keys (`path`, `status`, `hasStructuredEvidence`, `evidenceType`, `exitCode`, etc.). This data flows directly into packs, VTS, cards, and sidecars.
  * `src/electron/verified-task-score.ts`: Broadened tool sets, added credit for proof signals and the now-reliable `filesModified`. Audit/read-only/proof-heavy runs (no patch this session) produce informative `partially_verified` scores with useful missing-evidence lists instead of near-zero "unverified".
* Phase B artifact enrichment (makes the on-disk `.mate-x/evidence/<taskId>/` tree and exported ZIPs first-class standalone compliance deliverables):
  * `src/features/compliance/attestation.ts`: At evidence write time (after privacy gate + signing), now also writes `commands-executed.json`, `files-modified.json`, and `proof-summary.json` (reproduction, stages, checks, VTS, toolsWithEvidence, policyStops). These are added to the in-toto Statement subjects with SHA-256 so the attestation covers the full bundle.
  * `src/features/compliance/complianceExport.ts`: Export always includes the three sidecars (derived from the authoritative in-memory pack for consistency). `buildComplianceReportPdf` now emits a much richer report (VTS signals, actual files list, proof steps, stages, reproduction, policy hash, identity, explicit sidecar inventory) while still using the zero-dep hand-rolled PDF generator.
  * `src/features/compliance/agentIdentity.ts`: `buildAgentRunbook` + `renderAgentRunbookMarkdown` now surface stages, checks, reproduction, and policyStops as a real execution trace (not just flat lists).
  * Manifest, ZIP entries, and integrity checks updated to cover the new sidecars. Unrestricted governance warnings and blocking reasons preserved.
* All changes preserve local-first invariants, Privacy Firewall gating, agentIdentity + deterministic policy hash (from AGENTS.md / RULES.md), and Ed25519 in-toto/SLSA attestations.
* Verified after each slice and at phase end: `bun run lint && bun run typecheck` clean.
* This directly addresses the reported bug that the Evidence Pack system (and thus the whole app) felt useless because packs contained no real project status or proof artifacts.

## Unreleased - 2026.06.02 (1) [Evidence Pack Scoping, Scoring, and Agent Loop Stability]

* Fixed artifacts (`.matex/evidence` internal storage + `.mate-x/evidence/<taskId>` compliance packs) being created inside the MaTE X source tree (`Projects/mate-x`) or wrong launch dir instead of the user-selected target repository. Root causes: `process.cwd()` in `main-stack.ts:initStack` (for the SDK files client / EvidencePackStorage), `sdk-orchestrator` VTS wrapper, `repo-graph-service` auto-seed, `resolveWorkspace` / `resolveActiveWorkspace*` silent `[0]` fallbacks, and `repo:run-assistant` never forwarding workspace context.
  * Made `resolveWorkspace` (used by `collectRepoSnapshot` / runs / evidence) and `resolveActiveWorkspace` (ipc, memory, git, compliance) strict: require explicit active or provided id; clear actionable errors instead of falling back to launch cwd.
  * Removed `ensureSeedWorkspace(process.cwd())` auto-injection.
  * Switched the global MaTeX stack storage root (`.matex`) from `resolve(process.cwd(), ...)` to safe `app.getPath('userData')/matex-storage/...` (portable per-workspace `.mate-x` evidence inside targets remains the source of truth for compliance artifacts, attestations, and ZIPs).
  * Forward optional `workspaceId` through the run-assistant IPC; all evidence/attestation/compliance paths now consistently target the active/selected workspace.
* Hardened Rainy agentic loops (chat-runner, responses-runner) and synthesis/critic paths against repetitive output and "re-runs the same task" producing strange parroted responses on failure/low-signal: added `appendAssistantPass` + repetition heuristic (skips full re-append when head overlaps prior accumulation), pruned obvious fallback/partial history entries in `buildHistoryMessages`, shortened synthesis prompts to "concise delta" + "reference by id, do not repeat", truncated verbatim draft in `buildCriticRevisionPrompt`.
* Made Evidence Pack scoring accurate and resilient for real security review workloads on arbitrary repos (the source of "always 16 or 18 out of 100" and "working terribly"):
  * Generalized `extractInspectedPaths` (and filter) beyond hard-coded `startsWith("src/")` + exact tool names; now credits any read/grep/search/file tool that produces path-like strings. "relevant_files_inspected" / "target_files_identified" now fire on typical layouts (app/, lib/, packages/, root files, etc.).
  * Relaxed `hasFailedRun` (and thus forced "failed" status) to only hard blocker evidenceStatus; failed validations affect only their signal (numeric score) rather than nuking the whole verdict for diagnostic runs.
  * Defensive `pathExists` (try/catch) so bad workspacePath or claims from partial runs no longer crash scoring/pack generation.
  * Internal VTS wrapper in SDK orchestrator now accepts real workspacePath and derives best-effort `filesModified` from events (benefits from the above).
  * Wrapped `computeVerifiedTaskScore` (and reproduction/verdict paths) inside `buildEvidencePack` and key finalization in `repo-service` so partial runs always produce a usable (if low-scoring + warned) EvidencePack written to the correct `.mate-x` tree; compliance exports no longer hard-crash on scope edges (structured handling + best-effort).
* All changes preserve local-first compliance invariants (agentIdentity, policy hashes from AGENTS.md/RULES.md, Privacy Firewall, in-toto attestations, manifest digests). Only the plan-listed files were modified.
* Verified: `bun run lint && bun run typecheck` clean after each phase.

## v0.1.0 - 2026.06.01 [First Stable Release]

* Released MaTE X `v0.1.0` as the first stable release baseline for the storage, Evidence Pack publishing, Failure Memory sync, SDK orchestration, and typed configuration stack.
* Added `MaTeXStorageAdapter` as the unified `files-sdk` boundary for S3, R2, GCS, Azure, Supabase, Vercel Blob, and local storage backends with Privacy Sentinel pre-upload scanning, Evidence Pack storage events, Failure Memory recording, Agent Profiler timing, rate-limit enforcement, and high-impact approval gates for destructive operations.
* Added `EvidencePackStorage` to publish completed Evidence Packs through the storage adapter after SHA-256 manifest verification and Ed25519 attestation validation, returning canonical publication metadata and a curl plus openssl verification command.
* Added `FailureMemorySync` with delta-only remote sync, newest-timestamp conflict resolution, configurable sync intervals, record caps, portable workspace ZIP export/import, and a stoppable timer for leak-free tests.
* Added `SDKOrchestrator` for Codex, Cursor, and Antigravity clients with Privacy Sentinel as the first check, high-impact human confirmation, Evidence Pack action events, canonical Failure Memory signatures, Critic Loop retries, VTS scoring, timeout handling, capability profiling, and routing recommendations.
* Added the `mate-x.config.json` Zod schema and loader with typed defaults, full-field validation errors, and `createMaTeXStack` wiring for storage, Evidence Pack publishing, Failure Memory sync, and SDK orchestration.
* Integrated the v0.1.0 service layer into the Electron architecture by moving runtime services under `src/electron`, moving shared service contracts under `src/contracts`, adding the MaTE X main-process stack singleton, adding sanitized Zod-validated IPC handlers, exposing a scoped `mateX` preload bridge, and redacting storage credentials from renderer-facing config responses.
* Reworked the Electron service integration to use MaTE X runtime systems instead of placeholder memory logs: SDK orchestration now injects into assistant runs through `runAssistant()` via typed `sdkAction`, SDK evidence events are appended to the real tool event stream consumed by `buildEvidencePack()`, SDK failures call the persistent `failureMemoryEngine`, high-impact SDK/storage actions create real `policyService` approval stops, and Electron IPC exposes `mate-x:*` orchestration/storage channels through the existing handler registry.
* Hardened the Electron SDK orchestration bridge with typed missing-client failures, safe IPC responses for unconfigured Codex/Cursor/Antigravity clients, real `computeVerifiedTaskScore()` VTS scoring from SDK `tool_execution_events`, critic-loop integration coverage, and Bun-compatible Electron SDK pipeline tests.
* Migrated package scripts and colocated test imports toward Bun-first execution with `bun test`, `bunx tsc --noEmit`, and `bunx eslint src/` as the canonical commands.
* Added focused unit coverage for all five modules, including privacy blocks, wrapped storage errors, integrity failures, delta sync limits, high-impact approval, Critic Loop exhaustion, routing updates, and config validation.
* Verified the `v0.1.0` launch run with `npm exec -- tsc --noEmit` and `npm exec -- tsx --test src/storage/adapter.test.ts src/storage/evidence-pack-storage.test.ts src/storage/failure-memory-sync.test.ts src/orchestration/sdk-orchestrator.test.ts src/config/mate-x.config.test.ts`; final result: 33/33 tests passed.

## Unreleased - 2026.06.01 (1) [Global Distribution Runtime Hardening]

* Hardened `fuzzer` execution with a 120-second hard timeout, active request abort cleanup, an eight-request concurrency cap, and bounded response/output handling with truncation signaling.
* Restricted `traffic_poison` to DNS-confirmed loopback targets, added high-risk `TRAFFIC_POISON_EXECUTION` approval stops outside unrestricted trust mode, and applied 30-second request timeouts.
* Restricted `mock_poison` servers to `127.0.0.1`, added high-risk `MOCK_POISON_EXECUTION` approval stops, capped concurrent servers at two, and added automatic five-minute lifetime cleanup.
* Rate-limited Failure Memory writes per workspace for `record_failure` and `record_resolution`, added silent no-op behavior when limited, and evicted the oldest 50 records when a workspace reaches 500 failure records.
* Made Agent Capability Profiler writes fire-and-forget with 500ms debounce and debug-only error handling so metrics persistence no longer blocks the agent completion path.
* Added disabled-by-default Codex, Antigravity, and Cursor integration settings with a preferred-agent selector so external agent routing remains user-controlled.
* Added a safe app-scoped `mate-x.config.json` fallback with orchestration auto-routing disabled so Electron startup no longer fails when the local config file is absent and arbitrary reviewed repositories are not used as the global runtime config location.
* Added `credentialsEnv` and `$ENV_VAR` credential references for `mate-x.config.json`, resolving storage credentials in the main process while preserving empty credentials when none are configured.
* Added `credentialsSecureKey` support for native encrypted storage credentials and rejected inline storage credential values in `mate-x.config.json`.
* Added best-effort Privacy Sentinel scanning of raw `mate-x.config.json` content before parsing so hardcoded P0 or secret-like config values block loading with a visible `CONFIG_SECRET_DETECTED` error.
* Redacted both storage `credentials` and `credentialsEnv` from renderer-facing config IPC responses so env variable names and resolved values never cross into the renderer.
* Repaired MaTE X stack startup by using a filesystem-backed local storage client instead of the invalid `files-sdk/local` subpath and removing duplicate `mate-x:*` IPC handler registration.
* Removed the pre-existing unused `tint` declaration in the desktop sidebar so production ESLint now reports zero warnings.
* Removed remaining unused imports and stale lint suppressions in Electron storage, orchestration, and sandbox test files so source ESLint now runs cleanly.
* Verified with `node_modules/.bin/tsc --noEmit` and `node_modules/.bin/eslint src --ext .ts,.tsx`.

## Unreleased - 2026.05.31 (2) [Tool Runtime Regression Fixes]

* Guarded `browser_prober` BrowserWindow destruction across timeout, navigation failure, and cleanup paths so already-destroyed windows no longer crash the main process.
* Fixed `local_network_recon` loopback validation to accept IPv6 localhost (`::1`) alongside IPv4 `127.0.0.0/8` targets.
* Verified with `node_modules/.bin/tsc --noEmit` and `node_modules/.bin/eslint src --ext .ts,.tsx`; eslint reports only the pre-existing `app-sidebar.tsx` unused `tint` warning.

## Unreleased - 2026.05.31 (1) [Outbound Tool Guards and Governance Export Markers]

* Added shared in-memory rate limiting for `creds_validator` and `oob_listener`, including per-service circuit breakers for external credential validation calls and a concurrent listener cap for ephemeral OOB servers.
* Added Evidence Pack and compliance export governance markers so unrestricted sessions are visible in `evidence-pack.json`, `manifest.json`, `audit-log.json`, `compliance-report.pdf`, and the Evidence Pack card UI.
* Verified with `node_modules/.bin/tsc --noEmit` and `node_modules/.bin/eslint src --ext .ts,.tsx`; eslint reports only the pre-existing `app-sidebar.tsx` unused `tint` warning.

## Unreleased - 2026.05.30 (3) [Production Architecture Hardening]

* Added compliance ZIP delivery integrity verification by storing the generation-time digest, re-hashing the delivered ZIP before IPC return, and failing closed with `COMPLIANCE_ZIP_INTEGRITY_FAILURE` on mismatch.
* Added `zipDigest` to compliance ZIP manifests so external auditors can independently verify the generated package.
* Changed `allowHighImpact: true` handling in `file_editor` and `auto_patch` to require an explicit `HIGH_IMPACT_PATCH_APPROVAL` policy stop outside unrestricted trust mode, returning `USER_DECLINED_HIGH_IMPACT_PATCH` when declined.
* Hardened `mutation` execution with per-workspace serialization, five-minute process-tree timeout handling, snapshot-based file restoration, `MUTATION_EXECUTION` approval stops, and execution metrics.
* Verified with `node_modules/.bin/tsc --noEmit` and `node_modules/.bin/eslint src --ext .ts,.tsx`; eslint reports only the pre-existing `app-sidebar.tsx` unused `tint` warning.

## Unreleased - 2026.05.30 (2) [Premium Liquid Glass Select]

* Resolved the solid black appearance of the Select popup by restoring the `Html` backdrop layer (`bg-[image:var(--mate-shell-base)]` at `zIndex={-2}`) to provide refraction source pixels for WebGL.
* Calibrated the glass container's blur to `blur={90}` to beautifully diffuse the dark background midnight gradients, preventing flat solid blocks and creating a pristine transparent frosted look.
* Set physical glass edge depth parameters to `bezelWidth={100}`, `thickness={15}`, and `displacementBlur={18}` to ensure delicate, realistic 3D glass edge refraction without heavy dark outlines.
* Calibrated `specularOpacity={0.16}` and `specularFalloff={1.2}` to render an elegant, high-end light sheen that feels premium and matches the Composer panel.
* Refined the CSS fallback layer to a lightweight border (`border border-white/6`) and translucent background (`bg-transparent backdrop-blur-xl`).
* Designed premium select items styling in the glass list to act as individual frosted glass segments with a flat, semi-transparent background overlay (`bg-white/8` on hover and `bg-white/12` on active selection) without any harsh inner shadows.
* Enhanced the `InlineSelect` trigger in the composer dynamically with a semi-transparent glass segment look when `liquidGlass` is active to unify the visual experience.
* Resolved workspace ESLint `no-useless-assignment` warning in `src/electron/tools/mutation.ts` to ensure overall code quality.

## Unreleased - 2026.05.30 (1) [Launch Security Patchset]

* Blocked renderer-supplied compliance Evidence Packs by requiring `{ taskId }`, loading Evidence Packs and attestations from `.mate-x/evidence/<taskId>`, verifying signed digests, and re-running Privacy Firewall checks before export.
* Bound Work Engine security proof to specific final claims so confirmed vulnerability wording is downgraded when no matching `security_path_trace` or `candidate_revalidator` evidence references the claimed path.
* Hardened `sandbox_run` policy classification for argv-form package-manager and network commands, and made `file_editor` commits atomic via same-directory temp files, `fsync`, and rename.
* Replaced permissive `privacy:scan-text` IPC coercion with strict string and size validation.
* Verified with `node_modules/.bin/tsc --noEmit` and source-only `node_modules/.bin/eslint src --ext .ts,.tsx`; `bun run typecheck` could not run because `bun` is unavailable in this shell.

## Unreleased - 2026.05.29 (1) [Enterprise Hardening Controls]

* Hardened renderer-to-main IPC validation for assistant runs, workspace trust contracts, Git file lists, settings updates, policy-stop resolution, compliance exports, repo graph inputs, and workspace memory payloads.
* Replaced renderer access to raw Rainy API keys with non-secret API key status metadata while preserving main-process-only credential storage and updates.
* Made SOC 2 procurement exports tamper-resistant by sanitizing task IDs, constraining attestation reads to `.mate-x/evidence/<taskId>`, exposing export status/blocking reasons, and blocking procurement-ready delivery when trusted signed evidence is missing.
* Strengthened Privacy Firewall outbound behavior so managed Rainy sends fail closed when settings or scanner coverage are unavailable, while keeping local debug scans redacted and non-persistent.
* Defaulted `sandbox_run` to isolated workspace copies and added policy stops for direct workspace execution, long-running commands, network-capable commands, and package-manager mutations.
* Verified with `pnpm exec tsc --noEmit` and `git diff --check`; `pnpm run lint` was blocked by missing `eslint-plugin-react-hooks` in `demos/editor/eslint.config.js`, and focused tests could not run because `bun` and `tsx` were unavailable in this shell.

## Unreleased - 2026.05.27 (1) [Native Blur Sidebar Effect]

* Refactored the app sidebar WebGL glass render to deliver a powerful, premium native-looking dark blur effect matching Apple Design standards.
* Replaced the washed-out white tint and colorful CSS/canvas blend gradients with the high-contrast dark specular, concave surface profile, and concave bevel spread of the design prototype.
* Automatically handles theme changes to present a beautiful glassy blur for both light and dark modes.

## Unreleased - 2026.05.24 (1) [Privacy Sentinel Placeholder Awareness]

* Taught the agent runtime and system prompt that Privacy Sentinel typed placeholders such as `[WORKSPACE_IDENTITY]`, `[PRIVATE_FILE_PATH]`, `[INTERNAL_URL]`, `[PRIVATE_EMAIL]`, `[CUSTOMER_DATA]`, and `[SECRET_*]` are outbound redaction tokens, not literal repository facts.
* Hardened Work Engine finalization so security conclusions that treat Privacy Sentinel placeholders as raw source evidence are downgraded to `partial`, warned, and rewritten toward raw-source verification.
* Added regression coverage for placeholder misuse alongside the existing finalizer, Preventive Guard, trust-contract, and Privacy Sentinel scanner tests.
* Verified with `bun run typecheck`, `bun run lint`, and `bun test src/electron/work-engine/finalizer.test.ts src/electron/work-engine/stages.test.ts src/electron/workspace-trust.test.ts src/electron/privacy/privacy-regex-scanner.test.ts`.

## Unreleased - 2026.05.23 (2) [Preventive Guard and Agentic Evidence Hardening]

* Added Preventive Guard V1 to the Work Engine with preventive risk classification, recommended controls, warning-only validation/proof stages, sanitized run artifacts, and model prompt guidance that keeps Privacy Sentinel as the outbound-context gate.
* Hardened Workspace Trust Contract handling for local compliance artifacts by allowing `.mate-x/evidence` reads for default and normalized scoped contracts.
* Fixed agent tool routing and search resilience by registering the `security_audit` alias and making `rg` skip missing scoped paths such as absent `.mate-x/evidence` directories instead of hard-failing.
* Added Rainy timeout recovery for chat-completions agent loops so `APIConnectionTimeoutError` returns a partial repo-grounded result through the Work Engine instead of crashing the run.
* Strengthened Work Engine finalization so candidate-level security reviews without proof remain warning-only, strong auth/security claims require proof, duplicate verdicts are replaced, preparatory-only answers are rejected or downgraded, and tool-backed security workflows cannot report success with zero repository tool evidence.
* Updated agent runtime/system guidance to require `candidate_revalidator` or `security_path_trace` before strong auth, token, session, rate-limit, Redis revocation, availability, exploitability, or severity claims.
* Added focused tests for Preventive Guard stages, evidence-path trust normalization, finalizer verdict calibration, proof-required wording downgrades, duplicate verdict cleanup, and preparatory-answer detection.
* Verified with `bun run typecheck`, `bun run lint`, `bun test src/electron/work-engine/finalizer.test.ts src/electron/work-engine/stages.test.ts src/electron/workspace-trust.test.ts`, plus smoke checks for `security_audit` registration and missing-path `rg` behavior.

## Unreleased - 2026.05.23 (1) [Native Clipboard Copy Integration]

* Implemented a secure, native clipboard writing functionality in the Electron main process via a new `ui:copy-to-clipboard` IPC handler.
* Exposed `copyToClipboard` in the preload script's `UiApi` context bridge.
* Replaced standard browser `navigator.clipboard.writeText` calls with the new native API in `MessageStream`, `ChatMarkdown` code blocks, and error toasts to bypass Chrome secure-context restrictions on `file://` protocols.
* Verified all changes successfully compile with `bun run typecheck` and `bun run lint`.

## Unreleased - 2026.05.22 (1) [Precise File Editing Operations]

* Expanded `file_editor` from line-range replacement into a precise workspace editor with create, overwrite, append, insert-before, insert-after, delete-range, replace-range, and exact block replacement operations.
* Preserved backward-compatible line-range calls while adding stronger guards for whole-file, range, and create-if-missing workflows.
* Verified with `bun run typecheck` and `bun run lint`.

## Unreleased - 2026.05.21 (1) [Rainy Service Tiers]

* Added Rainy API v3.5 service-tier support for model metadata, including generic `pricing.service_tiers` detection without provider-specific model IDs.
* Added optional Standard/Flex/Priority selection in the composer for tiered models, hidden for non-tiered models and reset to Standard when switching to an incompatible model.
* Threaded non-default service tiers through Chat Completions, Responses, streaming, final synthesis, and critic-loop Rainy request paths while omitting `service_tier` for Standard/default.
* Fixed service-tier detection for keyed tier metadata, preserved `reasoning_details` on assistant messages so follow-up calls can continue reasoning, and added a non-stream retry when a streamed Chat Completions request fails before returning content.
* Added focused tests for tier visibility, keyed tier metadata, default omission, Flex/Priority request payloads, invalid tier reset behavior, reasoning details passthrough, and unchanged non-tiered requests.
* Verified with `bun run typecheck`, `bun run lint`, and `bunx vitest run src/electron/rainy-service.test.ts -t "service tier|service_tier|Flex|Priority|non-tiered|tiered"`.

## Unreleased - 2026.05.20 (2) [Tool Service Modularization]

* Split `tool-service.ts` into focused modules for shared tool types, lazy tool registration, policy-governed descriptions, and schema validation.
* Kept `ToolService` focused on tool loading, definition caching, trust checks, and execution orchestration.
* Verified with `bun run typecheck` and `bun run lint`.

## Unreleased - 2026.05.20 (1) [Agent Tool Performance and Search Guidance]

* Optimized tool definition startup by deduplicating concurrent lazy tool imports and in-flight chat/responses tool definition builds.
* Expanded `rg` into a faster guided search tool with multi-path search, context lines, result/output caps, max-file-size skipping, hidden-file control, stable path sorting, smart-case matching, workspace path validation, and generated-output exclusions.
* Updated the agent system prompt to prefer scoped `rg` searches and `read_many` follow-up reads so repository investigation uses fewer broad scans and fewer tool round-trips.
* Verified with `bun run typecheck` and `bun run lint`.

## Unreleased - 2026.05.16 (1) [Chat Shell Layout Rebuild]

* Split chat layout ownership into `ChatWorkspace`, `EmptyChatState`, and `ComposerDock` so `HomePage` stays focused on data wiring and `MessageStream` stays stream-focused.
* Moved empty-thread composer centering into a stable grid layout with quick prompt chips below the input.
* Removed the composer scope/footer text from the chat input surface.
* Verified with `bun run lint` and `bun run typecheck`.

## Unreleased - 2026.05.14 (1) [Sidebar Repository Removal Safety]

* Removed public Source Control/Git controls from the app sidebar while keeping Git-backed tools and services available internally.
* Added collapsible project history with a visible thread cap and "Show older" control to reduce sidebar load for large conversation histories.
* Added a destructive confirmation dialog before removing repositories from MaTE X, with copy clarifying that MaTE X database and userData records are deleted while the repository folder remains on disk.
* Expanded repository removal cleanup to clear workspace-memory local data and all known workspace-scoped database rows.
* Fixed a repo graph indexing race where stale watcher/embedding work could write after repository removal and trigger foreign-key constraint failures.
* Verified with `bun run typecheck` and `react-doctor`.

## Unreleased - 2026.05.12 (2) [Tool Process Environment Hardening]

* Added a shared minimal tool process environment for validation and sandbox execution so repository commands receive only cross-platform runtime essentials instead of the full MaTE X app environment.
* Reduced secret and credential exposure risk when running security-review commands against untrusted workspaces while preserving macOS Intel/Apple Silicon and Windows 10/11 process compatibility.
* Cleaned up validation process start-failure handling so failed launches resolve once without racing timeout or close handlers.
* Verified with `bun run typecheck` and `bun run lint`.

## Unreleased - 2026.05.12 (1) [Workspace Launcher and Command Parser Hardening]

* Hardened macOS workspace Terminal launching by escaping paths as AppleScript strings and letting AppleScript apply POSIX shell quoting before running `cd`.
* Fixed VS Code workspace URI construction so Windows UNC paths preserve host/share authority when opening a repository from the app shell.
* Strengthened direct command parsing for validation tools by preserving empty quoted arguments, supporting escaped characters, rejecting newline shell injection, and avoiding shell execution for direct commands.
* Detached Windows `taskkill` cleanup so cancellation of spawned validation processes does not keep MaTE X waiting on the cleanup helper.
* Verified the parser behavior with a focused `bunx tsx` import check.

## Unreleased - 2026.05.11 (5) [Agent Identity Binding and Runbook Export]

* Added persistent local Agent Run Identity under `.mate-x/config/agent-identity.json`, including identity UUID, creation timestamp, user-binding flag, and deterministic policy hash from local policy sources.
* Bound Evidence Packs, in-toto/SLSA attestations, compliance manifests, and procurement exports to `agentIdentity` without sending identity data to Rainy API.
* Added Agent Runbook export artifacts (`agent-runbook.json` and `agent-runbook.md`) with identity, policy hash, approvals, traceability, Verified Task Score, files, commands, risks, and attestation link.
* Added Agent Runbook export actions to the Evidence Pack card and Live Enhancement Panel, reusing the local compliance ZIP path.
* Fixed compliance ZIP entry timestamps so archive tools show real generated dates instead of `00-00-1980`.
* Documented compliance and attestation rules in `README.md`, `AGENTS.md`, and `RULES.md`.
* Verified with `bun test src/features/compliance/attestation.test.ts src/features/compliance/complianceExport.test.ts src/features/compliance/agentIdentity.test.ts`, `bun run lint`, and `bun run typecheck`.

## Unreleased - 2026.05.11 (4) [SOC 2 Compliance Export Package]

* Added local SOC 2 / procurement ZIP export for Evidence Packs with `evidence-pack.json`, `attestation.intoto.json`, `compliance-report.pdf`, `audit-log.json`, `policy-applied.md`, and `manifest.json`.
* Added a typed compliance export IPC path so the renderer can request report generation while main-process code owns workspace file writes.
* Added SIEM-compatible audit logs with SOC 2 CC6.1, PI1.2, and AI governance control evidence.
* Added lightweight PDF generation, deterministic manifest SHA-256 hashes, and encrypted ZIP delivery hooks for future Slack, WhatsApp, Linear, and Telegram report integrations.
* Added “Generate Compliance Report” actions to the Live Enhancement Panel and Evidence Pack card, plus right-click card context action.
* Verified with `bun test src/features/compliance/attestation.test.ts src/features/compliance/complianceExport.test.ts`, `bun run lint`, and `bun run typecheck`.

## Unreleased - 2026.05.11 (3) [In-toto SLSA Evidence Attestations]

* Added automatic in-toto Statement v1 / SLSA Provenance v1 attestations for generated Evidence Packs, written under `.mate-x/evidence/<taskId>/attestation.intoto.json`.
* Added local Ed25519 signing-key creation and reuse for Evidence Pack attestations, keeping private key material on device.
* Added canonical JSON hashing for Evidence Packs and modified files so attestations include the Evidence Pack digest plus material file digests.
* Gated attestation signing through the Privacy Firewall so secret-bearing Evidence Pack payloads are blocked from becoming trusted signed evidence.
* Extended Evidence Pack contracts and UI to expose attestation signed/blocked/failed status in the Evidence Pack card and Live Enhancement Panel.
* Verified with `bun test src/features/compliance/attestation.test.ts`, `bun run lint`, and `bun run typecheck`.

## Unreleased - 2026.05.11 (2) [Demo Responsiveness and Rainy Catalog Fast Path]

* Coalesced assistant progress IPC events in the main process, dropped duplicate progress payloads, and preserved immediate terminal-state delivery so long streaming runs wake the renderer less often.
* Optimized Rainy model loading to use the catalog endpoint first and only fall back to the broader models endpoint when needed, reducing cold-path network work for the composer model picker.
* Reduced streaming UI churn by memoizing message rows, avoiding smooth-scroll animation during active streams, using cached model catalog state on composer mount, and skipping thread timestamp updates until runs finish.
* Verified with `bun run lint` and `bun run typecheck`.

## Unreleased - 2026.05.11 (1) [Sandbox Performance and Progress Stability]

* Reworked `sandbox_run` isolated-copy preparation to copy only relevant workspace files while skipping generated/heavy artifacts, reducing startup cost for validation sandboxes on large repositories.
* Added sandbox preparation, cleanup, copied-file, and copied-byte metrics to execution reports so slow runs expose where time is spent.
* Serialized `sandbox_run` execution per workspace to avoid concurrent command trees racing over the same repository, ports, or cleanup lifecycle.
* Throttled assistant progress updates in the chat store, skipped duplicate payloads, and preserved immediate terminal-state flushes to reduce renderer churn during long tool-heavy runs.
* Verified with `bun run typecheck`.

## Unreleased - 2026.05.10 (1) [Sandbox Isolation Hardening]

* Hardened `sandbox_run` with process-tree timeout termination, deterministic status reporting, and async failure-memory persistence so validation runs finish faster and avoid false crash labels from stderr text.
* Added `isolated-copy` execution mode for running commands in a temporary workspace copy that excludes heavy/generated directories and cleans itself up after success, failure, or timeout.
* Defaulted package-manager mutation commands to isolated-copy mode when no execution mode is requested, reducing accidental direct workspace dependency changes while preserving explicit direct-mode control through policy.
* Added focused sandbox tests for command parsing, mutation detection, report status, isolated-copy behavior, cleanup, and generated-directory skipping.
* Verified with `bun run lint`, `bun run typecheck`, and `bunx vitest run src/electron/tools/sandbox_run.test.ts`.

## Unreleased - 2026.05.05 (4) [Deep Analysis Signal Ranking]

* Added semantic egress ranking so constant-host outbound calls are downgraded, environment-backed base URLs remain medium signal, and user-controlled callback/webhook targets in API surfaces stay high signal.
* Strengthened Deep Analysis Pipeline exact-tool-call dedupe so repeated sinks in the same matcher/file collapse into one investigation target instead of wasting next-step slots.
* Added focused scanner tests for SQL triage, weak crypto jitter/token cases, and outbound request ranking.
* Verified with `bun run lint`, `bun run typecheck`, and `bunx vitest run src/electron/tools/attack_surface_scan.test.ts`.

## Unreleased - 2026.05.05 (3) [Release Hardening]

* Fixed workspace terminal launching so macOS opens Terminal at the active workspace and Windows opens Command Prompt with the workspace as `cwd`.
* Added terminal spawn error handlers to avoid main-process crashes when the platform terminal launch fails.
* Hardened `run_tests` with a 10-minute timeout and bounded output capture so hung validation commands and large logs do not pin the app or grow memory without limit.
* Hardened manual update checks with numeric version comparison to avoid downgrade prompts and GitHub release URL validation before opening the browser.
* Added main-process `uncaughtException` and `unhandledRejection` logging for production diagnostics.
* Verified with `bun run lint`, `bun run typecheck`, and `bun run package`.

## Unreleased - 2026.05.05 (2) [Attack Surface Evidence Pipeline]

* Added `attack_surface_scan` as a local-first wide-net security candidate scanner that ranks active-source evidence before expensive AI review.
* Added `candidate_revalidator` to inspect candidate context, detect source/sink/mitigation/reference signals, and separate confirmed candidates from likely false positives or items needing context.
* Added `evidence_pack` to enforce precise candidate vs finding language, including final-answer blocks that only allow vulnerability wording after source-to-sink proof.
* Hardened `security_path_trace` precision so HTTP query parameter reads such as `c.req.query()` are not mislabeled as database sinks, and trace reports now use `Trace summary` instead of premature `Finding` wording.
* Disabled the direct `security_path_trace` shortcut when multi-tool evidence pipeline prompts mention `attack_surface_scan`, `candidate_revalidator`, or `evidence_pack`, preventing the assistant from skipping the requested workflow.
* Reduced attack-surface false positives by tightening command-execution detection to real calls/imports and limiting dynamic-code timer matches to string-based `setTimeout`/`setInterval` usage.
* Verified with `bun run typecheck`.

## Unreleased - 2026.05.05 (1) [Live Enhancement Panel]

* Replaced the topbar `Analyze` affordance with a right-side Live Enhancement panel that mirrors the sidebar, can collapse into a compact rail, and preserves the main chat/composer layout.
* Added modular Enhancement panel sections for TRACE, Impact, Validation, Evidence Pack, and Repo Health so users can switch between live runtime context, RepoGraph blast radius, validation signals, and evidence status.
* Wired the panel to active conversation state, assistant tool events, run status, RepoGraph impact, git changed files, workspace health, and real Evidence Pack data instead of static demo-only values.
* Added honest skeleton and pending states when no live run or Evidence Pack exists, while showing real Verified Task Score, executed commands, touched files, unresolved risks, and verdict once available.
* Fixed shell height and hook-order regressions introduced during the panel migration, preserving the floating composer and stable React render behavior.
* Verified with `bun run lint` and `bun run typecheck`.

## Unreleased - 2026.05.03 (4) [Onboarding Verification Workflow]

* Reworked onboarding into the four-step verification workflow: Welcome, Connect workspace, Set trust boundary, and First verification run.
* Added capability context for Repo graph, Privacy Sentinel, Security Path Trace, and Evidence Pack so the flow explains what will happen before setup completes.
* Split onboarding into general setup and functional verification stages, preserving appearance/theme/time controls, Rainy API key setup, and Privacy Sentinel ONNX model download before first verification.
* Fixed Privacy Sentinel onboarding progress so unknown download totals show a preparing state instead of `NaN%`, with visible runtime, inference, and progress status.
* Fixed stale Privacy Sentinel status after model install so ready state wins over pending download progress, and connected onboarding Trust setup to the real workspace trust contract instead of local-only toggles.
* Added richer workspace, trust boundary, and evidence pack cards while preserving existing `onboardingCompleted` settings persistence.

## Unreleased - 2026.05.03 (3) [Settings Layout Hardening]

* Fixed layout overflow in settings pages by adding `break-words` and `break-all` to `SettingsRow` description and status fields.
* Hardened "Workspace Memory" settings to prevent long storage paths from expanding the interface beyond the container.
* Verified with `bun run typecheck` and confirmed flex-shrink behavior in `SettingsRow`.

## Unreleased - 2026.05.03 (2) [Rainy Embedding Model Selection]

* Added selectable Rainy API v3 embedding models for RepoGraph indexing, defaulting to `qwen/qwen3-embedding-8b` with per-model dimensions and context limits for Gemini, Perplexity, and Qwen embedding providers.
* Added embedding reindex progress reporting in the composer, including percentage status when model changes trigger a full RepoGraph embedding rebuild.
* Fixed Privacy settings persistence so Privacy/Security controls save through app settings and show accurate saved/pending state.
* Hardened Privacy Firewall outbound embedding sanitization so remaining P0 matches are repaired without disabling detection or weakening `blockP0CloudSend`.
* Verified with `bun run typecheck` and focused ESLint on touched Rainy, RepoGraph, Privacy, settings, preload, and renderer files.

## Unreleased - 2026.05.03 (1) [Privacy Firewall and RepoGraph Auto-Index]

* Added MaTE X Privacy Firewall as a local outbound security layer for Rainy/cloud model requests, with deterministic P0 scanning, ONNX scanner integration, span postprocessing, placeholder redaction, encrypted local vault storage, and safe scan metadata for UI/evidence without raw secret text.
* Added Privacy settings controls for firewall mode, deterministic scanning, ONNX scanning, P0 cloud-send blocking, placeholder style, model confidence, local canary scan, vault clearing, model status, and background model download progress.
* Moved MaTE X Privacy v0.15 ONNX assets out of repo resources and into Electron userData at `Application Support/MaTE X/privacy/models/matex-privacy-v0.15`, with repo/package resources treated only as immutable fallback metadata when bundled.
* Added local download support for `enosislabs/matex-privacy-sentinel-v0.15-onnx`, including streamed progress events from the Electron main process to the settings UI.
* Guarded Rainy chat, responses, streaming, and embeddings payloads with privacy sanitization so outbound prompts, repo context, tool output, traces, memory snippets, and embedding inputs are redacted before cloud transit.
* Fixed strict-mode privacy behavior so P0 values are redacted first, exact raw secret-like values are scrubbed, sanitized payloads are asserted, and cloud sends are blocked only when sanitization cannot guarantee raw values are gone.
* Hardened RepoGraph embeddings so Rainy embedding provider errors do not fail graph construction; embeddings are skipped safely while nodes and edges remain usable.
* Added normalized parsing for multiple Rainy embedding response shapes and safe error reporting when the provider returns `{ error }` instead of vectors.
* Optimized RepoGraph auto-indexing so source/config/test/env/package changes trigger debounced refreshes, large file bursts trigger delayed refreshes, and noisy generated paths such as `.vite`, `resources`, build output, logs, and maps reuse the existing graph.
* Verified with `pnpm exec tsc --noEmit`, focused ESLint on touched privacy/Rainy/RepoGraph/settings files, and `bun test src/electron/privacy/privacy-regex-scanner.test.ts`.

## Unreleased - 2026.05.01 (1) [Critic Loop Verification]

* Added `critic_loop` as an assistant execution mode for high-impact tasks, with primary answer, critic review, forced revision on major issues, and deterministic verifier checks before final output.
* Added a Critic Loop verifier module that checks validation status, live modified files from `git status --short`, claimed file existence, recorded command execution, and final-answer consistency.
* Added claim-level verification for inflated security severity, conditional exploitability, unsupported high-confidence claims, missing-file claims, ENOENT claims contradicted by real workspace files, and fix requests that produced no patch.
* Added consistency guardrails so final answers cannot claim `Warnings: None` while unresolved risks remain, cannot mix blocked/failed validation with passed validation, and cannot say `merge-ready` while CI is still pending.
* Added completion guardrails for read-only audits that defer to a future audit pass without giving a current verdict.
* Added a compact execution-mode selector to the composer so users can choose Build, Plan, or Critic Loop instead of always submitting Build mode.
* Hardened Critic Loop prompts so the critic reviews existing context without tools by default and downgrades unsupported High/Critical claims unless exploitability or full data flow is proven.
* Verified with `bun run typecheck` and `bun run lint`.

## Unreleased - 2026.04.30 (2) [Verified Task Score]

* Added machine-computed Verified Task Score to Evidence Packs with `score`, `status`, `missingEvidence`, and per-signal evidence rows.
* Scored task reliability from runtime evidence only, including inspected files, run-scoped changes, patch tools, validation planning/execution/pass state, reproduction evidence, failure context, unresolved risks, claimed file existence, and claimed command execution.
* Attached Verified Task Score to Mission Log summaries, run metrics, Evidence Cards, and benchmark-exported Evidence Pack payloads.
* Prevented pre-existing dirty workspace files from being counted as files changed by the current run while preserving actual patch-tool touched paths.
* Refined Mission Log event labels so read-only runs show scope discovery, file inspection, runbook selection, and agent steps instead of false patch or verification labels.
* Fixed landing-page lint issues caused by duplicate/body `lucide-react` imports.
* Verified with `bun run typecheck` and `bun run lint`.

## Unreleased - 2026.04.30 (1) [Security Path Trace Precision]

* Added a Security Path Trace engine for TypeScript, JavaScript, and Electron repositories that finds precise source-to-sink flows across user input, IPC, HTTP handlers, environment variables, file reads, external API responses, shell execution, file writes, database queries, DOM injection, dynamic code execution, network requests, and token usage.
* Added modular trace scanning, pattern matching, confidence scoring, Markdown report formatting, and patch suggestions under the Electron security trace module.
* Integrated `security_path_trace` as an agent tool and bypassed remote Rainy orchestration for explicit local trace requests so repository-local analysis does not fail on model/API serialization errors.
* Hardened precision rules to suppress noisy false positives by requiring matching IPC channels, real shared data symbols, same-path read/write filtering, exact environment variable or assigned-token flow, and response-driven external API cascades.
* Escaped backticks in reported snippets so template literals render correctly in trace reports.
* Removed intentional vulnerable trace fixtures after validation so production scans do not report planted test pollution.
* Verified with targeted ESLint on tracer files and `bun run typecheck`.

## Unreleased - 2026.04.28 (1) [Agent Capability Profiler]

* Added a local Agent Capability Profiler that records per-model behavior metrics globally and per workspace after real assistant runs.
* Added profiler metrics for tool call success rate, invalid tool calls, average iterations, patch success, patch QA pass rate, validation pass rate, hallucinated path count, repeated failures, average tokens per task, and average time per verified task.
* Added dynamic model capability tags including `good_at_review`, `good_at_patch`, `good_at_tests`, `high_hallucination_risk`, `expensive_but_reliable`, and `cheap_fast`.
* Added routing recommendations that explain which model is recommended for a task based on observed local evidence, while keeping auto-switch disabled unless the user explicitly enables it.
* Added `/settings/agent-profiler` with workspace/global model behavior tables, recommendation input, advisory auto-switch toggle, and clearer metric labels.
* Hardened profiler classification so patch, validation, hallucinated path, repeated failure, and unsupported-tool outcomes are derived from actual tool events and outputs instead of broad final-answer claims.
* Blocked execution-intent patch or validation runs for models that do not advertise tool-calling support, so chat-only models are not treated as viable patch/test agents.
* Added Patch QA scoring so models that technically edit files but show suspicious patch behavior, failed edit attempts, static-validation claims, or weak validation evidence are not rewarded as strong patch models.
* Fixed profiler token display to show average tokens per task instead of only average tokens per verified task, preventing non-verified but real runs from showing `0` tokens.
* Verified with `bun run typecheck` and `bun run lint`; `bun run build` is not defined in this repository.

## Unreleased - 2026.04.27 (3) [Repro Harness and Configurable Sandbox]

* Added a required Reproduce stage to patch-focused agent workflows so suspicious behavior is reproduced, validated, or statically proven before remediation.
* Added structured reproduction evidence to Evidence Packs, including reproduction type, pre/post patch outcome, location, command, and whether the repro existed before patch.
* Added support for unit tests, integration tests, minimal scripts, HTTP requests, browser scenarios, validation runs, and static proofs as reproduction types.
* Hardened reproduction parsing for markdown-bold labels, duplicate `Reproduction:` sections, final-block precedence, `validation_run`, and `not_applicable` outcomes.
* Added configurable `sandbox_run` timeouts of 30, 45, 60, 120, and 240 seconds with matching orchestration timeout grace so long validations are not cut off by the default tool wrapper.
* Added `sandbox_run` controls for `maxOutputChars`, `port`, `nodeEnv`, `keepAwake`, and Electron `powerSaveBlockerType`, using `powerSaveBlocker` for long or interactive runs.
* Improved sandbox command parsing so quoted arguments such as `node -e '...'` work while shell operators outside quotes remain blocked.
* Tightened agent evidence integrity guidance so runtime evidence, validation-run classification, and multi-command reporting must match executed tool calls.
* Verified with `bun run typecheck` and `bun run lint`; lint still reports existing unrelated unused `settings` warnings in legacy tool modules.

## Unreleased - 2026.04.27 (2) [Live Reasoning Stream]

* Added real-time reasoning token streaming to the agentic loop so the model's internal thinking is forwarded to the UI as it arrives, not only after the turn completes.
* Added `onReasoningDelta` optional callback to `requestRainyChatCompletionStream` in `rainy-service.ts`, dispatched on every `delta.reasoning` chunk received from the Rainy API stream.
* Wired `onReasoningDelta` in the agentic loop inside `repo-service.ts` to accumulate reasoning tokens into `streamedThought` and call `emitProgress` with the live thought on every chunk.
* Updated `onContentDelta` to also forward the accumulated `streamedThought` so the thought field stays populated once content starts arriving.
* The `thought` field already propagated through `AssistantProgressReporter → IPC → chat-store → message.thought`, so the 🧠 Thinking block in the UI now updates in real time with no renderer changes required.

## Unreleased - 2026.04.27 (1) [Failure Memory Engine]

* Added a workspace-scoped Failure Memory Engine that persists structured command and validation failures with command, exit code, framework metadata, failing tests, stable error signatures, stack excerpts, affected files, attempted fixes, retry outcomes, occurrence counts, and timestamps.
* Added signature normalization for paths, timestamps, line numbers, random IDs, ANSI output, and optional metadata differences so repeated failures resolve to a canonical workspace history entry.
* Added `find_similar_failures`, `record_failure`, and `record_resolution` agent tools so agents can check known failures before retrying, record failed validation or patch attempts, and mark resolved failures after successful retries.
* Wired failure memory into `run_tests` and `sandbox_run` so failed validation and diagnostic commands are recorded automatically, repeated failures increment counts, successful retries can resolve prior failures, and tool output warns before likely repeated loops.
* Injected a `Known similar failure from this workspace` context section into agent runs so diagnostics can reuse prior failure knowledge instead of rediscovering recurring repository issues.
* Added migration and repair behavior for malformed or duplicate historical failure signatures, merging duplicate records while preserving earliest first-seen time, latest last-seen time, and total occurrence count.
* Verified with `bun run typecheck` and `bun run lint`; lint still reports existing unrelated unused `settings` warnings in legacy tool modules.

## Unreleased - 2026.04.26 (2) [Validation Planner]

* Added a Validation Planner service that selects the smallest useful validation plan from the task objective, changed files, RepoGraph impacted files, package scripts, detected framework, and previous validation failures.
* Added structured validation plans with primary and fallback commands, reasons, estimated cost, expected signal, risk level, fallback trigger, recommendations, comments, and explicit not-run execution state.
* Added the `plan_validation` agent tool so agents plan validation before executing commands and avoid ad-hoc command selection when a plan exists.
* Added runtime-aware workspace capability detection that distinguishes Bun, pnpm, Yarn, and npm from `packageManager` metadata and lockfiles, then rewrites stale generated profile commands to the detected runtime while preserving custom commands.
* Updated `run_tests` to execute planned primary or fallback commands even when no test script exists, persist the validation plan with each validation run, return the saved validation run ID, and self-report plan/run persistence proof.
* Added `verify_validation_persistence` to verify latest plan persistence, matching plan IDs on validation runs, required high-risk fallback execution, and complete validation-stage evidence from database records.
* Improved high-risk behavior so primary validation returns a required fallback action when the fallback is distinct, and the persistence verifier remains incomplete until required fallback evidence exists.
* Improved fallback diversity and wording so fallback commands prefer a distinct build, lint, typecheck, or test signal and avoid misleading duplicate-command explanations.
* Updated agent runtime guidance so validation plans are created before validation, planned commands are authoritative, required follow-up actions are executed, and persistence or completion is not claimed without tool evidence.
* Verified with `bun run typecheck` and `bun run lint`; lint still reports existing unrelated unused `settings` warnings in legacy tool modules.

## Unreleased - 2026.04.26 (1) [Impact-Aware Patch Engine]

* Added an Impact-Aware Patch Engine for `auto_patch` and `file_editor` that analyzes RepoGraph context before and after patch attempts.
* Pre-patch impact now identifies the target file, importing files, imported files and dependencies, related tests, affected contract/type files, and affected package scripts for config or manifest edits.
* Post-patch impact now reports recomputed impacted RepoGraph nodes, added/removed imports, changed exported symbols, and changed IPC/API/environment/dependency surface when detectable.
* Added structured patch risk decisions with `low`, `medium`, `high`, and `unknown` levels, numeric scores, confirmation requirements, user-facing reasons, and validation command recommendations.
* Added a pre-write impact gate so high-risk or unknown-impact patches are blocked before file mutation unless the tool call explicitly includes `allowHighImpact: true` after user confirmation.
* Added `expectedContent` support to `file_editor` so line-range edits are rejected when the current file content does not exactly match the intended range, preventing wrong-range edits from corrupting shared helpers.
* Added no-op detection for patch tools so identical replacements are skipped without writing files while still returning a readable `PATCH_IMPACT_DECISION` and fenced impact JSON.
* Removed automatic `.bak` backup creation from patch tools to avoid generating stray backup files in user repositories.
* Improved validation selection so TypeScript/TSX source edits recommend `bun run typecheck` instead of falling back to `unknown`.
* Verified with `bun run typecheck`; `bun run lint` is currently blocked by an unrelated existing `import/first` error in `src/main.ts` plus legacy unused `settings` warnings in tool modules.

## Unreleased - 2026.04.25 (2) [Working Set Compiler]

* Added a Working Set Compiler that builds a budgeted, structured context pack before each agent run from the Repo Intelligence Graph, current objective, git state, prompt-linked files, recent validation failures, package scripts, and workspace memory notes.
* Ranked primary targets, direct imports, direct importers, related tests, contract/type surfaces, git diff snippets, and relevant scripts so agents start from high-signal context instead of broad repository exploration.
* Injected the working set into the agent prompt with explicit instructions to use it first, prefer graph context over broad search, and avoid inspecting unrelated files unless evidence requires it.
* Persisted working set metadata on reproducible run results and attached the full working set to assistant messages for auditability.
* Tightened validation prompt guidance so a successful narrow validation command is treated as resolved or unreproduced unless concrete diagnostics prove otherwise.
* Verified with `bun run typecheck` and `bun run lint`; lint still reports existing unrelated unused `settings` warnings in legacy tool modules.

## Unreleased - 2026.04.25 (1) [Repo Intelligence Graph and Change Impact]

* Added a persistent per-workspace Repo Intelligence Graph in the Electron main process, stored in Turso/libSQL with graph nodes, edges, and refresh snapshots.
* Indexed repository files, imports, exports, tests, package scripts, command purpose, entrypoints, IPC channels, environment variable usage, config files, dependency manifests, and dependency usage.
* Exposed graph APIs for entrypoints, impacted files, tests for file, import chains, IPC surface, environment usage, and dependency surface through IPC, preload, and the `repo_graph` agent tool.
* Wired the agent runtime to use RepoGraph context before broad file search, improving structural reasoning and reducing blind exploration.
* Added incremental refresh hooks for filesystem changes, workspace switches, and git status reads.
* Expanded IPC intelligence with handler delegation edges so IPC channels map to service functions and runtime-dependent service files.
* Improved impacted-file output by grouping noisy high fan-out tool ecosystems while preserving concrete high-signal files.
* Replaced the debug graph UI with a user-facing Change Impact panel that analyzes current git changes, risk level, affected files, service blast radius, tool fan-out, and suggested tests.
* Moved Change Impact access into the topbar `Analyze` action and removed the confusing standalone theme shortcut button from the visible topbar.
* Verified with `bun run typecheck` and `bun run lint`; lint still reports existing unrelated unused `settings` warnings in legacy tool modules.

## Unreleased - 2026.04.24 (2) [Advanced Offensive Security Arsenal]

* Expanded MaTE X agent capabilities with 14 new highly specialized, enterprise-grade offensive security tools.
* Implemented **File System Utilities (`pwd`, `du`, `find`)** as pure Node.js multi-platform tools, bypassing OS-specific shell commands.
* Added **Dynamic Application Security Testing (DAST) (`http_prober`, `browser_prober`)** using native `fetch` and an invisible Electron `BrowserWindow` to execute DOM payloads without heavy Puppeteer dependencies.
* Built **Red Teaming Exploit Handlers (`oob_listener`, `creds_validator`)** to catch Blind SSRF/XSS via ephemeral `node:http` servers and actively validate leaked GitHub/Slack/NPM tokens against live APIs.
* Integrated **Deep Code Analyzers (`redos_analyzer`, `prototype_pollution_fuzzer`)** using highly isolated `node:worker_threads` y `node:vm` sandboxes to test Catastrophic Backtracking and JS Prototype Pollution safely without crashing the main application.
* Added **Forensic Auditors (`package_audit`, `source_map_analyzer`, `local_network_recon`)** to map localhost TCP ports in milliseconds, extract CVEs via native package managers, and aggressively hunt leaked environment variables in `.js.map` build artifacts.
* Introduced a stable **Remediation Engine (`file_editor`)** capable of surgically replacing multi-line code blocks via strict line ranges with automatic `.bak` backups.
* Registered all 14 tools in the central `ToolService` and ensured zero warnings via `bun run lint && bun run typecheck`.

## Unreleased - 2026.04.24 (1) [Internal Approval Resume]

* Replaced synthetic approval continuation prompts with internal policy-stop resolution so approving or declining a tool action resumes the existing run instead of creating a fake user chat turn.
* Added explicit policy-stop lifecycle states for approval, decline, resume, completion, and failure, and wired the agent tool loop to wait for policy resolution before continuing.
* Kept approval controls usable while a run is paused and removed duplicate queued continuation behavior from the chat route.

## Unreleased - 2026.04.23 (6) [Safe Tool Classes Runtime Policy]

* Added shared Safe Tool Classes contracts for risk class, impact type, contract allowance, and escalation decisions.
* Classified agent tool calls at runtime before execution and attached policy metadata to trace events.
* Updated the action timeline to display risk class, impact tags, contract status, escalation status, and classification reason.
* Added an inline approval prompt above the composer so approval-required runs can approve once or continue with safer alternatives.
* Clarified the agent runtime prompt and tool descriptions so commands, package mutations, and workspace writes are treated as real governed effects, not fake sandbox changes.
* Fixed execution-intent runs so build-mode requests like retry, update, run, fix, or verify require a tool-backed pass instead of stopping after a single streamed text step.
* Fixed package-manager mutation permissions so unrestricted workspaces can execute them, while approval-required workspaces surface a package mutation approval stop instead of returning a hard-coded command block.
* Removed the canned assistant placeholder text so streaming starts from real model/tool progress instead of repeating a static message.
* Fixed the approval workflow so pending policy stops refresh without route changes, approval controls stay clickable while the run settles, and the approved/declined continuation is queued until the runner is ready.
* Stopped high-impact edit approval stops from firing under unrestricted contracts.

## Unreleased - 2026.04.23 (5) [Workspace Memory Files]

* Added workspace-scoped memory files stored in private app data outside the repository: `MEMORY.md`, `GUARDRAILS.md`, `WORKSTATE.md`, and `metadata.json`.
* Added the `/settings/workspace-memory` settings section with editable memory, guardrails, and workstate files plus save, reset, and reveal-folder controls.
* Wired typed main-process IPC, preload, renderer client APIs, and strict file-kind validation for workspace memory operations.
* Initialized workspace memory during workspace bootstrap and activation so memory files exist for every opened workspace.
* Injected workspace memory into assistant bootstrap context so agent runs can use mission-scoped operational context.
* Added automatic post-run memory summarization: `WORKSTATE.md` receives generated session summaries and pending proposals, while durable memory and guardrail updates are proposed for human review.
* Verified lint and typecheck; existing unused `settings` warnings remain in tool modules.

## Unreleased - 2026.04.23 (4) [Mission Log Reproducible Runs]

* Added the **Mission Log** route for reviewable execution history inside the existing MaTE X desktop shell.
* Introduced first-class `ReproducibleRun` records with captured initial state, user intent, decisions, live tool events, artifacts, final result, and evidence pack linkage.
* Persisted run records with workspace conversation state so new assistant executions produce operational history instead of UI-only mock data.
* Added secret redaction and SHA-256 hash-chain sealing for completed or failed runs, exposing sealed root hashes as exportable evidence.
* Added JSON export for sealed run artifacts and upgraded the run evidence panel with operational decisions, integrity status, structured command evidence, and semantic timeline labels such as Tool batch, Policy pause, Patch attempt, Scoped retry, and Verification pass.
* Verified lint and typecheck; existing unused `settings` warnings remain in tool modules.

## Unreleased - 2026.04.23 (3) [Policy Stops Enhanced Security + UI]

* Enhanced agent run policy to enforce a "security-surface budget" that caps high-risk operations (large file writes, removals, build/install commands) per run, proactively pausing the agent before exceeding the budget.
* Introduced **scoped resolutions** so operators can grant temporary exceptions (e.g., allow a specific large file write) that expire when the current run concludes, preserving the default safe baseline for future sessions.
* Added a **Policy stops** indicator to the thread status pill that displays an icon and count of paused actions for the current session, providing at-a-glance risk awareness.
* Added **Security and Policy** filters to the chat sidebar to surface only policy-related entries (paused actions, recommendations, approvals, disapprovals) in the conversation history, reducing visual noise from routine operations.
* Extended Evidence Pack to include `policyStops[]` for all blocked or approved actions and `budgetRemaining[]` for tracking resource exhaustion during the session.
* Updated `src/main.ts` to register new IPC endpoints for listing all policy stops and resolving specific stops, enabling UI-driven exception management.
* Updated `chat-store.ts` and `ConversationalChat.tsx` to read `activeSessionStops` and thread policy status from the backend, driving the UI indicators.
* Verified lint and typecheck; existing unused tool settings warnings remain in `pdf_report` and `github-pr` modules.

## Unreleased - 2026.04.23 (2) [Premium PDF Security Reports Tool]

* Added the `pdf_security_report` tool, enabling the agent to autonomously generate precise, shareable, and premium PDF security reports.
* Integrated `@libpdf/core` to dynamically construct and style the PDF using standard fonts and varied colors for risk severities.
* Registered the new tool in `ToolService` making it available for the agentic loop.

## Unreleased - 2026.04.23 (1) [Policy Stops Runtime Foundation]

* Added structured Policy Stop contracts for paused runs, attempted actions, recommendations, scoped resolutions, and run state.
* Implemented a main-process Policy Stop service that detects out-of-scope file access, dangerous commands, secret-like tool arguments, and high-impact security-surface changes before agent tool execution.
* Wired Policy Stops into the agent tool loop so blocked actions produce auditable paused tool results instead of executing silently.
* Added typed Policy Stop IPC and preload APIs for listing stops, reading run policy state, and resolving stops.
* Verified the change with `bun run lint && bun run typecheck`; existing unused `settings` warnings remain in tool modules.

## Unreleased - 2026.04.22 (6) [Supermemory Persistent Context Plugin]

* Integrated **Supermemory** as a persistent, context-aware memory plugin for long-term agent context management.
* Added `supermemoryApiKey` to `AppSettings` and `DEFAULT_APP_SETTINGS` with full Turso-based persistence.
* Refactored the core `Tool` interface to include the `settings` context in the `execute` method.
* Updated the entire agentic loop in `RepoService` to propagate `appSettings` from the main process to all executed tools.
* Refactored all 32+ existing tools (security, code analysis, infrastructure) to support the new tool signature.
* Implemented the `supermemory` tool with `add`, `search`, and `profile` actions, featuring automatic repository isolation via workspace path tagging.
* Added a new **Integrations** section in the `SettingsPage` UI for secure Supermemory API key management.
* Integrated the "Integrations" link into the main `AppSidebar` navigation for immediate access.
* Verified all architectural changes with `bun run lint` and `bun run typecheck`.

## Unreleased - 2026.04.22 (5) [Native Chat Context Menu and Thread Management]

* Added a native context menu for chat threads in the sidebar with support for Rename, Archive, and Delete actions.
* Implemented macOS-native and Windows-compatible context menu integration via main-process IPC handlers.
* Added an inline renaming UI in the sidebar that allows editing thread titles directly with automatic focus and persistence on Enter or blur.
* Introduced thread archiving logic that filters archived conversations from the main sidebar list while preserving them in the local session.
* Enhanced thread deletion to ensure at least one active conversation remains per workspace, automatically selecting a fallback thread when the active one is removed.
* Updated `Conversation` contract and `chat-store` logic to support `isArchived` status and title updates.

## Unreleased - 2026.04.22 (4) [Structured Runbook Engine and Evidence Stage Telemetry]

* Introduced a structured runbook engine contract with explicit workflow metadata: objective, mandatory stages, required checks, success criteria, stop conditions, and final evidence format.
* Added the first flagship runbook (`patch_test_verify`) and expanded supported workflow ids for future sequences: `audit_reproduce_remediate`, `review_classify_summarize`, and `scan_contain_report`.
* Wired runbook resolution into assistant execution so each run records the active runbook in runtime events/artifacts and injects the selected runbook contract into agent system guidance.
* Added a composer-level runbook selector in the existing shell controls so operators can choose workflow structure per prompt without changing app layout patterns.
* Extended `EvidencePack` with machine-parseable workflow telemetry: `stages[]`, `checks[]`, and `stopConditionTriggered`.
* Enhanced finalization parsing to extract `Stages`, `Checks`, and `Stop conditions` sections from assistant output into structured evidence fields.
* Updated Evidence Pack runtime assembly to persist parsed runbook stage/check results and runbook-aware fallback checks when structured check lines are missing.
* Rendered new `Stages`, `Checks`, and `Stop condition triggered` sections in the Evidence Pack card while preserving existing visual density, border tokens, spacing rhythm, and warning styling.

## Unreleased - 2026.04.22 (3) [Unrestricted Workspace Trust Mode]

* Introduced a new `unrestricted` autonomy mode for Workspace Trust Contracts, granting AI models full access to read/write any file, run any shell command, and access any network domain.
* Added a high-risk confirmation modal in Settings > Trust that requires explicit user acceptance of security risks before enabling Unrestricted mode.
* Updated the trust evaluation engine in the main process to bypass all security blocks when Unrestricted mode is active.
* Enhanced the system prompt generation to explicitly communicate full permission status to the AI model when running in Unrestricted mode.

## Unreleased - 2026.04.22 (2) [Evidence Pack Runtime Artifact and Modular Finalization]

* Added a first-class `evidencePack` contract on chat messages with structured fields for verdict, status, modified files, commands, tools used, tests, warnings, unresolved risks, touched paths, and recommendation.
* Implemented runtime Evidence Pack assembly from execution traces and tool metadata, including parsed structured tool outputs and git status-derived file impact.
* Captured per-tool execution records during agent loops so Evidence Pack evidence is grounded in runtime actions rather than inferred from narrative text.
* Added a dedicated Evidence Pack panel in assistant messages and kept RunTimeline as the separate raw operational log.
* Modularized implementation by extracting Evidence Pack runtime logic into `src/electron/evidence-pack.ts` and UI rendering into `src/features/desktop-shell/components/evidence-pack-card.tsx`.
* Added `src/electron/evidence-finalization.ts` to parse agent-authored judgment sections (`Verdict`, `Verdict summary`, `Confidence`, `Warnings`, `Unresolved risks`, `Final recommendation`) and merge them with runtime-derived evidence.
* Updated agent final-answer guidance so those judgment headings are emitted consistently when applicable, improving reliability of structured finalization extraction.

## Unreleased - 2026.04.22 (1) [AgentTrace v2 Inline Streaming Repair]

* Switched Rainy chat completions to the streaming API path for agentic runs, emitting assistant content deltas live instead of waiting for the full completion.
* Updated the agent loop so models can answer from existing workspace context, emit brief natural-language progress before tools, and avoid forced investigation/tool use when it is not needed.
* Reworked AgentTrace v2 inline rendering so internal run metadata stays hidden while real tool activity remains available as compact collapsed action groups.
* Fixed v2 pending states to avoid exposing internal events such as `Agent pass`, `workspace metadata`, `prompt-linked files`, and `response complete`.
* Added fallback rendering for tool events that were emitted by the runtime but not referenced by model-inserted inline trace markers, preventing used tools from disappearing.
* Added visible-text normalization for provider/model channel artifacts and reasoning tags, including `<think>`, `<thinking>`, `<thought>`, `<reasoning>`, `<analysis>`, and OpenAI-style channel tokens.
* Rewrote the MaTE X system prompt in English with stricter guidance for scoped tool use, evidence-driven responses, inline progress updates, and avoiding redundant repository exploration.
* Verified the repair with `bun run lint` and `bunx tsc --noEmit --ignoreDeprecations 6.0`.

## Unreleased - 2026.04.21 (3) [Agent Trace v2 UX and Settings Integration]

* Added a persisted `agentTraceVersion` app setting (`v1` or `v2`) with strict normalization and default value `v2` in shared settings contracts and Turso persistence.
* Added a new Settings → General control (`Agent Trace mode`) so users can switch between trace versions from the existing app shell.
* Upgraded composer model selection UX to better handle full catalog browsing by showing both model label and raw model id in the dropdown options.
* Wired chat route hydration to read persisted app settings and pass `agentTraceVersion` into the message stream renderer.
* Introduced dual trace rendering paths in message stream:
  * `v1`: legacy run activity timeline behavior.
  * `v2`: inline model-actions trace integrated directly into assistant response flow.
* Reworked v2 trace interaction to be collapsed by default, expandable on demand, and visually staggered for action rows so it feels embedded in chat rather than a standalone timeline panel.
* Added full-action inspection for v2 with a dedicated modal (`View all actions`) that lists all executed tool actions extracted from the streamed run events.
* Improved v2 modal interaction with close controls via dedicated button, backdrop click, and `Esc` keyboard shortcut.

## Unreleased - 2026.04.21 (2) [Real Settings Persistence and Theme/Time Wiring]

* Added a real app-settings contract (`AppSettings`) with persisted fields for theme preference, time format, diff line wrapping, assistant streaming output, archive confirmation, and delete confirmation.
* Extended settings IPC and preload bridges with `settings:get-app-settings` and `settings:update-app-settings`, plus renderer-side settings client helpers for reading, updating, and applying settings.
* Persisted app settings in the existing `app_state` table through `turso-service`, including strict normalization and defaults fallback for malformed or missing values.
* Rewired `/settings` General and Archive sections to load persisted values on entry, track pending changes against saved state, save through IPC, and restore defaults by section.
* Connected theme preference to persisted app settings and shell hydration, so startup now applies the stored DB theme as the source of truth instead of isolated local-only toggles.
* Connected time-format preference to chat timestamp formatting (`system`, `12h`, `24h`) and ensured renderer hydration applies it globally after boot.

## Unreleased - 2026.04.21 (1) [Workspace Trust Contracts]

* Added workspace-scoped trust contracts that define allowed paths, forbidden paths, allowed commands, allowed network domains, allowed secrets, allowed actions, blocked actions, and autonomy level per workspace.
* Persisted each contract in the local workspace database and included the active contract in workspace snapshots so renderer state, settings, and assistant runs share the same governed profile.
* Added a same-shell Settings section at `/settings/trust` for editing the active workspace contract without leaving the existing MaTE X desktop chrome.
* Displayed the active contract version, autonomy level, allowed scope, and blocked actions in the composer before each run.
* Enforced contracts in the Electron tool layer before execution, including action checks, command allowlists, path scope checks, forbidden-path checks, and plan-only autonomy restrictions.
* Scoped ripgrep searches through the active contract and prevented Rainy API calls when the provider domain is not allowed by the contract.
* Added a narrow `bun:test` type shim so repository type-checking remains clean with the existing colocated tests.

## Unreleased - 2026.04.19 (1) [Tool Service Hardening and Native Tool Reliability]

* Added native tools `read_many` and `json_probe` so agent can read many files fast and query JSON values directly.
* Added shared safe-path helpers in `src/electron/tools/tool-utils.ts` to block traversal and keep tool file access inside workspace root.
* Hardened `ToolService` registration/execution: duplicate-name guard, cached tool definitions, strict schema normalization, runtime arg validation before tool run.
* Registered new tools in both chat and responses tool-definition paths so agent can call them natively in both loops.
* Secured core tools (`read`, `ls`, `metadata`, `auto_patch`, `mutation`, `flow`) with safer path handling, bounded output, safer command execution, and fixed regex term matching.
* Reduced tool batch concurrency in `repo-service.ts` to improve stability and avoid overload during multi-tool turns.
* Verified integration and quality: `bun run lint` and `bun run typecheck` pass; new tools present in runtime registry.

## Unreleased - 2026.04.17 (4) [Chat Flow and Context Extraction Repair]

* Reworked the assistant conversation surface to remove the dedicated `Agent trace` / execution-trace blocks from chat and present in-flight progress as normal inline assistant updates, matching the T3CODE-style flow more closely.
* Removed the visible artifact pill strip from assistant messages so the main conversation stays focused on the reply itself instead of internal telemetry.
* Fixed the broken `ast_grep` context extraction path that was incorrectly parsing ripgrep output with escaped newline and digit patterns, which caused valid matches to degrade into the useless `Matches found, but context extraction failed.` error.
* Added a safer fallback in `ast_grep` so when full block reconstruction is not possible, the tool still returns usable local snippet context instead of collapsing into a hard failure string.
* Corrected assistant history replay inside the tool loop so prior turns are reconstructed from their stored `user:` / `assistant:` roles rather than being reassigned by index parity, improving multi-pass model behavior during iterative tool use.

## Unreleased - 2026.04.17 (3) [Ultimate Enterprise Security Arsenal Expansion]

* Expanded the MaTE X intelligence suite from basic static analysis to an enterprise-grade agent with 24 specialized security tools for localized auditing.
* Implemented **Deep Code Auditing Tools (`read`, `ls`, `git_diag`)** allowing the agent to perform vulnerability archaeology via commit history and precise line-range reads of the local filesystem.
* Added a **"Perfect" Security Toolset (`secret_scan`, `file_metadata`, `tree`)** capable of confidently finding hardcoded secrets, analyzing file permissions, and creating structural project map visualizations.
* Introduced **Advanced Intelligence Forensics (`security_audit`, `dependency_check`)** to run categorized, pattern-based audits for logic flaws (e.g., `innerHTML`, `exec()`) and identify supply-chain risks in package manifests.
* Deployed **Infrastructure & Compliance Scanners (`network_map`, `sql_audit`, `env_audit`, `container_audit`)** that actively map the application's external boundaries, database sinks, and container definitions (Docker/Kube) for deployment compliance.
* Powered up the agent with the **Extreme Intelligence Suite (`flow_trace`, `entropy_scan`, `auth_audit`, `security_report`)** for iterating through variables across multiple files, detecting encrypted/hashed tokens mathematically via Shannon entropy, and outputting top-tier prioritized POSTURE reports.
* Achieved **Grade A Active Remediation (`auto_patch`, `fuzzer`, `cve_audit`)**, equipping the agent with the autonomy to actively fuzzy-test endpoints using live DAST payloads, pull exact offline CVE numbers via package managers, and safely generate plus inject code modifications (patches) back into the repository with `.bak` rollback safety.
* Mastered the state with the **Enterprise Attack Simulation Suite (`sandbox_run`, `traffic_poison`, `mock_poison`)**, allowing the tool to spin up the local application inside an isolated background sandbox, simulate highly advanced context-aware logic breaks (Mass Assignment, Logic Bombs), and launch "poisoned" external HTTP servers to test application deserialization resilience.
* Integrated the **Mutation Testing Engine (`mutation`)** to safely and temporarily inject invisible glitches into the source code to statistically unearth missing test coverage.
* All tools dynamically registered under the unified `ToolService`, instantly available to the OpenAI-compatible Rainy payload schemas over standard IPC links, and thoroughly checked free of any TypeScript compiler or ESLint warnings.

## Unreleased - 2026.04.16 (2) [Rainy API v3 Integration and Settings Panel]

* Migrated the AI provider from OpenAI to Rainy API v3 across the full pipeline: `repo-service.ts` now builds the client with a constant `baseURL` and reads the API key at request time from the local database, eliminating all runtime environment variable dependencies.
* Replaced the generic English system prompt with a security-focused Spanish prompt that establishes MaTE X as a local code review agent with precise, evidence-grounded behavior.
* Extended `turso-service.ts` with `getApiKey`, `setApiKey`, and `clearApiKey` methods persisted in the existing `app_state` table, so the user's key survives restarts without any additional schema changes.
* Added three new IPC channels (`settings:get-api-key`, `settings:set-api-key`, `settings:clear-api-key`) registered in `ipc-handlers.ts` and wired through a new `SettingsApi` contract in `contracts/ipc.ts`.
* Exposed `window.mate.settings` in the contextBridge preload so the renderer can read and write the API key safely without accessing the Node.js layer directly.
* Created `services/settings-client.ts` as the renderer-side façade for the settings IPC channels, following the same pattern as `repo-client.ts`.
* Replaced the renderer-side `lib/openai.ts` client to use Rainy API v3 and resolve the API key through `window.mate.settings.getApiKey()` instead of environment variables or localStorage.
* Built a Settings dialog (`settings-dialog.tsx`) with API key input, masked display, connected/not-connected status badge, save and remove actions, and a security note — visually consistent with the existing workspace overview dialog using Base UI, custom CSS properties, and the same surface and typography patterns.
* Renamed the previous `settings-dialog.tsx` to `workspace-dialog.tsx` to preserve the workspace overview feature without breaking existing props.
* Wired the Settings dialog into the sidebar footer so clicking the "Settings" row opens the API key panel, while theme toggles remain functional with `stopPropagation`.

## Unreleased - 2026.04.16 (1) [Workspace Persistence and Turso Foundation]

* Added real workspace management for the desktop shell, including folder import, workspace switching, removal, and active project tracking from the sidebar.
* Connected source control and repository inspection to the active workspace instead of a fixed `process.cwd()`, so each imported folder has its own live git context.
* Implemented persistent workspace and AI session storage on top of `@libsql/client`, with Turso-compatible configuration and local-first fallback for Electron user data.
* Persisted conversation threads per workspace, including active thread restoration after app restart or workspace changes.
* Wired system actions for the active workspace, including open folder, open in VS Code, and desktop-level workspace session synchronization through IPC.
