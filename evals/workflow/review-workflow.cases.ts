import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the on-disk harness (CLAUDE.md + skills, loaded via
 * settingSources:["project"]) routes an agent the way the CLAUDE.md files document. Every
 * expectation below is grounded in a file that EXISTS in the repo today (verified), so a red
 * result means the harness misbehaved, not that the fixture is missing.
 *
 * Budget: 4 Claude sessions total.
 *   - 3 × trace              → 1 session each = 3
 *   - 1 × activation positive → 1 session     = 1
 *
 * No near-miss negative for onion-architecture: that skill's own description lists the bare topic
 * ("Trigger terms: onion architecture, layering, …") as a trigger, so a pure-explanation prompt is
 * IN-scope by design and can't serve as a near-miss. A run confirmed it activates on "explain onion
 * architecture in general" — correct per its description, so only the positive is asserted here.
 *
 * Scope note: these test CLAUDE.md's *routing/activation* rules (which doc, which skill), NOT
 * doc content. `trace` folds the assertions into one session and stops early once the evidence
 * is in.
 */
export const cases: WorkflowCase[] = [
  // --- B1: root CLAUDE.md "Session protocol" — read the package INSIGHTS.md before touching it --
  {
    kind: "trace",
    // The most distinctive rule in this repo: "Start: before touching a package, read its
    // INSIGHTS.md and summarize the top 3". Prompt must push toward STARTING WORK ON THE PACKAGE
    // per repo conventions, not toward a code question — otherwise the model dives into source
    // and never runs the protocol. reviewer-core/INSIGHTS.md exists.
    name: "session protocol reads reviewer-core INSIGHTS before touching the package",
    prompt:
      "Я збираюся вносити зміни в пакет reviewer-core. За настановами цього репо (CLAUDE.md), " +
      "що треба зробити ПЕРШ, ніж торкатися пакета? Виконай цей крок для reviewer-core.",
    expectFilesRead: ["reviewer-core/INSIGHTS.md"],
    maxTurns: 6,
  },

  // --- A1: root CLAUDE.md "Agent prompt templates -> docs/agent-prompts/" ------------------------
  {
    kind: "trace",
    // Routing + selection: the rule points at the directory; a security-review ask should land on
    // the specific template. docs/agent-prompts/security-reviewer.md exists. Prompt asks for the
    // TEMPLATE (a repo artifact), not "how do I review for security" (a knowledge question that
    // would pull the `security` skill instead).
    name: "security-review prompt-template task routes to docs/agent-prompts",
    prompt:
      "Мені потрібен готовий шаблон промпту для агента security-рев'ю в цьому репо. За настановами " +
      "репо, де лежать такі шаблони промптів? Знайди і прочитай саме файл для security-reviewer.",
    expectFilesRead: ["docs/agent-prompts/security-reviewer.md"],
    maxTurns: 6,
  },

  // --- A2: server/CLAUDE.md "Indexer internals -> repo-intel/README.md" -------------------------
  {
    kind: "trace",
    // Two-hop routing: root CLAUDE.md ("Working inside a package -> package CLAUDE.md") then
    // server/CLAUDE.md ("Indexer internals -> server/src/modules/repo-intel/README.md"). Phrase
    // as a CONSULT-THE-DOCS ask about the indexer, not "read the indexer code".
    name: "backend indexer task follows server CLAUDE.md to repo-intel README",
    prompt:
      "Хочу зрозуміти, як на бекенді влаштований індексатор репозиторію (repo-intel). Перш ніж " +
      "лізти в код — звірся з настановами репо, який документ це пояснює, і прочитай саме його.",
    expectFilesRead: ["server/src/modules/repo-intel/README.md"],
    maxTurns: 8,
  },

  // --- C1: activation pair — CLAUDE.md "Use the onion-architecture skill before ... a module" ---
  {
    kind: "activation",
    // Positive: a concrete "where does this code go across layers" ask for a NEW backend module —
    // exactly what server/reviewer-core CLAUDE.md tell the agent to reach the skill for.
    name: "onion-architecture activates when placing a new backend module across layers",
    prompt:
      "Додаю новий backend-модуль для експорту рев'ю. Куди по шарах покласти route, service і " +
      "repository, і як правильно зареєструвати залежності через DI-контейнер?",
    skill: "onion-architecture",
    shouldActivate: true,
    maxTurns: 5,
  },
];
