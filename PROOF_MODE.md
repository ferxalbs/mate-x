# MaTE X Proof Mode

Proof Mode is a MaTE X local app feature. It runs inside the existing desktop shell, uses the active MaTE X workspace, and stores Proof Capsules through MaTE X local persistence. It is not a standalone PWA, separate service, separate product shell, or Console-owned workflow.

MaTE X Console is only for subscriptions, billing, account state, and entitlement checks. Console does not own Proof execution, local git evidence, repository detection, or operational workflow.

## Current Flow

1. Run the normal MaTE X app with `bun run start`.
2. Import or select a workspace.
3. Open `Proof Mode` from the MaTE X sidebar.
4. Add optional agent transcript and CI or validation output.
5. Generate a Proof Capsule associated with the active workspace, project, repository, local user, entitlement snapshot, validation status, privacy preflight, redactions, and audit trail.

`/proof/demo` remains demo-only. It needs no GitHub credentials and must not be treated as production persistence.

## GitHub Integration

GitHub is a normal MaTE X local integration in `Settings -> Integrations`, alongside Codex, Antigravity, Cursor, and Supermemory. Settings use the existing `AppSettings` persistence flow and `githubIntegrationEnabled` toggle.

Production Proof Mode must never ask users for `GITHUB_TOKEN`, `VITE_GITHUB_TOKEN`, personal access tokens, or pasted private tokens. Browser code must not receive product secrets. The first slice uses local git evidence and no GitHub network token.

The local GitHub integration service exposes:

- `detectGitHubRemote(workspacePath)`
- `getCurrentBranch(workspacePath)`
- `getLocalDiff(workspacePath)`
- `getChangedFiles(workspacePath)`
- `getPullRequestForBranch(...)`
- `getPullRequestFiles`
- `getPullRequestChecks`

Local git-backed functions work immediately from the opened MaTE X workspace. Network-backed functions return typed `not_configured` until GitHub App auth is configured. Local-only is a valid state: MaTE X can generate Proof Capsules from local diff and changed files without private PR metadata, comments, or checks.

## Storage

Production capsules use `serverProofStorageAdapter`, which calls MaTE X local IPC persistence under app `userData`. Demo-only storage is isolated in `demoLocalProofStorageAdapter`; localStorage is not the production path.

## Modular Pieces

- `packages/proof-core`: pure deterministic schemas, redaction, risk classification, verdict logic, capsule serialization.
- `packages/proof-github`: future GitHub REST helper package. Do not import it into browser feature code.
- `src/electron/github-integration-service.ts`: local git evidence and future GitHub network boundary.
- `src/features/proof`: MaTE X shell route, entitlement gate, storage adapter, UI.

## Guarantees

- No `VITE_GITHUB_TOKEN`.
- No production browser token path.
- GitHub appears in Settings -> Integrations.
- Proof works local-first from git diff and changed files without GitHub auth.
- Console remains entitlement/billing only.
- No `passed` verdict without explicit command or validation evidence.
- Secret-like values are redacted before persistence and display.
- Capsules include MaTE X ownership fields: `workspaceId`, `projectId`, `repositoryId`, `createdByUserId`, `visibility`, `planSnapshot`, `sourceIntegration`, `privacyPreflightResult`, `validationStatus`, `redactions`, and `auditTrail`.
