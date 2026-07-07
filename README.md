<p align="center">
  <img src="assets/matex-banner.png" alt="MaTE X" />
</p>

<p align="center">
  <strong>Open-source agentic engineering cockpit.</strong><br/>
  Build with AI, inspect the run, and ship only what has proof.
</p>

<p align="center">
  <a href="https://github.com/ferxalbs/mate-x/releases"><img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-171717?labelColor=171717&color=0ea5e9"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MaTE%20X%20Licence-171717?labelColor=171717&color=0ea5e9"></a>
  <a href="https://mate-x.xyz"><img alt="Website" src="https://img.shields.io/badge/website-mate--x.xyz-171717?labelColor=171717&color=10b981"></a>
</p>

MaTE X is an open-source agentic engineering cockpit for developers using AI to build real software, not just vibe-code demos.

It is an Electron desktop application that opens a local codebase, maps repository context, classifies project surfaces, checks what an AI agent changed, surfaces risk, validates when possible, and preserves proof while keeping privileged operations inside the desktop main process.

The product is designed for repository security work, not generic chat over files. Analysis must separate runtime code from tests, docs, examples, generated files, scanner rules, and reference material so findings stay grounded in the code that can actually execute. The goal is to move security into the development loop: vibe code fast, but ship only what is proven.

MaTE X does not guarantee security, prevent every bug, or replace human review. It gives developers a cockpit for turning AI work into inspectable engineering runs: understand the task, map the repo, identify risk, validate, verify, and keep proof.

## Why MaTE X Exists

AI coding tools are fast, but real software still needs repo context, validation, reviewable actions, and a record of what happened. MaTE X packages those steps into a local-first workflow so developers can keep using strong agents without treating final prose as proof.

The goal is not another generic chat box over files. The goal is a transparent cockpit where agent work is structured, inspectable, hackable, and grounded in the repository in front of you.

## Factory Mode Lite

Factory Mode Lite converts a user task into a structured engineering run:

```text
Spec -> Repo Map -> Risk Map -> Validation Plan -> Agent Run -> Verification -> Ratchet Suggestion -> Ship Proof
```

It does not add a large new autonomous system or DAG UI. It reuses the existing MaTE X runtime: RepoGraph semantic memory, workspace health, validation planner, Trust Gate, Active Gate, Agent Trace, Privacy Firewall, Failure Memory, and evidence generation.

Factory mode starts from repo intelligence before broad file reads, requires validation planning before fix or ship claims, uses approval-required access by default, and shows missing validation honestly.

## Ship Proof

Ship Proof is the casual product name for the local proof receipt generated from a run. When proof exists, MaTE X can show:

- verdict
- touched files count
- risk surfaces
- validation commands
- passed, failed, and missing evidence
- privacy status
- whether commit or push is allowed or blocked

No proof means no green claim. When commit or push is blocked, MaTE X says why and routes back to Factory verification.

## Ratchet Rules

When a run repeatedly fails because of command, tool, package-manager, or workspace behavior, MaTE X can suggest a durable repo rule for:

- `AGENTS.md`
- `RULES.md`
- `.mate-x/rules.json`

Rules are suggestions, not automatic writes. The developer chooses whether to add the repo rule, ignore it once, or never suggest it again.

## Local-First Safety

MaTE X keeps the sensitive parts of the workflow local: repository access, shell and Git operations, local state, privacy checks, and proof artifacts stay behind the desktop boundary. Cloud model calls receive deliberately prepared context after local privacy checks.

The project is designed to be inspectable and hackable. Runtime behavior, gates, validation evidence, and proof outputs should be understandable from the local app and repository state.

## Roadmap

- Factory DAG for richer run visualization.
- OpenAI Agents SDK provider.
- Temporary preview deploys for validation and review.

## What MaTE X Does

- Shows a Trust Gate verdict for the opened repo so users can see whether AI-made changes are trusted, need validation, risky, blocked, or not proven.
- Provides a "Make it trustworthy" flow that uses existing repo intelligence, validation tools, policy stops, Agent Trace, VTS, and proof artifacts instead of inventing green status.
- Reviews local repositories for security-relevant behavior, configuration risk, dependency risk, unsafe data flow, and trust-boundary violations before they become release blockers.
- Uses semantic classification before reporting findings: framework, runtime surface, source role, environment, entry points, sinks, and evidence confidence.
- Prioritizes high-impact issues, supports scoped remediation guidance, and validates fixes with tests, traces, or evidence where available.
- Keeps file system access, Git operations, local persistence, API key lookup, and other sensitive actions in the Electron main process.
- Sends only deliberately prepared context to the Rainy API v3 backend after local privacy checks and redaction gates.
- Stores settings, run state, findings, and compliance artifacts locally.
- Produces local Ship Proof receipts for completed agent runs when proof output is available.

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
  local database, privacy gates, evidence generation
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

## Security Model

MaTE X assumes the opened repository may be untrusted.

- Renderer code never receives direct file system, shell, Git, database, or secret access.
- All privileged operations cross typed IPC channels and are validated in the main process.
- Rainy API credentials are configured by the user in Settings, resolved in the main process, and must not be hardcoded, logged, or exposed to the renderer.
- Security-sensitive logic belongs in `src/electron/`.
- IPC channels follow `<domain>:<action>`, for example `repo:run-assistant`.
- Settings schema changes must update both shared contracts and database normalization.

## Privacy And Evidence

Before repository context, tool output, workspace memory, or prompts leave the machine, MaTE X applies local privacy controls. Sensitive spans should be redacted or replaced with typed placeholders before cloud model calls. Raw secret payloads must not be signed, exported, or treated as trusted evidence.

Completed agent runs may create compliance artifacts under:

```text
.mate-x/evidence/<taskId>/
```

Evidence Pack output is local-first and may include:

- `evidence-pack.json`
- `attestation.intoto.json`
- `compliance-report.pdf`
- `audit-log.json`
- `policy-applied.md`
- `agent-runbook.json`
- `agent-runbook.md`
- `manifest.json`

Agent Run Identity is persisted locally at:

```text
.mate-x/config/agent-identity.json
```

It must not be sent to Rainy API or report sinks without explicit user consent.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop runtime | Electron 42 |
| Renderer | React 19 |
| Styling | Tailwind CSS v4 |
| Routing | TanStack Router |
| Data fetching | TanStack Query |
| State | Zustand |
| Local database | libSQL / Turso |
| Toolchain | Bun |
| AI backend | Rainy API v3+ |

## Requirements

- Bun
- macOS 12+ on Intel or Apple Silicon, or Windows 10+
- Rainy API v3+ key configured in app Settings

Linux is not a supported target.

## Development

```bash
bun install
bun run start
```

Quality gates:

```bash
bun run lint
bun run typecheck
```

Packaging:

```bash
bun run package
bun run make
```

## License

MaTE X is source-available under the [MaTE X Licence](LICENSE). Commercial use by companies or teams requires a separate commercial licence from Enosis Labs.

## Links

- Website: [mate-x.xyz](https://mate-x.xyz)
- Enosis Labs: [enosislabs.com](https://enosislabs.com)
- Security policy: [SECURITY.md](SECURITY.md)
