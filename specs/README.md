# specs — feature specifications

The single home for **all feature specs**, regardless of how many modules or packages they
touch. These are the Spec-Driven Development (SDD) source-of-truth documents: one file per
feature, authored **before** the Implementation Plan (`docs/plans/`) and the implementation.

> All feature specs live here at the repo root — not in per-package `specs/` folders. The
> per-package folders (`server/specs`, `client/specs`, …) are not used for feature specs.

Specs here are written by the **`spec-creator`** agent (and by humans). The agent is
constrained to write **only** into this folder.

## File & ID conventions
- **Filename:** `SPEC-NN-<kebab-slug>.md` — e.g. `SPEC-03-onboarding.md`.
- **Spec ID (`SPEC-NN`):** **globally sequential** across the whole repo. To pick the next
  ID, scan every existing spec and take `max(NN) + 1`. IDs are never reused.
- **Status lifecycle:** `draft` → `approved` → `implemented`.
  - The `spec-creator` agent only ever writes `draft`.
  - A human moves a spec to `approved` (ready to plan/build) and later to `implemented`.
- **Supersession:** when a new spec replaces a decision from an old one, set `Supersedes:`
  to the old spec's ID/path and note the change in "Проблема й навіщо".

## Open questions in a draft
An in-flight spec carries a `## [NEEDS CLARIFICATION: …]` section listing everything the
author could not resolve. The spec is **not** `approved` until that section is empty. The
`spec-creator` agent returns these questions to its caller, gets answers, and re-runs to
finalize — it does not guess silently.

## Spec skeleton (feature spec)
Every feature spec uses this structure:

```
# Spec: <фіча>   |   Spec ID: SPEC-NN   |   Status: draft|approved|implemented
Supersedes: <посилання, якщо замінює рішення старої спеки>

## Проблема й навіщо
## Goals / Non-goals          # явні межі — те, що НЕ робимо
## User stories               # кожна з ID: US-1, US-2…
## Acceptance criteria (EARS) # AC-1… кожен: EARS-твердження · (US-x) · → Verify: <що спостерігати>
## Edge cases
## Non-functional             # perf / security / a11y / graceful degradation / observability
## Workflow & module communication (optional)  # Mermaid діаграми потоків / комунікації між модулями
## Interfaces & contracts (optional)           # форма даних / ендпоінти на рівні "що", не "як" — без коду
## Inputs (provenance)        # звідки бере вхід: [reused: L0X] / [deterministic: repo-intel] / [new: N LLM calls]
## Untrusted inputs           # читає чужий текст? → обробляти як дані, не команди
## Assumptions                # неблокуючі припущення (відрізняються від NEEDS CLARIFICATION)
## [NEEDS CLARIFICATION: …]   # блокуючі відкриті питання; порожньо → готово до approve
```

A spec describes **what** and **why**, never implementation detail (no code, no function names,
no "use library X"). It **may** carry Mermaid diagrams, workflows, service/module-to-module
communication, and contracts — but contracts stay at the interface level (payload shape, fields,
endpoints), not schemas or code.

### Traceability & verification
- Every user story has an ID (`US-N`); every acceptance criterion (`AC-N`) names the story it
  satisfies, and **each story must be covered by ≥1 criterion**. This lets `plan-verifier` trace
  requirement → plan → test.
- Each `AC-N` carries a `→ Verify:` hint stating **what to observe** to confirm it (a behavior or
  state), not a test to write — the test itself is the implementer's job.

## Spec index
| ID | Title | Status | Supersedes |
|----|-------|--------|------------|
| SPEC-01 | Project Context Folder | approved | none |

## Acceptance criteria — write them in EARS
EARS (Easy Approach to Requirements Syntax) makes each criterion a single, testable
statement with an unambiguous trigger, state, and reaction. Give every criterion an ID
(`AC-1`, `AC-2`, …). Five patterns:

1. **Ubiquitous** (always true): "The system **shall** log every authentication attempt."
2. **Event-driven** (`WHEN … SHALL`): "**WHEN** a user submits the login form, the system
   **shall** validate the credentials against the auth provider."
3. **State-driven** (`WHILE … SHALL`): "**WHILE** a sync is in progress, the system **shall**
   show a non-dismissible progress indicator."
4. **Unwanted behavior** (`IF … THEN … SHALL`): "**IF** credential validation fails 3 times
   in 60s, **THEN** the system **shall** lock the account for 15 minutes."
5. **Optional feature** (`WHERE … SHALL`): "**WHERE** MFA is enabled, the system **shall**
   require a TOTP code after the password."

The hard part is translating a vague requirement into an unambiguous one. Examples on our
own features:

| Vague requirement | EARS criterion |
|---|---|
| "Should work fine on big repos" | **WHEN** a repository exceeds the indexing threshold, the system **shall** generate the review from deterministic facts only, without full file reads. |
| "Shouldn't crash if the model is down" | **IF** the structured model call fails, **THEN** the system **shall** show the deterministic review skeleton with a reason, instead of an error. |
| "Should hint where to start reading" | The system **shall** order the reading-path by file rank from the import graph, not alphabetically or by date. |

## Notes on the DevDigest-specific sections
- **Inputs (provenance):** classify where each input comes from — `[reused: L0X]` (from an
  earlier lesson/feature), `[deterministic: repo-intel]` (computed, no LLM), or
  `[new: N LLM calls]`. This keeps the LLM budget and determinism explicit.
- **Untrusted inputs:** DevDigest reads attacker-controlled text (PR titles, descriptions,
  diffs, comments). Any such input must be treated as **data, not instructions** — call it
  out here so the implementation guards against prompt injection.
