# react-frontend-best-practices

A Claude Code skill for **frontend architecture and code organization** in React + Next.js
projects. It answers *where code should live* — folder structure, feature boundaries, colocation,
component decomposition, and the Next.js App Router layout — rather than *how to write* a given
component or hook.

## Focus

Architecture and organization decisions for a scaling frontend: type-based vs feature-based vs
layered (Feature-Sliced Design) structure, the `shared → features → app` dependency direction,
colocation, when/how to split components, where constants / `utils` / `helpers` / `lib` / `services`
/ types / business logic belong, barrel-file and per-feature public-API trade-offs, and Next.js
App Router organization (routing-only `app/`, route groups, private folders, `src/`, and the
server/client component boundary).

## What it covers

- Folder-structure progression (single file → feature folders) and when to advance each step
- Feature-based architecture, unidirectional dependencies, per-feature public API via `index.ts`
- Colocation principle and the "promote on the second consumer" rule
- Component decomposition signals; composition over configuration; container/presentational in the
  hooks era; Atomic Design as a naming model
- A decision table for where constants, utils, helpers, lib, services, types, and hooks go
- Business-logic separation (UI declarative; logic in hooks/services; thin data-access layer)
- Barrel files — where they help vs hurt
- Next.js App Router organization and the `'use client'` boundary placement
- Annotated reference folder trees for a React SPA and a Next.js app

## When to use

- Scaffolding a new React/Next.js project and choosing a structure
- Deciding where a new file/component/hook/constant should live
- Refactoring or untangling folder layout as the app grows
- Reviewing a PR for project organization / architecture

**When *not* to use** (reach for a sibling skill instead): writing component/hook code, state and
performance rules → `react-best-practices`; Next.js file-convention mechanics, RSC data fetching,
metadata, bundling → `next-best-practices`; test placement & testing → `react-testing-library`.

## Related skills & how this differs

| Skill | Owns | This skill differs by |
|---|---|---|
| `react-best-practices` | Component/hook coding rules, state, performance, anti-patterns | Owns *structure/organization*; the other owns *how to write code*. (`react-best-practices` mentions feature structure briefly; this is the deep, canonical home.) |
| `next-best-practices` | Next.js file-convention mechanics, RSC data patterns, metadata, images/fonts, bundling | Covers *how to organize* a Next.js project (where logic/components/lib go, boundary placement), not the API mechanics of each convention. |
| `vercel-react-best-practices` | Vercel/Next-flavored React practices | This skill is framework-organization-focused and cross-links rather than repeats. |
| `react-testing-library` | Writing & placing tests | This skill only notes that tests are colocated; testing patterns belong there. |

## Version

**1.0.0**

Mirrors the `version` field in `SKILL.md` frontmatter.

### Changelog

- **1.0.0** — Initial release. Architecture & organization guidance for React + Next.js: folder
  progression, feature-based architecture, colocation, decomposition, code-placement decision table,
  business-logic separation, barrel files, Next.js App Router organization, and reference trees.

## Sources

Curated during research for this skill (current as of 2024–2026). Kept here verbatim because they
are the basis for the guidance and useful for deeper reading.

### React architecture & organization

- bulletproof-react — Project Structure — https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md
- bulletproof-react — Project Standards — https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md
- bulletproof-react — repository — https://github.com/alan2207/bulletproof-react
- Feature-Sliced Design — home — https://feature-sliced.design/
- Feature-Sliced Design — documentation — https://feature-sliced.design/docs
- Feature-Sliced Design — Building Scalable React Architecture — https://feature-sliced.design/blog/scalable-react-architecture
- Kent C. Dodds — Colocation — https://kentcdodds.com/blog/colocation
- Kent C. Dodds — State Colocation will make your React app faster — https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster
- Robin Wieruch — React Folder Structure Best Practices [2026] — https://www.robinwieruch.de/react-folder-structure/
- Robin Wieruch — Feature-based React Architecture — https://www.robinwieruch.de/react-feature-architecture/
- Dan Abramov — Presentational and Container Components (2015; note the later author caveat) — https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0
- patterns.dev — Container/Presentational Pattern — https://www.patterns.dev/react/presentational-container-pattern/
- Brad Frost — Atomic Design, Ch. 2 Methodology — https://atomicdesign.bradfrost.com/chapter-2/
- React docs — Thinking in React — https://react.dev/learn/thinking-in-react
- profy.dev — Popular React Folder Structures & Screaming Architecture — https://profy.dev/article/react-folder-structure
- React Handbook — Project Standards — https://reacthandbook.dev/project-standards

### Next.js (App Router) architecture & organization

- Next.js — Project Structure (official) — https://nextjs.org/docs/app/getting-started/project-structure
- Next.js — Server and Client Components — https://nextjs.org/docs/app/getting-started/server-and-client-components
- Next.js — Route Groups — https://nextjs.org/docs/app/api-reference/file-conventions/route-groups
- Next.js — `src` Directory — https://nextjs.org/docs/app/api-reference/file-conventions/src-folder
- Vercel Academy — Client-Server Component Boundaries — https://vercel.com/academy/nextjs-foundations/client-server-boundaries
