# Repository Guidelines — MaTE X

## Context & Token Efficiency (MANDATORY — Read First)

**Optimize context use without limiting the work required for a correct result. Apply these rules before every action:**

1. **Start with the smallest useful context.** Read files directly named by the task, known from the directory map, or located with a targeted `rg` query. Expand only when evidence shows that more context is needed.
2. **Every read must have a purpose.** A file may be read when it will be modified, cited, used to understand a dependency or contract, or needed to validate the change. Avoid broad exploratory reading without a concrete question.
3. **Prefer targeted discovery.** Use `rg`, `rg --files`, or narrow path filters before opening full files. Avoid `find`, `ls -R`, and `tree` when a targeted query can answer the same question.
4. **Treat configuration and tests as on-demand context.** Read them when behavior, dependencies, build tooling, types, validation, or regressions may depend on them; do not read them by default for unrelated tasks.
5. **Use a five-file initial context budget, not a hard cap.** If more files are necessary, continue without asking when the reason is evident; briefly state why the scope expanded. Ask only when expansion reveals material ambiguity or risk.
6. **Read the smallest relevant range first.** Open the exact symbol, section, or surrounding lines. Expand to the full file only when local context is insufficient.
7. **Avoid redundant reads.** Reuse already captured context, but re-read changed files or precise sections when verification, concurrent edits, or uncertainty makes it useful.
8. **Scale planning to the task.** For small, low-risk changes, give a one-sentence plan and execute. For larger or riskier work, provide concise progress updates without narrating routine tool calls.
9. **Preserve system capability.** Token efficiency must never prevent root-cause analysis, security review, contract tracing, implementation, or proportionate verification. Correctness and safety take priority over the initial context budget.
10. **Stop expanding when evidence is sufficient.** Do not keep exploring once the requested outcome can be implemented and verified confidently.
11. **No Unauthorised Subagents**: Never spawn subagents or invoke multiple parallel agent instances without express user consent.

***

## Project Structure & Module Organization

MaTE X is a desktop security review agent for local repositories.

### Platform Policy

- **macOS** (Intel + Apple Silicon) is the primary development, founder-testing, optimization, and initial release platform.
- **Windows** 10+ remains architecturally supported but is qualified in a separate, later compatibility phase and must not block the current macOS workflow.
- **Linux** is out of scope.

### Code & Directory Structure

- **Production Code**: Belongs only under `src/`. No test harness, fake adapter, fixture, generated evidence, test IPC, or qualification module may ship in the production bundle.
- **Unit/integration tests**: Co-located as `*.test.ts(x)` beside production modules under `src/`, or under `tests/` helpers. Fake adapters live only under `tests/helpers/`.
- **Qualification Layer**: Packaged, platform, migration, and performance qualification belongs under `qa/`.
- **Release Automation**: Release automation belongs under `scripts/release/`.
- **Ignored Artifacts**: Generated artifacts and local reports must remain gitignored (`artifacts/`, `out/`).

**Directory map — use this as the first routing reference:**

| Path | Purpose |
| --- | --- |
| `src/electron/` | Main-process: services, IPC handlers, Git integration, Rainy orchestration |
| `src/features/` | Renderer features |
| `src/contracts/` | Shared TS contracts/interfaces |
| `src/services/` | Service facades |
| `src/store/` | Zustand stores |
| `src/lib/` | Helpers and utilities |
| `src/components/ui/` | UI primitives |
| `src/main.ts` | Main-process entry point |
| `src/preload.ts` | Preload script entry |
| `src/renderer.tsx` | Renderer entry point |
| `tests/helpers/` | Non-production test doubles (e.g. fake agent adapters) |
| `qa/` | Packaged, platform, migration, and performance qualification layer |
| `scripts/release/` | Release automation and package verification |

**Rule:** If this map identifies the likely location, go there first. Scan adjacent directories only when targeted evidence indicates the symbol or dependency lives elsewhere.

***

## Ignore by Default

```text
node_modules/
dist/
.next/
out/
target/
*.lock
*.log
*.map
*.d.ts (generated)
coverage/
.git/
```

Do not glob-read these paths. Access a specific file only when the task explicitly requires generated output, dependency internals, build artifacts, or Git metadata and no safer source can answer the question. Never expose secrets or ingest large generated files into context.

***

## Build, Verification & Release Commands (Reference Only — Do Not Run Unless Asked)

**Runtime rule:** Use Bun only. Do not use `npm`, `pnpm`, `yarn`, or `npx` for installs, scripts, package execution, dependency changes, or lockfile updates. If `bun` is not on `PATH`, use the local Bun binary (for example `~/.bun/bin/bun`).

### Primary Verification Workflows

- **`bun run test:fast`**
  - **Purpose**: Runs fast unit tests on core contracts, helpers, and electron business logic.
  - **Command**: `bun test src/contracts src/lib src/electron/engineering --timeout 60000`
  - **Audience**: Normal contributors run this locally during rapid feature development iteration.

- **`bun run verify`**
  - **Purpose**: Comprehensive workspace verification (lint, typecheck, package config check, legacy terms check, bundle purity checks, and running all tests).
  - **Command**: `bun run lint && bun run typecheck && bun run test:all && bun run verify:package-config && bun run verify:legacy-terms && bun run verify:bundle-purity`
  - **Audience**: Executed automatically on PR validation / CI, and must be run locally before committing PRs.

- **`bun run verify:release`**
  - **Purpose**: Full release qualification (runs `verify`, packages the app locally, verifies the packaged bundle's ASAR integrity, and executes packaged E2E test runs).
  - **Command**: `bun run verify && bun run package && bun run scripts/release/verify-bundle-purity.ts --require-asar && bun run scripts/release/run-packaged-e2e.ts`
  - **Audience**: Release maintainers before publishing new versions.

### Reference Scripts

```bash
bun install          # install deps from bun.lock
bun run start        # Electron Forge + Vite dev app
bun run lint         # ESLint on *.ts / *.tsx
bun run typecheck    # tsc --noEmit
bun run package      # local packaged build
bun run make         # distributables via Electron Forge
bun run publish      # Electron Forge publish; release workflow only
bun run test         # bun test src
bun run test:all     # bun test src qa
bun run test:qa      # bun test qa
```

**Quality & CI Rules:**

- Never increase global timeouts or reduce fixtures only to satisfy a slow CI host.
- Platform-specific accommodations must remain inside that platform’s QA layer.

***

## Coding Style & Naming Conventions

- **TypeScript** with React 19.2.7, Electron 43.1.0, Tailwind CSS v4 (specifically 4.3.2). All versions must match `package.json` exactly.
- **Tailwind CSS v4 Themes**: Use pure CSS `@import` to modularize themes in `src/styles/themes/`. Always register custom variants via `@custom-variant` in `index.css` to avoid Vite transformation errors.
- **Icons**: `lucide-react` and `@phosphor-icons/react` are strictly FORBIDDEN. You MUST use `@hugeicons/react` and `@hugeicons/core-free-icons` for all icons.
- Renderer files: double quotes, trailing commas.
- Main-process files: single quotes.
- `PascalCase` for components | `camelCase` for functions/store actions | `kebab-case` for feature folders.
- IPC channels: `<domain>:<action>` e.g. `repo:run-assistant`.

***

## Testing Guidelines

- Prefer co-located `*.test.ts(x)` next to the module under test in `src/`.
- Shared test doubles (e.g. fake agent adapters) belong under `tests/helpers/` only — never in production runtime paths.
- Packaged, platform, migration, and performance qualification belongs under `qa/`.
- Minimum: lint + typecheck on every change; use `bun run test:fast` during iteration and `bun run verify` before release.

***

## Commit & Pull Request Guidelines

- Conventional Commits: `type(scope): summary` e.g. `feat(settings): ...`, `refactor(api): ...`.
- PRs must explain user-visible changes, note IPC/settings impact, link the related issue, include screenshots for UI changes.

***

## Changelog Rules

Follow `RULES.md` exactly. Every new entry:

```text
# Unreleased - YYYY.MM.DD (N) [Entry Name]
```

Date zero-padded. `(N)` = daily sequence number. `[Entry Name]` required.

***

## Code Cleanliness

"Leave it better than you found it." Resolve all issues in files you touch. No broken windows, no half-finished work, no accumulated debt in modified files.

**Modularization First:** New code must be highly modular and maintainable. Keep files focused, extract reusable helpers/components/services early, avoid large mixed-responsibility files, and split growing pages or APIs before they become difficult to review.

***

## UI & Shell Design Rules

- Settings live inside the same app shell — never a separate mini-app, modal, or detached chrome.
- Reuse `DesktopShell`, main sidebar, and topbar/titlebar. Swap content, not the shell.
- Sidebar branding: `MaTE X` with `ALPHA` pill. Do not introduce alternate branding.
- Route-driven subsections: `/settings/<section>`.
- T3 Code density: compact sidebar nav, 52px titlebar rhythm, restrained settings sections, no marketing hero blocks inside product settings.

### Glass, Blur & Window Materials (MANDATORY)

MaTE X uses **CSS-only glass**. Native window materials are permanently disabled.

1. **No native mica / acrylic / vibrancy**
   - Never enable Electron `vibrancy`, Windows `backgroundMaterial: 'mica'`, or similar OS materials for product surfaces.
   - Window backing stays opaque (`#ffffff` light / `#111111` dark). Clear leftover native materials via `src/electron/window-appearance.ts`.
   - Rationale: native under-window blur cannot sample DOM content and fights CSS `backdrop-filter`, washing out inputs and nested chrome.

2. **Two independent settings**
   - **`blurEnabled` (Interface blur)** — toggles `:root.blur-enabled`. Applies premium glass to inputs, selects, menus, dialogs, tooltips, composer, and other control/overlay surfaces. Live preview via `useTheme().setBlurEnabled`; persist in app settings.
   - **`vibrancyMode` (Transparency Mode)** — layout chrome only: `solid` | `sidebar` | `special`. Does **not** force `blurEnabled` on or off.
   - Do not couple these again. Layout glass and control glass are separate products of the two switches.

3. **Single-layer `backdrop-filter` rule**
   - Apply `backdrop-filter` only on the **leaf surface** that should look like glass.
   - **Never** put `backdrop-filter` on layout ancestors that wrap other glass or form controls (especially `.app-main-content-container`). Nested filters collapse in Chromium and make children look fully transparent.
   - Main content must remain filter-free. Ambient mesh (`.app-ambient`) provides blur sample content when layout glass is on.

4. **Tokens & utilities (source of truth)**
   - Theme tokens in `src/styles/themes/base.css` / `dark.css`: `--glass-blur`, `--control-glass-blur`, `--overlay-glass-blur`, `--glass-tint*`, `--control`, `--glass-bg`, ambient vars.
   - Utilities / global rules in `src/index.css`: `.glass`, `.glass-strong`, `.mate-glass-float`, `.control-surface`, and `:root.blur-enabled [data-slot=…]` selectors.
   - Prefer `data-slot` hooks (`input-control`, `textarea-control`, `select-trigger`, `select-content`, `menu-popup`, `popover-popup`, `dialog-popup`, etc.) over scattering one-off `backdrop-blur-*` classes.
   - When blur is **off**, force solid fills and `backdrop-filter: none` on those surfaces.

5. **Flat canvas + elevated controls**
   - Default app canvas is pure **`#ffffff` (light)** and **`#111111` (dark)** for `background`, `sidebar`, `panel`, `titlebar`, `surface`, `card`, and `popover`.
   - Exception: inputs, selects, composer, menus, dialogs use elevated `--control` (`#f2f3f5` light / `#1a1a1a` dark) so they read on the flat canvas.
   - When Interface blur is on, elevated surfaces use refined glass (`--control-glass-blur` ~14px, overlays `--overlay-glass-blur` ~18px). Never make inputs pure transparent with no fill.

6. **Performance & Glass Motion Rules (STRICT)**
   - **No `scale` animations over `backdrop-filter`**: NEVER animate `scale` on an element or container while `backdrop-filter` is active (e.g., popovers, dropdown selectors, glass card staggers). Bounding-box scaling forces Chromium to re-sample and re-rasterize heavy blur buffers on every single frame, causing severe popup open delay and render lag.
   - **Glass Entrance Motion**: Use `opacity` + subtle translation (`translate-y-[-2px]` or `y: 6`) only (NO scale). Dropdown popups must use fast `150ms` `transition-[opacity,transform]` with `translate-y-[-2px]` instead of `scale-[0.98]`.
   - **Blur Radius Limits**: Keep control glass blur at `14px` (`--control-glass-blur: 14px`) and overlay glass blur at `18px` (`--overlay-glass-blur: 18px`). High blur radii (28–30px) trigger expensive GPU composite passes.
   - **GPU Layer Isolation**: Always apply `transform: translateZ(0)` and `isolation: isolate` to floating glass surfaces (`.mate-glass-float`, popovers) so GPU compositor treats them as isolated layers.
   - Do **not** animate `backdrop-filter`. Animate only `transform` and `opacity`.
   - Respect `prefers-reduced-motion` (lower blur radii already wired in `index.css`).
   - Keep blur opt-in (`blurEnabled` default false) for low-power machines.

***

## User Design & Aesthetic Preferences

**MANDATORY: Follow these rules for all UI-related tasks to maintain a premium, cohesive aesthetic:**

1. **Ultra-Minimalist & Flat**: Avoid heavy box-shadows. Prefer "flat" designs where boundaries are defined by borders (`border-border/70`) or subtle background differences rather than depth. Prefer `shadow-none` on product chrome.
2. **Organic Rounding**: Avoid `rounded-md` or `rounded-xl` for main containers. Use "super rounded" shapes:
    - **Main Input/Panels**: `rounded-[32px]`
    - **Cards/Popovers/Tooltips**: `rounded-2xl`
    - **Buttons**: `rounded-full` or `rounded-xl` depending on context.
    - **NEVER** use full capsule shapes for rectangular inputs unless explicitly asked.
3. **Transparency & Glassmorphism**:
    - CSS glass only — see **Glass, Blur & Window Materials** above. No mica/native vibrancy.
    - Layout sections may use `bg-transparent` over ambient/theme flow; main content must stay readable (high-opacity or solid), never a full-tree `backdrop-filter`.
    - Floating chrome (composer, menus, dialogs): use `mate-glass-float` / overlay glass tokens when `blurEnabled`, solid `bg-panel` / `bg-popover` when off.
    - Do not reintroduce ad-hoc `bg-panel/70 backdrop-blur-2xl` stacks that nest under another filter.
4. **Seamless Integration**:
    - Eliminate visual "cuts" or solid blocks behind floating elements.
    - Match `max-width` and `padding` between related components (e.g., Message Stream and Composer) to maintain a unified vertical column.
    - Composer prefers a "narrow" minimalist look: `max-w-[820px]` in non-compact mode.
5. **Theme-Aware Contrast**:
    - Never use hardcoded light/dark inverse colors (like `bg-foreground` for tooltips).
    - Always use theme variables: `bg-[var(--panel)]`, `bg-mate-control-bg`, `text-foreground`, `border-[var(--panel-border)]/40`.
6. **Snappy & Fluid Transitions**:
    - Avoid slow, sluggish, or purely linear CSS transitions (e.g., `ease-linear`).
    - Prefer `duration-150`–`duration-[250ms]` with `ease-[cubic-bezier(0.2,0.8,0.2,1)]` for interactive UI.
    - For `framer-motion`, use snappy, properly-damped springs (e.g., `damping: 25, stiffness: 400`). Avoid bouncy or aggressive y-axis translations on hover; use subtle scaling instead (`scale: 1.01`).
    - Prefer transform + opacity only; never transition `backdrop-filter` or large layout properties for routine hover/open.
    - Motion must be interruptible and reduced-motion aware.
7. **Cards & Data Panels**:
    - Always use `border-border/70` and `shadow-none` for `Card` components to maintain the flat, minimalist aesthetic.
    - Leverage scrollable constraints (`min-h-0`, `flex-1`) combined with `ScrollArea` to construct clean layouts without stretching the entire view.
    - Prevent horizontal overflow gracefully: always apply `break-all` and `break-words` on typography displaying dynamic data, long text, JSON, or hashes.
    - Use uppercase, tracking-wider, `text-[10px]` typography for section labels, metric headers, or minor tags (`text-muted-foreground/70`).
8. **Component Composition & Context**:
    - Avoid redundant scrollbars. Do not add `overflow-y-auto` to `DropdownMenuContent` wrappers if the underlying primitive already manages scrolling.
    - Expose active context (like selected models or settings) directly on the trigger button (using subtle dividers like `h-3 w-px bg-border/60`) so users do not have to open menus just to see their current selection.

***

## Security & Configuration

- Never hardcode Rainy credentials. Never commit `.env` data.
- User provides their own Rainy API v3 key via Settings — resolved in main process.
- Security-sensitive logic stays in `src/electron/`.
- Validate all IPC inputs.
- Update `src/contracts/` whenever payloads change.
- **Data Normalization**: When adding new allowed values to settings or contracts (e.g., new themes in `src/contracts/settings.ts`), you MUST update the corresponding normalization logic in `src/electron/turso-service.ts` (e.g., `normalizeAppSettings`) so the database does not reject or overwrite the new valid values.
- **No Product Boxing / Product-Grade Classification**: MaTE X analyzes arbitrary third-party repositories, not only this repo. Never hardcode MaTE-specific paths, filenames, fixtures, scanner internals, or repository assumptions into analysis logic unless the code explicitly gates them to MaTE X self-diagnostics. Tools must use strong semantic classification, not generic checklist behavior: identify framework, runtime surface, trust boundaries, data flow, environment, source role (runtime code, docs, tests, examples, generated files, scanner rules), and evidence confidence. Keep active findings separate from reference signals so real user repositories are not misreported, while still using every available semantic signal to produce specific, high-quality analysis and fixes.
- Optimize: security first, then responsiveness and low overhead.
- Avoid platform regressions on macOS x86/ARM and Windows 10+.

***

## Compliance & Attestations

- Every completed agent run may create local compliance artifacts under `.mate-x/evidence/<taskId>/`.
- Evidence Pack attestations use in-toto Statement v1 with SLSA provenance predicates and local Ed25519 signing keys.
- Agent Run Identity is local-first and persisted under `.mate-x/config/agent-identity.json`; never send it to Rainy API or any report sink without explicit user consent.
- Evidence Packs, attestations, compliance ZIPs, manifests, and Agent Runbooks must include `agentIdentity` when available.
- Compliance ZIPs must include `evidence-pack.json`, `attestation.intoto.json`, `compliance-report.pdf`, `audit-log.json`, `policy-applied.md`, `agent-runbook.json`, `agent-runbook.md`, and `manifest.json`.
- Privacy Firewall gates signing trust. Never sign or export sensitive raw secret payloads as trusted evidence.
- Policy hashes must derive from relevant local policy sources such as `AGENTS.md` and `RULES.md`; keep hashes stable and deterministic.

***

## Architecture Constraints & Governance

- **System Scope**: MaTE X is not an IDE and must expose no separate user-facing workflow engines.
- **Workflow Authority**: `EngineeringTask` is the canonical workflow authority.
- **Behavior Modes**: Auto, Guided, Review, and Custom control autonomy only; they are not workflow engines. Auto is default.
- **Scoped Auto Policy**: Auto means scoped autonomy, never unrestricted or Full access. Safe workspace-local reads, edits, patches, and validation may run automatically.
- **Distinct Tool Policies**: Behavior modes map to distinct canonical tool policies: `auto_scoped`, `guided_approval`, `review_read_only`, and `custom`.
- **Repository Boundary**: Every tool authorization must enforce the active workspace boundary and repository trust state. Writes outside the active workspace require explicit approval.
- **Git Authorization**: Git writes, including commit and push, always require explicit user authorization in every behavior mode.
- **Validation Autonomy**: Safe repository-local lint, typecheck, test, and build commands may run automatically when policy and trust permit them.
- **Policy Consistency**: Behavior mode and repository trust must never conflict silently. A required approval must produce a concise reason and resume the same EngineeringTask and run context.
- **Evidence Before Questions**: Inspect repository evidence first. Ask only for material ambiguity, risk, credentials, destructive action, or required approval. Internal specification and planning are never mandatory UI ceremony.
- **Conversational Projection**: Project workflow state through compact status, inline activity, optional task details, and concise results. Large persistent workflow cards are prohibited in primary conversation.
- **Action Integrity**: Every visible CTA must match canonical state and have a real handler. Never show duplicate or already-running actions.
- **Development Loop**: macOS is current primary founder-testing platform. `bun run start` is the normal UX iteration loop when explicitly requested by the user. Agents MUST NOT run `bun run start` autonomously: it launches an Electron instance and may create a second visible app window alongside an existing instance. Packaging is reserved for release qualification.
- **Runtime Purity**: Test and QA infrastructure must remain outside production runtime.
- **Spec & Git Constraints**: No prompt-as-spec, regex stage authority, renderer Git authorization, or model-generated evidence.
- **Self-Correction Policy**: `AGENTS.md` must be updated whenever behavior modes, workflow authority, architecture, test organization, platform policy, release commands, or canonical namespaces change.

***

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:

- Product ideas, "is this worth building", brainstorming -> invoke office-hours
- Bugs, errors, "why is this broken", 500 errors -> invoke investigate
- Ship, deploy, push, create PR -> invoke ship
- QA, test the site, find bugs -> invoke qa
- Code review, check my diff -> invoke review
- Update docs after shipping -> invoke document-release
- Weekly retro -> invoke retro
- Design system, brand -> invoke design-consultation
- Visual audit, design polish -> invoke design-review
- Architecture review -> invoke plan-eng-review
- Save progress, checkpoint, resume -> invoke checkpoint
- Code quality, health check -> invoke health
