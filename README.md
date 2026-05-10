<p align="center">
  <img src="assets/matex.png" width="96" alt="MaTE X" />
</p>

<h1 align="center">MaTE X</h1>

<p align="center">
  <strong>AI-powered security review agent for local repositories.</strong><br/>
  Built by <a href="https://enosis.dev">Enosis Labs</a>.
</p>

<p align="center">
  <a href="https://github.com/ferxalbs/mate-x/releases"><img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-171717?labelColor=171717&color=6d28d9"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MaTE%20X%20Licence-171717?labelColor=171717&color=0ea5e9"></a>
  <img alt="CodeRabbit" src="https://img.shields.io/coderabbit/prs/github/ferxalbs/mate-x?utm_source=oss&utm_medium=github&utm_campaign=ferxalbs%2Fmate-x&labelColor=171717&color=FF570A&label=CodeRabbit+Reviews">
  <a href="https://mate-x.xyz"><img alt="Website" src="https://img.shields.io/badge/website-mate--x.xyz-171717?labelColor=171717&color=10b981"></a>
</p>

---

MaTE X is a desktop security review agent for local repositories. It provides grounded, evidence-backed analysis of codebases with a strict focus on security, local execution, and native desktop integration. Researchers and developers use it to audit dependencies, trace data flows, detect vulnerabilities, and generate validated patches — without sending raw source code to untrusted endpoints.

## Architecture

MaTE X is an Electron desktop application with a clean process boundary:

| Layer | Description |
|---|---|
| **Main process** (`src/electron/`) | Security-sensitive logic: file I/O, Git integration, IPC validation, Rainy orchestration, local database |
| **Renderer** (`src/features/`) | React 19 UI — communicates with main exclusively through typed IPC channels |
| **Contracts** (`src/contracts/`) | Shared TypeScript interfaces defining IPC payloads and settings schemas |
| **Persistence** (`libSQL / Turso`) | Local embedded database for session state, findings, and configuration |

All sensitive operations — including file system access, Git commands, and API key resolution — are validated and executed in the main process. The renderer has no direct access to system resources.

### MaTE X Privacy

Before transmitting any repository context, tool outputs, workspace memory, or prompts to a cloud model, MaTE X Privacy scans the payload locally using deterministic secret-detection rules and an ONNX classification model. Sensitive spans are replaced with typed placeholders; originals are encrypted in a local vault. Cloud models receive enough structure to reason over the codebase, but never the raw secrets.

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | [Electron 41](https://www.electronjs.org/) |
| Frontend | [React 19](https://react.dev/) + [Tailwind CSS v4](https://tailwindcss.com/) |
| State | [Zustand](https://zustand-demo.pmnd.rs/) |
| Routing | [TanStack Router](https://tanstack.com/router) |
| Data Fetching | [TanStack Query](https://tanstack.com/query) |
| Local Database | [libSQL / Turso](https://turso.tech/) |
| Toolchain | [Bun](https://bun.sh/) |
| AI Backend | [Rainy API v3](https://mate-x.xyz) |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (latest)
- macOS 12+ (Intel or Apple Silicon) or Windows 10+
- A Rainy API v3 key — obtain one at [mate-x.xyz](https://mate-x.xyz)

### Installation

```bash
git clone https://github.com/ferxalbs/mate-x.git
cd mate-x
bun install
```

### Configuration

Launch the app and navigate to **Settings** to enter your Rainy API v3 key. Keys are stored locally in the main process and are never transmitted to the renderer or logged.

### Development

```bash
bun run start
```

### Production Build

```bash
# Packaged app (current platform)
bun run package

# Distributable artifacts (DMG, EXE)
bun run make
```

## Development Guidelines

- **Linting**: `bun run lint`
- **Type checking**: `bun run typecheck`
- **Commits**: Conventional Commits — `type(scope): summary` (e.g., `feat(ui): add diff viewer`)
- **IPC channels**: `<domain>:<action>` pattern (e.g., `repo:run-assistant`)
- **Settings changes**: Update both `src/contracts/settings.ts` and the normalization logic in `src/electron/turso-service.ts`

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution workflow.

## Security

MaTE X enforces a strict IPC boundary between the renderer and the main process. All inputs crossing that boundary are validated before execution. Security-sensitive logic must remain in `src/electron/`.

To report a vulnerability, follow the process in [SECURITY.md](SECURITY.md).

## License

MaTE X is source-available under the [MaTE X Licence](LICENSE). Personal and non-commercial use is free. Commercial use by companies or teams requires a separate commercial licence from Enosis Labs.

Proprietary components — including MaTE X Privacy Sentinel, AETHER, and the Rainy API v3 — are not covered by the open licence. See [docs/GOVERNANCE.md](docs/GOVERNANCE.md) for the full OpenCore model and commercial licensing details.

---

Designed and built by **Enosis Labs** — [enosis.dev](https://enosis.dev) · [mate-x.xyz](https://mate-x.xyz)
