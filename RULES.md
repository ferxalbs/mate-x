# Rules

## Changelog Format

- Every new changelog entry must use this header format: `## Unreleased - YYYY.MM.DD (N) [Entry Name]`.
- `YYYY.MM.DD` must be the release or entry date using a four-digit year, two-digit month, and two-digit day.
- `(N)` must be the sequential index for entries created on the same date.
- `[Entry Name]` must contain the short name or denomination of the entry and must always be included in square brackets.
- Example: `## Unreleased - 2026.04.16 (1) [Workspace Persistence and Turso Foundation]`

## Compliance & Attestations

- Compliance artifacts are local-first and must be reproducible from Evidence Pack data plus local policy sources.
- Attestation and compliance export changes must preserve Privacy Firewall behavior; secret-bearing payloads must not become trusted signed evidence.
- Agent Run Identity must be persistent, local, and policy-bound. Future cloud or SSO binding requires explicit consent and must not be implicit through Rainy API calls.
- Procurement ZIP manifests must include SHA-256 hashes for every packaged artifact and include Agent Runbook JSON/Markdown when generated.
