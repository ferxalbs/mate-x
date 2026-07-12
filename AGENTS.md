# Repository Guidelines — MaTE X

## Token Budget Rules (MANDATORY — Read First)

**You are operating under a strict token budget. Follow these rules before every action:**

1. **Read only what the task explicitly requires.** Do not explore the repo to "understand context." If you need a file, name it in the task.
2. **Never read a file you will not modify or directly reference.** Curiosity reads are forbidden.
3. **Do not run `find`, `ls -R`, `tree`, or any recursive directory listing** unless the task is explicitly about the file system.
4. **Do not read `package.json`, `tsconfig.json`, `vite.config.ts`, or similar config files** unless the task directly involves them.
5. **Do not read test files** unless the task is to write or fix tests.
6. **Max 5 files read per task.** If you think you need more, stop and ask for clarification.
7. **Use `grep`/`rg` with exact patterns** instead of reading full files to locate symbols or imports.
8. **Never re-read a file you already loaded in the same session.**
9. **Summarize what you will read and why before reading anything.** Format: "Reading X because Y."
10. **If the task is 20 lines of change or fewer, confirm your plan in one sentence before executing.**

***

## Project Structure & Module Organization

MaTE X is a desktop security review agent for local repositories.

### Platform Policy

- **macOS** (Intel + Apple Silicon) is the primary development, founder-testing, optimization, and initial release platform.
- **Windows** 10+ remains architecturally supported but is qualified in a separate, later compatibility phase and must not block the current macOS workflow.
- **Linux** is out of scope.

### Code & Directory Structure

- **Production Code**: Belongs only under `src/`. No test harness, fake adapter, fixture, generated evidence, test IPC, or qualification module may ship in the production bundle.
- **Tests**: Belongs only under `tests/`.
- **Qualification Layer**: Packaged, platform, migration, and performance qualification belongs under `qa/`.
- **Release Automation**: Release automation belongs under `scripts/release/`.
- **Ignored Artifacts**: Generated artifacts and local reports must remain gitignored.

**Directory map — memorize this, do not re-read it:**

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
| `tests/` | Unit, integration, and contract tests |
| `qa/` | Packaged, platform, migration, and performance qualification layer |
| `scripts/release/` | Release automation and package verification |

**Rule:** If you already know where a symbol lives from this map, go directly to that file. Do not scan adjacent directories.

***

## Always Ignore — Never Read These

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

Do not glob-read or stat these paths for any reason.

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
- Renderer files: double quotes, trailing commas.
- Main-process files: single quotes.
- `PascalCase` for components | `camelCase` for functions/store actions | `kebab-case` for feature folders.
- IPC channels: `<domain>:<action>` e.g. `repo:run-assistant`.

***

## Testing Guidelines

- Tests belong under `tests/`.
- Packaged, platform, migration, and performance qualification belongs under `qa/`.
- New tests: unit coverage for UI logic, stores, and helpers under `tests/`.
- Minimum: lint + typecheck on every change.

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

***

## User Design & Aesthetic Preferences

**MANDATORY: Follow these rules for all UI-related tasks to maintain a premium, cohesive aesthetic:**

1. **Ultra-Minimalist & Flat**: Avoid heavy box-shadows. Prefer "flat" designs where boundaries are defined by borders (`border-border/70`) or subtle background differences rather than depth.
2. **Organic Rounding**: Avoid `rounded-md` or `rounded-xl` for main containers. Use "super rounded" shapes:
    - **Main Input/Panels**: `rounded-[32px]`
    - **Cards/Popovers/Tooltips**: `rounded-2xl`
    - **Buttons**: `rounded-full` or `rounded-xl` depending on context.
    - **NEVER** use full capsule shapes for rectangular inputs unless explicitly asked.
3. **Transparency & Glassmorphism**:
    - Use `bg-transparent` for main layout sections (e.g., `home-page.tsx` section) to allow theme backgrounds to flow.
    - Use semi-transparent backgrounds for panels: `bg-[var(--panel)]/92` combined with `backdrop-blur-xl` and `glass` utility.
4. **Seamless Integration**:
    - Eliminate visual "cuts" or solid blocks behind floating elements.
    - Match `max-width` and `padding` between related components (e.g., Message Stream and Composer) to maintain a unified vertical column.
    - Composer prefers a "narrow" minimalist look: `max-w-[820px]` in non-compact mode.
5. **Theme-Aware Contrast**:
    - Never use hardcoded light/dark inverse colors (like `bg-foreground` for tooltips).
    - Always use theme variables: `bg-[var(--panel)]`, `text-foreground`, `border-[var(--panel-border)]/40`.
6. **Snappy & Fluid Transitions**:
    - Avoid slow, sluggish, or purely linear CSS transitions (e.g., `ease-linear`).
    - Use fast, elegant, Apple-style animations that feel fluid and highly responsive.
    - Prefer short durations like `duration-[250ms]` paired with snappy easing functions such as `ease-[cubic-bezier(0.2,0.8,0.2,1)]` for interactive elements like sidebars and menus.
7. **Cards & Data Panels**:
    - Always use `border-border/70` and `shadow-none` for `Card` components to maintain the flat, minimalist aesthetic.
    - Leverage scrollable constraints (`min-h-0`, `flex-1`) combined with `ScrollArea` to construct clean layouts without stretching the entire view.
    - Prevent horizontal overflow gracefully: always apply `break-all` and `break-words` on typography displaying dynamic data, long text, JSON, or hashes.
    - Use uppercase, tracking-wider, `text-[10px]` typography for section labels, metric headers, or minor tags (`text-muted-foreground/70`).

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

- **System Scope**: MaTE X is not an IDE and must expose no user-facing modes.
- **Workflow Authority**: `EngineeringTask` is the canonical workflow authority.
- **Spec & Git Constraints**: No prompt-as-spec, regex stage authority, renderer Git authorization, or model-generated evidence.
- **Self-Correction Policy**: `AGENTS.md` must be updated whenever architecture, test layout, platform policy, release commands, or canonical namespaces change.

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
