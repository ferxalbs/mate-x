# NES-0.1 Baseline Notes — MaTE X v0.1.2

**Date:** 2026-07-11  
**Implementation branch:** `feat/native-engineering-system-v0.1.2`  
**Starting HEAD (implementation):** `e05a056374b3b57adcc851361b657a629ef4e476`  
**Agent 3 design HEAD:** `ce57ef22dd37ee1ca5199657bdc210064231aae7`  
**Package version:** `0.1.1` → target `0.1.2`

---

## 1. HEAD drift classification

| Item | Value |
|------|-------|
| Commits since Agent 3 | 1 |
| Commit | `e05a056` — feat: enable native window vibrancy and refine sidebar visual styling and transitions |
| Touched production control-plane paths | **None** (main chrome/CSS/sidebar only) |
| Classification | **Compatible** — does not invalidate blueprint |

Uncommitted WIP on main at session start (settings, ipc-handlers, turso, desktop-shell, CSS, settings-page) was **stashed** as:

`WIP: unrelated UI/settings vibrancy (pre-NES Agent4 baseline)`

Not overwritten. Restore after NES work if still needed: `git stash list` / `git stash pop`.

---

## 2. Baseline verification (`bun run verify`)

| Check | Result |
|-------|--------|
| `bun run lint` | **PASS** |
| `bun run typecheck` | **PASS** |
| `bun test` | **300 pass, 1 fail** (see §3) |
| `bun run verify:package-config` | Not reached by full verify (tests exit 1 first); run separately in NES-0.2 |
| Full `bun run verify` | **FAIL** (pre-existing single test) |

---

## 3. Known pre-existing failure

| Test | File | Notes |
|------|------|-------|
| `GPT-5.6 pricing notice > surfaces threshold notice without estimating from prompt count` | `src/lib/rainy-model-launches.test.ts` | Expects copy containing `/not estimate from message count/i`; actual notice: `Provider base pricing changes when input tokens exceed 272K.` **Unrelated to NES.** Do not “fix” as part of NES unless required for green CI. |

---

## 4. Adversarial regression inventory (NES-0.2)

Must remain green (or intentionally rewritten when authority is deleted):

| Suite | Path | Role |
|-------|------|------|
| Factory run | `src/lib/factory-run.test.ts` | Legacy stage/proof claims; later migrate |
| Git safety | `src/features/desktop-shell/components/git-safety.test.ts` | Soft gate → main-process mirror |
| Work engine / validation | `src/electron/work-engine/*` | Validation gate, stages, finalizer |
| Chat store | `src/store/chat-store.test.ts` | Submit / Factory path |

---

## 5. Feature flags (defaults for implementation)

| Flag | Default |
|------|---------|
| `engineeringControlPlane` | true (new workspaces) |
| `legacyFactoryUi` | false once UI ported |
| `mainProcessGitGate` | true (non-negotiable) |
| `strictValidationNoTextWaive` | true |
| `multiAgentLeases` | false |
| `llmConsistencyAssist` | false |
| `policyImportFromMarkdown` | true (confirm required) |

---

## 6. Rollback

Discard NES branch commits; restore stash for unrelated UI WIP. No schema writers until NES-1.2.

---

**NES-0.1 completion evidence:** this file + baseline command inventory above.
