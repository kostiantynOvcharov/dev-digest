/**
 * Smart Diff classification patterns + thresholds.
 *
 * `classifyFile` (./classifier.ts) sorts every changed file into one of three
 * risk buckets so the reviewer reads business logic FIRST and skims generated
 * noise LAST. Patterns are path-only and matched against a forward-slash path.
 *
 * Precedence is BOILERPLATE → WIRING → core (default). Boilerplate is checked
 * first on purpose: a generated `dist/index.js` is boilerplate, not wiring,
 * even though `index.js` looks like a barrel/entry file.
 */

/**
 * Generated / mechanical files — lock-files, build output, snapshots, DB
 * migrations, source maps. The reviewer should skim these, not read them.
 */
export const BOILERPLATE_PATTERNS: readonly RegExp[] = [
  // Dependency lock-files (pnpm-lock.yaml must win over the generic *.yaml
  // wiring rule, hence boilerplate is matched first).
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|npm-shrinkwrap\.json)$/,
  /\.lock$/,
  // Build / generated output directories.
  /(^|\/)(dist|build|out|coverage|\.next|node_modules)\//,
  // Test snapshots.
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  // Minified bundles and source maps.
  /\.min\.(js|css)$/,
  /\.map$/,
  // Database migrations (raw SQL + the migrations folder).
  /\.sql$/,
  /(^|\/)(migrations|drizzle)\//,
  // Documentation — hand-written, but the reviewer skims it, not "the
  // substance of the change". Markdown, docs folders, and the common
  // root docs (README, CHANGELOG, LICENSE, CLAUDE.md, AGENTS.md, …).
  /\.mdx?$/,
  /(^|\/)docs?\//,
  /(^|\/)(README|CHANGELOG|HISTORY|LICEN[CS]E|CONTRIBUTING|CODE_OF_CONDUCT|AUTHORS|NOTICE|CLAUDE|AGENTS)(\.[^/]+)?$/,
  /\.txt$/,
  // Binary / asset files — never code to review.
  /\.(png|jpe?g|gif|svg|ico|webp|avif|bmp|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|wav|pdf)$/i,
];

/**
 * Wiring — config and entry/barrel files that hook the core into the app.
 * Worth a glance, but rarely where the substance of a change lives.
 */
export const WIRING_PATTERNS: readonly RegExp[] = [
  // `*.config.{ts,js,cjs,mjs}` — vite.config.ts, vitest.config.ts, etc. — plus
  // a bare `config.{ts,js}` (e.g. src/config.ts), which is app wiring.
  /\.config\.[cm]?[jt]s$/,
  /(^|\/)config\.[cm]?[jt]s$/,
  // tsconfig*.json and package.json (NOT package-lock.json — that's boilerplate).
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)package\.json$/,
  // Entry points / barrels — index, server, app, main.
  /(^|\/)(index|server|app|main)\.[cm]?[jt]sx?$/,
  // CI / infra config.
  /(^|\/)\.github\//,
  /\.ya?ml$/,
  /(^|\/)[^/]*\.env(\.[^/]+)?$/,
  /(^|\/)(Dockerfile|docker-compose\.[^/]+)$/,
  // Tooling config: any dot-file (.gitignore, .npmrc, .prettierrc, .nvmrc …)
  // or dot-directory (.claude/, .husky/, .vscode/ …). NOTE: a `.md` inside a
  // dot-dir (e.g. .claude/skills/x.md) is matched by the doc rule FIRST and
  // stays boilerplate — only the non-doc config here lands in wiring.
  /(^|\/)\.[^/]+\//,
  /(^|\/)\.[^/]+$/,
  // Shell / tooling scripts and data files — plumbing, not business logic.
  /\.(sh|bash|zsh)$/,
  /\.json$/,
];

/**
 * Total changed lines (additions + deletions) above which a PR is flagged as
 * `too_big` and a deterministic per-role split is suggested.
 */
export const BIG_PR_LINE_THRESHOLD = 400;
