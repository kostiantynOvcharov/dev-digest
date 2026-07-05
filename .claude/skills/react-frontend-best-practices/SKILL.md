---
name: react-frontend-best-practices
description: "Frontend architecture & code organization for React + Next.js — where code lives, not how it's written. Covers folder structure (type-based → feature-based → layered/FSD, screaming architecture), component decomposition & colocation, where constants/utils/helpers/lib/types/business-logic belong, barrel-file & per-feature public-API trade-offs, and Next.js App Router organization (app/ routing-only, route groups, private folders, src/, server/client boundary). Use when scaffolding a new frontend project, deciding where a file/component/hook/constant should go, refactoring folder layout, or reviewing project organization."
version: 1.0.0
user-invocable: true
---

# React Frontend Architecture & Code Organization

Where code should live and how a React / Next.js frontend should be structured as it scales.
This skill is about **organization decisions** — folder layout, boundaries, colocation,
decomposition — not about how to write a component or hook.

## Scope & boundary

This skill owns *structure*. For *coding rules*, defer to the sibling skills:

| You're deciding… | Use |
|---|---|
| Folder layout, where a file/component/hook/constant goes, how to split code, feature boundaries, Next.js project organization | **this skill** |
| How to write a component/hook, state patterns, `useEffect`/memoization rules, performance, anti-patterns | `react-best-practices` |
| Next.js file-convention mechanics, RSC data fetching, metadata, image/font, bundling | `next-best-practices` |
| Where test files go & how to test | `react-testing-library` |

When a rule here touches a coding-level concern, point to the owning skill instead of restating it.

## Guiding principles (apply everywhere)

- **Colocate first.** Keep code as close as possible to where it's used; move it up only when a
  second consumer appears. Distance from usage is a cost.
- **Organize by feature, not by file type**, once the app outgrows a handful of components.
  `type-based` (all components in `components/`, all hooks in `hooks/`) stops scaling because one
  change touches many far-apart folders.
- **Dependencies flow one way:** `shared → features → app`. Shared code knows nothing about
  features; features never import from each other directly; the app composes features.
- **Structure should "scream" the domain**, not the framework — top-level folders read like
  `checkout/`, `dashboard/`, `auth/`, not `controllers/`, `views/`.
- **Move structure when it hurts, not before.** Don't pre-build a 7-layer architecture for a
  3-screen app. Let pain drive the next step.

## Folder structure progression (let it grow)

Adopt the *smallest* structure that isn't yet painful (after Robin Wieruch's 5 steps):

1. **One file** — a single `App` until it's uncomfortable.
2. **Multiple files** — one file per reusable component.
3. **Files → folders** — when a component needs styles/test/constants/sub-parts, give it a folder
   (`Button/` with `Button.tsx`, `Button.test.tsx`, `Button.module.css`, `index.ts`).
4. **Technical folders** — separate React components from reusable non-UI: `hooks/`, `context/`,
   `lib/`, `utils/`, `services/`, `types/`.
5. **Feature folders** — group everything for a domain under `features/<name>/` (its own
   `components/`, `hooks/`, `api/`, `utils/`, `types`, and a public `index.ts`). Generic,
   domain-agnostic UI stays in a shared `components/ui/`.

For a layered, enforceable variant at large scale, see **Feature-Sliced Design** (layers
`app → pages → widgets → features → entities → shared`, with slices by domain and segments by
technical purpose). Adopt FSD when team size / cross-feature coupling justifies the ceremony.

## Feature-based architecture & dependency direction

- Put most code in `features/<feature>/`. A feature folder is self-contained: components, hooks,
  API calls, utils, and types for that domain.
- **Expose a public API per feature** via a single `index.ts` barrel that re-exports only what
  outsiders may use. Everything else in the feature is private.
- **No deep cross-feature imports.** `features/cart` importing `features/checkout/components/Foo`
  is a smell — promote the shared piece to `shared/` (or `components/ui/`, `lib/`), or compose both
  in the `app` layer.
- Enforce the `shared → features → app` direction (lint rules like
  `eslint-plugin-import` / boundaries can make violations fail CI).

## Colocation

- Colocate component + its hook + styles + test + local constants/types in the component's folder.
- A constant/type/util used by exactly one component lives **next to it**, not in a global bucket.
- Promote to a shared location only on the **second** real consumer (rule of three is fine too) —
  premature sharing creates coupling and god-modules.
- State follows the same rule: keep it in the component that uses it; lift only when truly shared
  (state-specific guidance lives in `react-best-practices`).

## Component decomposition

Split by **responsibility and reasons-to-change**, not purely by line count (line count is just a
prompt to look). Signals it's time to split:

- The component does fetching **and** layout **and** formatting — separate concerns.
- A chunk of JSX has its own state/handlers and could be named — extract it.
- You're tempted to comment "// ---- section ----" — that section is a component.
- Props exceed ~5–7, or you pass props through without using them (prop drilling) — compose with
  `children` instead.

Patterns:

- **Composition over configuration** — prefer `<Card><Card.Header/></Card>` and `children` over a
  component with 15 boolean props.
- **Container / presentational** — still a useful mental split (data/behavior vs. pure rendering),
  but in the hooks era the "container" is usually a **custom hook**, not a wrapper component. Don't
  add container components just for ceremony.
- **Atomic Design vocabulary** (atoms → molecules → organisms → templates → pages) is a helpful
  shared language for a UI-kit hierarchy; use it as naming/mental model, not a mandatory folder law.

## Where each kind of code lives

| Kind | Default home | Rule |
|---|---|---|
| **Constants** | next to their sole user; `constants.ts` per feature; global `config/` only for app-wide config/env | A constant used in one place is not "shared". Magic values → named constants near use. |
| **`utils`** | `utils/` (or per-feature `utils.ts`) | **Pure, generic, domain-agnostic** helpers (formatDate, clamp). No app/domain knowledge, easily unit-tested. |
| **`helpers`** | feature folder | Domain-aware glue specific to a feature. If it knows about your business entities, it's a helper, not a util. |
| **`lib`** | `lib/` | Wrappers/adapters around third-party packages and integrations (api client, analytics, date lib config). The seam you'd swap to change a dependency. |
| **`services` / api** | `features/<x>/api/` or `services/` | Data access — request/response, mapping DTO→domain. Keep transport out of components. |
| **Types/interfaces** | colocated with their owner; shared `types.ts` only for cross-cutting types | Don't dump every interface in one global `types/`. Colocate; share deliberately. |
| **Custom hooks** | feature folder if feature-specific; `hooks/` if app-generic | Generic (`useDebounce`) → shared; domain (`useCheckout`) → feature. |

## Business logic separation

- Components stay **declarative**: read data, render UI, wire handlers. Pull logic out of the
  component body.
- Domain/orchestration logic → **custom hooks** (`useX`) or plain **service** functions; UI calls
  them and renders the result.
- Keep a thin **data-access layer** (services/api) so swapping transport or caching doesn't ripple
  into components.
- Pure transformations → testable `utils`/`helpers`, imported where needed.

## Barrel files (`index.ts`)

- ✅ **Do** use a barrel as a **feature's public API** — one `index.ts` re-exporting the feature's
  intended surface; encodes what's public vs private.
- ❌ **Avoid** sprawling barrels that re-export everything everywhere. They cause: circular-import
  headaches, accidental loading of a whole feature to grab one symbol, and (in some bundlers) worse
  tree-shaking / slower dev cold-start.
- Keep barrels shallow and intentional; import deep paths inside a feature, the barrel only across
  feature boundaries.

## Next.js (App Router) organization

- **`app/` is for routing only** — `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts`.
  Business logic, data access, and reusable UI live in `features/`, `components/`, `lib/`, not in
  `app/`. (File-convention *mechanics* are owned by `next-best-practices`.)
- **Colocation in route segments** — non-`page`/`route` files in a segment folder are not routable,
  so you may colocate segment-specific components there. Use **private folders** `_components/`,
  `_lib/` to make "not a route, internal" explicit.
- **Route groups** `(group)/` organize routes (by section, or to give a subtree its own layout)
  **without** affecting the URL. Good for `(marketing)` vs `(app)` splits and multiple root layouts.
- **`src/` directory** (optional) separates application code from root config — pick it or not, then
  be consistent.
- **Server/client boundary is the key architectural decision.** Default to Server Components; add
  `'use client'` only where interactivity/browser APIs are needed, and **push the boundary down to
  leaves** (a small interactive widget), not up at the page. Pass Server-rendered content into
  client components via `children` to keep the client bundle small.
- Suggested top level: `app/` (routes) · `features/` (domain) · `components/ui/` (generic UI) ·
  `lib/` (integrations, server actions in `lib/actions/`) · `hooks/` · `utils/` · `types/`.

## Reference trees

### React SPA (feature-based)

```
src/
  app/                  # app shell, providers, router setup, global styles
  components/ui/        # generic, domain-agnostic UI (Button, Modal, Input)
  features/
    checkout/
      components/        # feature UI
      hooks/             # useCheckout, ...
      api/               # checkout service calls
      utils.ts           # domain helpers
      types.ts
      constants.ts
      index.ts           # public API (only what other layers may import)
    auth/
      ...
  hooks/                # app-generic hooks (useDebounce)
  lib/                  # third-party wrappers (apiClient, analytics)
  utils/                # pure generic helpers (formatDate)
  types/                # cross-cutting types only
  config/               # env/app-wide config
```

### Next.js App Router

```
src/
  app/                          # ROUTING ONLY
    (marketing)/                # route group — no URL segment
      page.tsx
      layout.tsx
    (app)/
      dashboard/
        page.tsx
        _components/            # private, segment-local components
    api/
      webhook/route.ts
  features/                     # domain logic & UI (same shape as SPA above)
  components/ui/                # generic UI
  lib/
    actions/                    # server actions, by domain
    apiClient.ts
  hooks/  utils/  types/  config/
```

Match whichever convention the target repo already uses; don't impose a second pattern alongside an
existing one.
