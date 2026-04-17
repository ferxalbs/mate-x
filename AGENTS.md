# Repository Guidelines

## Project Structure & Module Organization

MaTE X is a desktop security review agent for local repositories. Changes should preserve grounded analysis, strict IPC boundaries, and fast local execution. Target platforms are macOS on Intel and Apple Silicon plus Windows 10+; Linux is out of scope. `src/electron/` contains main-process services, IPC handlers, Git integration, and Rainy orchestration. `src/features/` holds renderer features. Shared contracts live in `src/contracts/`, service facades in `src/services/`, Zustand stores in `src/store/`, helpers in `src/lib/`, and UI primitives plus colocated tests in `src/components/ui/`. Entry points are `src/main.ts`, `src/preload.ts`, and `src/renderer.tsx`.

## Build, Test, and Development Commands

Use Bun for local work:

- `bun install`: install dependencies from `bun.lock`.
- `bun run start`: launch the Electron Forge development app with Vite.
- `bun run lint`: run ESLint on all `.ts` and `.tsx` files.
- `bun run typecheck`: run TypeScript without emitting files.
- `bun run package`: create a local packaged app build.
- `bun run make`: build distributables with Electron Forge.

Run `bun run lint && bun run typecheck` before opening a PR.

## Coding Style & Naming Conventions

The codebase uses TypeScript with React 19, Electron 41, and Tailwind CSS v4. Follow the existing file style: renderer files usually use double quotes and trailing commas, while main-process files favor single quotes. Use `PascalCase` for components, `camelCase` for functions and store actions, and `kebab-case` for feature folders. IPC channels follow `<domain>:<action>` such as `repo:run-assistant`.

## Testing Guidelines

There is no dedicated `test` script yet. Existing tests are colocated as `*.test.ts` and `*.test.tsx`, for example `src/components/ui/sidebar.test.tsx`. Keep new tests near the code they exercise and prefer focused unit coverage for UI logic, stores, and helpers. At minimum, verify linting and type-checking on every change.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit prefixes such as `feat(settings): ...`, `refactor(api): ...`, and `chore(main): ...`. Continue using `type(scope): summary`. PRs should explain user-visible changes, note any IPC or settings impact, link the related issue when available, and include screenshots for UI updates.

## Changelog Rules

If you touch changelog content, follow `RULES.md` exactly. Every new entry header must use `# Unreleased - YYYY.MM.DD (N) [Entry Name]`, where the date is zero-padded, `(N)` is the daily sequence number, and `[Entry Name]` is required.

## Code Cleanliness & Repository Hygiene

Regardless of the source of changes, all identified issues in touched files must be resolved to ensure the codebase remains clean. If a task involves files that were previously modified or contain existing issues, you are responsible for addressing those issues as part of your work. Maintain a "leave it better than you found it" philosophy: no broken windows, no half-finished work, and no accumulated technical debt in the files you modify.

## UI & Shell Design Rules

For desktop shell work, preserve a single continuous app chrome. Follow the T3 Code pattern already validated in this repo work:

- Settings must live inside the same app shell, not as a separate mini-app, detached page chrome, modal, or replacement sidebar system.
- Reuse the existing `DesktopShell`, main sidebar, and topbar/titlebar structure. When entering settings, swap the sidebar content and main panel content, but keep the shell itself intact.
- The sidebar header branding should stay consistent with the main app. Use `MaTE X` with the existing `ALPHA` pill styling; do not introduce alternate branding such as `T3`.
- Prefer route-driven subsection changes like `/settings/<section>` while keeping the same shell mounted.
- Match T3 Code density and spacing: compact sidebar nav, 52px titlebar/header rhythm, restrained settings sections, and no marketing-style hero blocks inside product settings.
- Do not create a visually separate “settings experience” unless explicitly requested. The correct default is same shell, different content.

## Security & Configuration Tips

Do not hardcode Rainy credentials or commit `.env` data. This app is only the container: the user brings their own Rainy API v3 key from the Rainy platform or dashboard, enters it through Settings, and the key is then resolved in the Electron main process. Because this app is a security reviewer, optimize for security first, then responsiveness and low overhead on supported desktop targets. Keep security-sensitive logic in `src/electron/`, validate IPC inputs, avoid platform-specific regressions on macOS x86/ARM and Windows 10+, and update `src/contracts/` whenever payloads change.
