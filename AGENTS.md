# Repository Guidelines

## Project Structure & Module Organization

`src/electron/` contains the Electron main-process services, IPC handlers, Git integration, and Rainy API orchestration. `src/features/` holds renderer features such as the desktop shell and chat UI. Shared cross-boundary contracts live in `src/contracts/`, reusable renderer services in `src/services/`, Zustand stores in `src/store/`, and generic helpers in `src/lib/`. UI primitives and tests are mostly under `src/components/ui/`. Entry points are `src/main.ts` for Electron, `src/preload.ts` for the bridge, and `src/renderer.tsx` / `src/app.tsx` for the React app.

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

The codebase uses TypeScript with React 19, Electron 41, and Tailwind CSS v4. Follow the existing style in each file: most renderer files use double quotes and trailing commas; main-process files currently favor single quotes. Keep that local consistency instead of reformatting unrelated code. Use `PascalCase` for React components, `camelCase` for functions and Zustand actions, and `kebab-case` for feature folders. IPC channels follow `<domain>:<action>` patterns such as `repo:run-assistant`.

## Testing Guidelines

There is no dedicated `test` script yet. Existing tests are colocated as `*.test.ts` and `*.test.tsx`, for example `src/components/ui/sidebar.test.tsx`. Keep new tests near the code they exercise and prefer focused unit coverage for UI logic, stores, and helper modules. At minimum, verify linting and type-checking on every change.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit prefixes such as `feat(settings): ...`, `refactor(api): ...`, and `chore(main): ...`. Continue using `type(scope): summary` with small, reviewable commits. PRs should explain user-visible changes, note any IPC or settings impact, link the related issue when available, and include screenshots or short recordings for renderer/UI updates.

## Security & Configuration Tips

Do not hardcode Rainy credentials or commit `.env` data. API keys are stored through the settings flow and resolved in the Electron main process. Keep security-sensitive logic grounded in `src/electron/` and update shared contracts in `src/contracts/` whenever IPC payloads change.
