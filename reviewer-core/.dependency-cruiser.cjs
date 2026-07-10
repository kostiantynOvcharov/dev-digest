/**
 * "Iron rule" enforcement for @devdigest/reviewer-core (the onion's pure core).
 *
 * reviewer-core is the innermost layer: diff → prompt → LLM → grounded findings.
 * The same code runs in the studio (server) and in CI, so it must stay pure —
 * NO I/O of its own. Its only outward reach is the injected `LLMProvider`
 * interface (from @devdigest/shared) and the LLM HTTP client (`openai`).
 *
 * This config fails the build if anything under src/ imports a persistence,
 * filesystem, process, network, git, or web-framework dependency.
 *
 * Run: `npm run arch:check`. See .claude/skills/onion-architecture.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'core-no-io-libraries',
      severity: 'error',
      comment:
        'reviewer-core must do NO I/O. Persistence (drizzle/postgres), git, GitHub ' +
        '(octokit/simple-git) and web frameworks (fastify) belong in the server, not ' +
        'the pure engine. Receive data as arguments and reach the LLM via the injected ' +
        'LLMProvider interface instead.',
      from: { path: '^src' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-peer', 'npm-optional'],
        path: '/(drizzle-orm|postgres|pg|octokit|@octokit|simple-git|fastify|node-fetch|axios)/',
      },
    },
    {
      name: 'core-no-node-io-builtins',
      severity: 'error',
      comment:
        'reviewer-core must not touch the filesystem, spawn processes, or open sockets. ' +
        'Keep it deterministic and portable: no fs / child_process / net / http(s) / dns.',
      from: { path: '^src' },
      to: {
        dependencyTypes: ['core'],
        path: '^(node:)?(fs|fs/promises|child_process|net|dgram|tls|http|https|http2|dns|cluster|worker_threads|os|readline|repl)$',
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies hurt testability and reasoning about the engine.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: false,
    enhancedResolveOptions: {
      extensions: ['.ts', '.js', '.json'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
    includeOnly: '^src',
    exclude: { path: '\\.(test|spec)\\.ts$' },
  },
};
