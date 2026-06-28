# References

Sources behind this skill's conventions. The architecture is adapted to DevDigest's stack
(Fastify + Drizzle + Zod, a hand-rolled DI container, and the pure `reviewer-core` engine); these
are the canonical write-ups of the underlying ideas.

## Onion / Clean Architecture — the concept

- **Jeffrey Palermo — "The Onion Architecture"** (the original 2008 series). Coins the layering
  and the inward dependency rule. <https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/>
- **NDepend — "Onion Architecture: Going Beyond Layers."** Clear modern treatment of the layers
  and why dependencies point inward. <https://blog.ndepend.com/onion-architecture-layers/>
- **Code Maze — "Onion Architecture in ASP.NET Core."** Canonical layer breakdown (domain →
  services → infrastructure → presentation); .NET examples, but the structure is language-neutral.
  <https://code-maze.com/onion-architecture-in-aspnetcore/>
- **Robert C. Martin — "The Clean Architecture."** The Dependency Rule ("source code
  dependencies point only inward") that this skill's "one rule" restates.
  <https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html>

## In Node.js / TypeScript

- **Remo Jansen — "Implementing SOLID and the Onion Architecture in Node.js with TypeScript."**
  The layers applied to a TS/Node service with dependency injection.
  <https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad>
- **André Bazaglia — "Clean Architecture with TypeScript: DDD, Onion."** Practical TS folder
  structure and interface/implementation separation.
  <https://bazaglia.com/clean-architecture-with-typescript-ddd-onion/>
- **`fastify-clean-architecture`** (reference repo) — clean architecture with Fastify in TS; only
  the interface layer is framework-specific. <https://github.com/tonyfreed/fastify-clean-architecture>

## Enforcing boundaries by machine

- **dependency-cruiser** — the tool DevDigest uses to enforce the rules (`*.dependency-cruiser.cjs`).
  Docs: <https://github.com/sverweij/dependency-cruiser> · rules guide:
  <https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md>
- **"Avoid Cross Module Dependencies with Dependency Cruiser."** Worked example of forbidding
  cross-module imports — the basis for our `no-cross-module-internals` rule.
  <https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser-3b0b>

### Alternative we considered but did not adopt

- **`eslint-plugin-boundaries`** — enforces layer boundaries via ESLint with in-editor feedback.
  Strong DX, but DevDigest has **no ESLint setup**, while `dependency-cruiser` was already a
  `server/` dependency. We chose the zero-new-tooling path. If ESLint is introduced later, this
  plugin would complement (not replace) the dependency-cruiser CI gate.
  <https://github.com/javierbrea/eslint-plugin-boundaries>

## DevDigest-specific anchors

The conventions here are grounded in real files; when in doubt, read the source:

- Reference module (all layers): `server/src/modules/agents/{routes,service,repository,helpers,constants}.ts`
- Composition root: `server/src/platform/container.ts`
- Adapter interfaces (core): `server/src/vendor/shared/adapters.ts`
- Tenancy chokepoint: `server/src/modules/_shared/context.ts`
- Module registry: `server/src/modules/index.ts`
- Pure engine + iron rule: `reviewer-core/` and `reviewer-core/CLAUDE.md`
