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

MaTE X is a desktop security review agent for local repositories. Target platforms: macOS (Intel + Apple Silicon) and Windows 10+. Linux is out of scope.

**Directory map — memorize this, do not re-read it:**

| Path | Purpose |
|---|---|
| `src/electron/` | Main-process: services, IPC handlers, Git integration, Rainy orchestration |
| `src/features/` | Renderer features |
| `src/contracts/` | Shared TS contracts/interfaces |
| `src/services/` | Service facades |
| `src/store/` | Zustand stores |
| `src/lib/` | Helpers and utilities |
| `src/components/ui/` | UI primitives + colocated tests |
| `src/main.ts` | Main-process entry point |
| `src/preload.ts` | Preload script entry |
| `src/renderer.tsx` | Renderer entry point |

**Rule:** If you already know where a symbol lives from this map, go directly to that file. Do not scan adjacent directories.

***

## Always Ignore — Never Read These

```
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

## Build & Dev Commands (Reference Only — Do Not Run Unless Asked)

```bash
bun install          # install deps from bun.lock
bun run start        # Electron Forge + Vite dev app
bun run lint         # ESLint on *.ts / *.tsx
bun run typecheck    # tsc --noEmit
bun run package      # local packaged build
bun run make         # distributables via Electron Forge
```

Always run `bun run lint && bun run typecheck` before opening a PR.

***

## Coding Style & Naming Conventions

- **TypeScript** with React 19, Electron 41, Tailwind CSS v4.
- Renderer files: double quotes, trailing commas.
- Main-process files: single quotes.
- `PascalCase` for components | `camelCase` for functions/store actions | `kebab-case` for feature folders.
- IPC channels: `<domain>:<action>` e.g. `repo:run-assistant`.

***

## Testing Guidelines

- No dedicated `test` script yet.
- Tests colocated as `*.test.ts` / `*.test.tsx` next to the file they cover.
- New tests: unit coverage for UI logic, stores, and helpers.
- Minimum: lint + typecheck on every change.

***

## Commit & Pull Request Guidelines

- Conventional Commits: `type(scope): summary` e.g. `feat(settings): ...`, `refactor(api): ...`.
- PRs must explain user-visible changes, note IPC/settings impact, link the related issue, include screenshots for UI changes.

***

## Changelog Rules

Follow `RULES.md` exactly. Every new entry:

```
# Unreleased - YYYY.MM.DD (N) [Entry Name]
```

Date zero-padded. `(N)` = daily sequence number. `[Entry Name]` required.

***

## Code Cleanliness

"Leave it better than you found it." Resolve all issues in files you touch. No broken windows, no half-finished work, no accumulated debt in modified files.

***

## UI & Shell Design Rules

- Settings live inside the same app shell — never a separate mini-app, modal, or detached chrome.
- Reuse `DesktopShell`, main sidebar, and topbar/titlebar. Swap content, not the shell.
- Sidebar branding: `MaTE X` with `ALPHA` pill. Do not introduce alternate branding.
- Route-driven subsections: `/settings/<section>`.
- T3 Code density: compact sidebar nav, 52px titlebar rhythm, restrained settings sections, no marketing hero blocks inside product settings.

***

## Security & Configuration

- Never hardcode Rainy credentials. Never commit `.env` data.
- User provides their own Rainy API v3 key via Settings — resolved in main process.
- Security-sensitive logic stays in `src/electron/`.
- Validate all IPC inputs.
- Update `src/contracts/` whenever payloads change.
- Optimize: security first, then responsiveness and low overhead.
- Avoid platform regressions on macOS x86/ARM and Windows 10+.