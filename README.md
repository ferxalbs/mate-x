<p align="center">
  <img src="assets/matex-banner.png" alt="MaTE X" />
</p>

<p align="center">
  <strong>The trust layer for AI-written code.</strong><br/>
  Keep your coding agent. MaTE X verifies what it changed and blocks unproven changes before they reach production.
</p>

<p align="center">
  <a href="https://github.com/ferxalbs/mate-x/releases"><img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-171717?labelColor=171717&color=0ea5e9"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MaTE%20X%20Licence-171717?labelColor=171717&color=0ea5e9"></a>
  <a href="https://mate-x.xyz"><img alt="Website" src="https://img.shields.io/badge/website-mate--x.xyz-171717?labelColor=171717&color=10b981"></a>
</p>

MaTE X is a source-available/OpenCore desktop application for developers who use AI coding agents. It opens a local repository, maps the real repository state, identifies changed and risky surfaces, plans proportional validation, records what actually ran, and produces a reproducible Ship Proof before commit, push, or release intent.

MaTE X is not another IDE, a generic chatbot, a model marketplace, a scanner-only dashboard, or a fully autonomous software factory. It is the verification and proof layer between AI-generated code and production.

## Product Promise

AI coding tools are fast, but model prose is not proof. MaTE X keeps the developer's existing agent while enforcing deterministic evidence:

- **Repository state**: current branch, dirty files, package manager, scripts, runtime surfaces, and trust state.
- **Changed surfaces**: touched files, runtime entry points, secrets-risk files, infrastructure, auth, billing, crypto, migrations, IPC, shell, and Git-sensitive areas.
- **Required validation**: the smallest useful plan backed by detected package manager and available scripts. MaTE X does not invent `npm run` commands.
- **Executed evidence**: commands and tools that actually ran, with passed, failed, skipped, unavailable, missing, partial, cancelled, and stale states kept visible.
- **Ship decision**: `Ready`, `Needs check`, `Risk found`, `Blocked`, or `Not proven`.

A clean working tree is not the same as a trusted repository. A model saying "ready" cannot unlock Git. Commit and push fail closed when policy requires proof.

## Factory Mode Lite

Factory Mode is a structured verification workflow, not a large autonomous DAG product:

```text
Spec -> Repo Context -> Risk Surfaces -> Validation Plan -> Agent Actions -> Verification -> Ratchet Suggestions -> Ship Proof
```

Factory and Ship mode always use approval-required access and the proof-producing verification runbook. RepoGraph semantic memory and workspace health are used before broad file reads. Ratchet rules remain suggestions and require explicit approval.

Review mode stays useful for lighter analysis without forcing the full Factory experience.

## Ship Proof

Ship Proof is the user-facing release receipt generated from deterministic run evidence. It is decision-first and includes, where available:

- final verdict;
- repository and branch;
- base commit and HEAD;
- diff identity or hash;
- changed file count;
- runtime and risk surfaces;
- validation plan;
- commands and tools actually executed;
- passed, failed, skipped, unavailable, and missing checks;
- Privacy Firewall status;
- policy stops;
- model/provider metadata;
- requested and effective service tier;
- whether commit/push is allowed;
- timestamp and proof freshness.

Evidence Pack remains the richer artifact name for compliance exports and disk bundles under `.mate-x/evidence/<taskId>/`.

## First Run

On first launch, MaTE X should be understandable without founder assistance:

1. Configure or validate a Rainy API v3 key in Settings.
2. Open a local repository.
3. Let MaTE X map repository context.
4. Review the current trust state.
5. Run the primary action: **Run Factory verification**.
6. Read the Ship Proof and any block remediation steps.

If Rainy is unavailable or credentials are missing, local repository state remains visible and cloud-backed review/verification is clearly unavailable rather than silently trusted.

## Security Model

MaTE X assumes the opened repository is hostile.

- Renderer code has no direct filesystem, shell, Git, database, or credential access.
- Privileged operations cross typed IPC channels and are validated in the main process.
- Repository content cannot override system policy, escalate permissions, execute without approval, mark itself trusted, modify evidence, bypass the Privacy Firewall, change the active workspace silently, enable Git writes, or inject arbitrary IPC messages.
- Rainy credentials are user-provided in Settings, resolved in the main process, and must not be hardcoded, logged, or exposed to the renderer.
- Raw secret payloads must not be signed or exported as trusted evidence.

## Architecture

```text
Renderer UI
  React 19, TanStack Router, TanStack Query, Zustand
        |
        | typed IPC contracts
        v
Preload boundary
        |
        v
Electron main process
  IPC handlers, validation, repository access, Git, Rainy orchestration,
  local database, Privacy Firewall, evidence generation
        |
        +--> Local repository
        +--> libSQL / Turso local state
        +--> Rainy API v3, only through main-process services
```

| Area | Path | Responsibility |
| --- | --- | --- |
| Main process | `src/electron/` | Security-sensitive services, IPC handlers, Git integration, Rainy orchestration |
| Renderer features | `src/features/` | Product UI and feature views |
| Shared contracts | `src/contracts/` | IPC payloads, settings schemas, shared TypeScript interfaces |
| Service facades | `src/services/` | Renderer-facing service wrappers |
| State | `src/store/` | Zustand stores |
| Utilities | `src/lib/` | Shared helpers |
| UI primitives | `src/components/ui/` | Reusable UI components and colocated tests |
| Entry points | `src/main.ts`, `src/preload.ts`, `src/renderer.tsx` | Electron main, preload, renderer bootstrap |

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop runtime | Electron 43 |
| Renderer | React 19 |
| Language | TypeScript 6 |
| Styling | Tailwind CSS v4 |
| Routing | TanStack Router |
| Data fetching | TanStack Query |
| State | Zustand |
| Local database | libSQL / Turso |
| Toolchain | Bun 1.3+ |
| AI backend | Rainy API v3+ |

## Requirements

- Bun 1.3+ for development.
- macOS 12+ on Intel or Apple Silicon, or Windows 10/11.
- Rainy API v3+ key configured in app Settings for cloud-backed verification.

Linux is not a supported public release target.

## Development

```bash
bun install
bun run start
```

Release verification contract:

```bash
bun run verify
```

`bun run verify` runs lint, typecheck, all Bun tests, and packaging configuration validation. Packaging commands are:

```bash
bun run package
bun run make
```

## License

MaTE X is source-available/OpenCore under the [MaTE X Licence](LICENSE). Commercial use by companies, organizations, or teams requires a separate commercial licence from Enosis Labs, Inc.

## Links

- Website: [mate-x.xyz](https://mate-x.xyz)
- Enosis Labs: [enosislabs.com](https://enosislabs.com)
- Security policy: [SECURITY.md](SECURITY.md)
