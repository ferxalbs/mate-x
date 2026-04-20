# MaTE X

> **Desktop security review agent for local repositories.**

MaTE X is an AI-powered desktop shell built for security researchers and developers. It provides grounded, high-performance analysis of local repositories with a strict focus on security, local execution, and native desktop integration.

## 🚀 Key Features

- **Agentic Security Analysis**: Specialized tool suite for deep vulnerability research, supply chain auditing, and automated diagnostic loops.
- **Native Performance**: Built on **Electron 41** and optimized for macOS (Intel/Silicon) and Windows 10+.
- **Rainy API v3 Integration**: Leverages advanced model orchestration for complex reasoning and tool usage.
- **IPC-Protected Git**: Secure, native Git integration for seamless repository state management.
- **Smart Tooling**: Integrated `ripgrep` for ultra-fast local code search and indexing.
- **Premium UX**: High-density interface inspired by modern developer ecosystems (T3 Code pattern), featuring a single continuous app chrome.
- **Local Persistence**: Secure local state and configuration using **Turso/libSQL**.

## 🛠️ Tech Stack

- **Runtime**: [Electron 41](https://www.electronjs.org/)
- **Frontend**: [React 19](https://react.dev/), [Tailwind CSS v4](https://tailwindcss.com/)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/)
- **Routing**: [TanStack Router](https://tanstack.com/router)
- **Data Fetching**: [TanStack Query](https://tanstack.com/query)
- **Database**: [libSQL / Turso](https://turso.tech/)
- **Automation**: [Bun](https://bun.sh/)

## 🚦 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (latest version)
- macOS (Intel or Apple Silicon) or Windows 10+

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/ferxalbs/mate-x.git
   cd mate-x
   ```

2. **Install dependencies**:
   ```bash
   bun install
   ```

3. **Configure API Access**:
   MaTE X requires a **Rainy API v3 Key**. Once you launch the app, go to **Settings** to securely enter your key. The key is managed locally in the Electron main process.

### Development

Launch the application in development mode:
```bash
bun run start
```

## 📦 Building for Production

To package the application for your current platform:

```bash
# Create a local package
bun run package

# Create distributables (DMG, Exe, etc.)
bun run make
```

## 📜 Development Guidelines

- **Linting**: Keep code clean with `bun run lint`.
- **Type Safety**: Ensure strict typing with `bun run typecheck`.
- **Commits**: Follow conventional commits (e.g., `feat(ui): add new tool panel`).
- **Structure**:
    - `src/electron/`: Main process services and IPC handlers.
    - `src/features/`: UI feature modules and business logic.
    - `src/contracts/`: Shared interfaces and event definitions.
    - `src/components/ui/`: Atomic design primitives and reusable components.

## 🔒 Security

MaTE X is designed with a "Security-First" philosophy. It enforces strict IPC boundaries between the renderer and the main process to ensure that sensitive operations (like file system access or Git commands) are always validated and executed in a protected context.

## 📄 License

Distributed under the MIT License. See `package.json` for details.

---

Built with 🖤 by **ferxalbs** and the **Enosis Labs** team.
