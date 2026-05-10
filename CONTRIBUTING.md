# Contributing to MaTE X

MaTE X is an OpenCore project maintained by [Enosis Labs](https://enosis.dev). Contributions are welcome and are governed by the [MaTE X Licence](../LICENSE).

---

## Before You Start

- **Check open issues** at [github.com/ferxalbs/mate-x/issues](https://github.com/ferxalbs/mate-x/issues) before opening a new one.
- **Security vulnerabilities** must not be disclosed publicly. Follow the process in [SECURITY.md](../SECURITY.md).
- For significant changes, open an issue first to discuss scope and design intent.

---

## Workflow

```
fork → branch → implement → lint + typecheck → PR
```

### 1. Fork and Clone

```bash
git clone https://github.com/<your-handle>/mate-x.git
cd mate-x
bun install
```

### 2. Create a Branch

Branch names should reflect the change type:

```
feat/tool-panel-resize
fix/ipc-validation-path
refactor/turso-normalization
docs/contributing-guide
```

### 3. Implement Your Changes

Follow the guidelines below. Run the app in dev mode to validate:

```bash
bun run start
```

### 4. Lint and Type-Check

Both checks must pass before submitting a PR:

```bash
bun run lint && bun run typecheck
```

### 5. Open a Pull Request

- Target the `main` branch.
- Fill in the PR template — explain the user-visible change, note any IPC or settings impact, link the related issue.
- Attach screenshots for UI changes.

---

## Coding Standards

MaTE X is TypeScript with React 19, Electron 41, and Tailwind CSS v4. The full conventions are in `AGENTS.md` at the repository root. Key rules:

| Concern | Rule |
|---|---|
| **Renderer files** | Double quotes, trailing commas |
| **Main-process files** | Single quotes |
| **Components** | `PascalCase` |
| **Functions / store actions** | `camelCase` |
| **Feature folders** | `kebab-case` |
| **IPC channels** | `<domain>:<action>` — e.g., `repo:run-assistant` |

### Process Boundary

Security-sensitive operations belong in `src/electron/`. The renderer (`src/features/`) must communicate through typed IPC channels only. Validate all IPC inputs on the main side.

### Settings and Contracts

When adding new allowed values to settings (e.g., a new theme name):

1. Update the type in `src/contracts/settings.ts`.
2. Update the normalization logic in `src/electron/turso-service.ts`.

### UI Design

- No `rounded-md` on main containers — use `rounded-[32px]` for inputs, `rounded-2xl` for cards.
- No hardcoded light/dark color inversions. Use CSS theme variables: `var(--panel)`, `var(--panel-border)`.
- No box-shadows on flat surfaces. Use border or background contrast to define edges.

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short summary in present tense

Optional body explaining the why when the change isn't self-evident.
```

Examples:

```
feat(ui): add resizable tool panel
fix(ipc): validate path inputs before fs access
refactor(turso): extract normalization helpers
docs(contributing): add UI design rules
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`.

---

## Changelog

Every merged PR requires a changelog entry in `CHANGELOG.md`. Follow the format defined in `RULES.md`:

```
# Unreleased - YYYY.MM.DD (N) [Entry Name]
```

Date zero-padded. `(N)` is the daily sequence number.

---

## Code of Conduct

Be direct, professional, and constructive. Enosis Labs reserves the right to close contributions that are off-topic, low-quality, or inconsistent with the project's direction.

---

For commercial licensing, contact [legal@enosis.dev](mailto:legal@enosis.dev).
