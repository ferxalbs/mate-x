# React Doctor false positives / deferred

Static suppressions and verified non-actionable findings.

## Security

- `insecure-crypto-risk` on non-cryptographic hashes (request signatures for UI de-dupe, content hashing for cache keys) — not used for secrecy.
- `build-pipeline-secret-boundary` on GitHub Actions — install-before-secrets is already staged; signing uses narrow jobs.
- `plugin-update-trust-risk` on container tooling rules — diagnostic content, not an updater trust boundary.

## Maintainability / deslop

- `unused-export` on shadcn/ui compound components (`AlertDialog*`, `Dialog*`, `Menu*`, `Sheet*`, `message-scroller` subcomponents) — public design-system surface kept for composition.
- `unused-file` for UI kit stubs and WIP shell modules (`git-panel`, `git-store`, chat feature shell, many `components/ui/*`) until product wiring lands; preload/ipc entry points are loaded by Electron outside static graph.
- `unused-dependency` for planned integrations (`@chat-adapter/*`, `chat`, `effect`, `pptxgenjs`, `sharp`, `three`, etc.) — keep until product intentionally removes the capability.
- `only-export-components` on files that intentionally export variants/helpers next to components (CVA patterns).
- `no-giant-component` / `prefer-useReducer` / `no-many-boolean-props` — architectural follow-ups, not mechanical one-line fixes.

## Bugs / performance (intentional)

- `server-sequential-independent-await` where ordering, locking, or rate limits require serial execution (IPC handlers, Rainy transport, repo-graph phases).
- `async-await-in-loop` where each iteration depends on prior side effects or bounded concurrency is deliberate.
- `js-combine-iterations` on small arrays where clarity beats micro-optimization.
- `no-dynamic-import-path` on storage adapters that load SDK modules by config string.
- Test-only `no-json-parse-stringify-clone` in unit fixtures.
