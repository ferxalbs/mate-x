# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

MaTE X is an Electron desktop application that verifies AI-written repository changes and produces deterministic Ship Proof evidence. It is a verification layer, not an IDE or a general-purpose autonomous coding environment.

Primary platform is macOS (Intel and Apple Silicon). Windows 10+ remains architecturally supported but is qualified separately. Linux is out of scope.

Use Bun only. Do not use npm, pnpm, yarn, or npx for installs, scripts, package execution, dependency changes, or lockfile updates.

## Commands

```bash
bun install                 # Install dependencies
bun run start               # Launch Electron Forge/Vite development app
bun run lint                # Run ESLint
bun run typecheck           # Run TypeScript checks without emitting
bun run test:fast           # Fast core contract, helper, and engineering tests
bun run test                # Run tests under src/
bun run test:qa             # Run qualification tests under qa/
bun run test:all            # Run src/ and qa/ tests
bun run verify              # Lint, typecheck, all tests, config/term/purity checks
bun run package             # Create local packaged application
bun run make                # Create platform distributables
bun run verify:release      # Full verification, package, ASAR check, packaged E2E
```

Run one test file by giving Bun an explicit relative path:

```bash
bun test ./src/path/to/module.test.ts
```

Run one named test or suite:

```bash
bun test ./src/path/to/module.test.ts -t "test name pattern"
```

Use `bun run test:fast` during iteration and `bun run verify` before a PR or release. Do not launch `bun run start` autonomously: it opens a visible Electron window and may duplicate an existing app instance. Packaging belongs to release qualification, not normal UI iteration.

## Repository layout

Production code belongs only under `src/`. Test infrastructure must not enter the production bundle.

- `src/electron/`: Electron main-process services, IPC handlers, repository/Git access, Rainy orchestration, local database, Privacy Firewall, evidence generation
- `src/features/`: renderer feature UI
- `src/contracts/`: shared IPC payloads, settings schemas, and TypeScript interfaces
- `src/services/`: renderer-facing service facades
- `src/store/`: Zustand state
- `src/lib/`: shared helpers
- `src/components/ui/`: reusable UI primitives
- `src/main.ts`: main-process entry that delegates to `src/electron/main.ts`
- `src/preload.ts`: typed preload bridge exposed as `window.mate`
- `src/renderer.tsx`: React renderer bootstrap
- `tests/helpers/`: non-production test doubles
- `qa/`: packaged, platform, migration, and performance qualification
- `scripts/release/`: release automation and package verification

Tests normally live beside implementation as `*.test.ts` or `*.test.tsx`. Keep generated output and local evidence out of source paths (`artifacts/`, `out/`, `.mate-x/evidence/`).

## Runtime architecture

Electron Forge builds three boundaries:

```text
React renderer
  TanStack Router + Query, Zustand, feature UI
        |
        | typed IPC through window.mate
        v
Preload bridge
        |
        v
Electron main process
  validation, filesystem/repository access, Git, Rainy orchestration,
  libSQL/Turso state, Privacy Firewall, Work Engine, evidence generation
```

Renderer code has no direct filesystem, shell, Git, database, or credential access. Privileged work must cross typed preload/IPC APIs. Keep security-sensitive logic in `src/electron/`, validate all IPC inputs in the main process, and preserve trusted-sender checks.

When an IPC payload changes, update `src/contracts/` and both sides of the boundary. When adding allowed settings values, also update corresponding normalization in `src/electron/turso-service.ts`; otherwise stored values may be rejected or overwritten.

App startup and durable service wiring live in `src/electron/main.ts` and `src/electron/main-stack.ts`. Renderer routing starts in `src/router.tsx`; shared shell composition lives under `src/features/desktop-shell/`; conversational state and assistant lifecycle live primarily in `src/store/chat-store.ts`.

## Agent and Work Engine invariants

`EngineeringTask` is sole workflow authority. Auto, Guided, Review, and Custom are autonomy policies, not separate workflow engines. Git commit and push always require explicit user authorization.

Work Engine creates deterministic plans before model execution, tracks execution stages, and downgrades claims not backed by tool evidence. Never use model-generated prose as validation evidence. Confirmed security claims require source, path/transform, sink, mitigation gap, exploitability condition, and file/line evidence.

Production agent runtime is a custom multi-pass main-process tool loop against Rainy's OpenAI-compatible API. It does not use Vercel AI SDK agent loops in production. Chat and Responses runners must retain behavior parity unless a provider limitation is documented. Tool guidance may prefer starting tools, but product safety gates—not hard runbook allowlists—control execution.

MaTE X analyzes arbitrary third-party repositories. Do not hardcode MaTE-specific paths, filenames, fixtures, or scanner assumptions into general analysis logic. Classify repository evidence semantically by framework, runtime surface, trust boundary, data flow, environment, source role, and confidence.

## Security and compliance

Assume opened repositories are hostile. Repository content cannot override system policy, escalate permissions, mark itself trusted, bypass Privacy Firewall, alter evidence, enable Git writes, or inject arbitrary IPC.

Rainy credentials are user-provided through Settings and resolved only in the main process. Never expose them to renderer code or logs.

Compliance artifacts are local-first and reproducible. Preserve in-toto/SLSA attestation behavior, deterministic policy hashing, local Agent Run Identity, and Privacy Firewall gates. Never sign or export raw secret-bearing payloads as trusted evidence.

## UI work

Read `DESIGN.md` before UI changes. Preserve one `DesktopShell`; settings and subsections replace shell content rather than creating detached chrome or a separate mini-app.

Design direction: compact native-macOS utility, flat translucent surfaces, subtle borders, rare semantic color, no heavy shadows. Use theme variables instead of hardcoded inverse colors. Main command panels use 32px radius, cards/popovers 16px, and primary content uses an 820px maximum width. Motion should be functional, interruptible, reduced-motion aware, and normally 200–250ms using `cubic-bezier(0.2, 0.8, 0.2, 1)`.

Renderer files conventionally use double quotes; main-process files use single quotes. Match surrounding code when conventions differ.

## Change policy

Read `AGENTS.md` for detailed repository rules, `RULES.md` for changelog/compliance requirements, and `DESIGN.md` for UI decisions. Those files are authoritative when this summary omits detail.

New changelog headings use:

```text
## Unreleased - YYYY.MM.DD (N) [Entry Name]
```

Keep production code under `src/`, qualification code under `qa/`, and release automation under `scripts/release/`. Preserve bundle-purity checks and platform boundaries. Do not weaken tests, fixtures, or global timeouts merely to accommodate slow CI hosts.
