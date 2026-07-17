# Cross-model plan review — SPEC-02 Why+Risk Brief

> Independent staff-engineer review of `docs/plans/spec-02-why-risk-brief.md`.
> Reviewer model: **google/gemini-2.5-pro** (via OpenRouter), no access to the implementation chat.
> Tokens: prompt 20519 / completion 4870.

---

This implementation plan is strong, demonstrating a deep understanding of the existing architecture, its constraints, and the feature spec. It correctly identifies the `intent` module as a template, respects module boundaries, and proposes a logical work breakdown. However, the plan contains several significant omissions and risks related to concurrency, observability, and architectural purity that must be addressed before implementation. While the core logic is sound, these gaps could lead to resource waste, poor user experience, difficult-to-debug production issues, and future maintenance burdens.

Here are the specific findings:

1.  **[BLOCKER] Critical Race Condition in Generation.** The plan correctly notes that concurrent generations will be resolved by a database `upsert`, with the last writer winning. This is insufficient. If two users click "Generate" simultaneously for the same PR, the system will initiate **two separate, expensive LLM calls**, burning money and compute for a result that will be immediately discarded. This also creates a confusing UX where a user might see the UI update with a brief, only to have it flicker and be replaced by the result of the second, concurrent call.
    *   **Problem:** The plan lacks a mechanism to prevent multiple in-flight generation requests for the same PR.
    *   **Why it matters:** This is a classic race condition that leads to significant resource waste (doubling LLM costs) and a poor, unpredictable user experience.
    *   **Suggested fix:** Implement a generation lock. In `brief/service.ts`'s `generate` method, before initiating any work, attempt to acquire a lock for the `prId` (e.g., using an in-memory set/map on the service instance, or a more robust Redis-based lock if available). If the lock is already held, the second request should immediately return an error (e.g., HTTP 409 Conflict) with a message like "Generation is already in progress for this PR." The lock must be released in a `finally` block to prevent deadlocks on error.

2.  **[MAJOR] Missing Input Provenance for Debugging.** The plan specifies storing the LLM output (`Brief`) and metadata (`head_sha`, `cost`, etc.). It does not include storing the *inputs* that were fed to the LLM. The brief is a synthesis of multiple, potentially changing inputs (Intent, Blast Radius, linked issue, agent specs). When a user reports a "bad" or nonsensical brief, it will be impossible to reproduce the generation without knowing the exact inputs used at that time.
    *   **Problem:** The cached artifact (`pr_brief.json`) does not record the inputs used to generate it.
    *   **Why it matters:** This makes debugging, quality evaluation, and future model fine-tuning nearly impossible. It violates the principle of observability for critical, non-deterministic systems.
    *   **Suggested fix:** Augment the `BriefStored` schema in Unit 1 to include an `inputs` field. This field should contain a snapshot of all data passed to the `buildBriefMessages` helper in Unit 2 (e.g., the intent text, blast summary, issue body, spec contents). This ensures every generated brief is fully reproducible.

3.  **[MAJOR] Optional Fix for Critical Code Duplication.** The plan correctly identifies that merging an agent's direct and skill-inherited docs (D2) duplicates logic from `run-executor.runOneAgent`. However, it flags the proper fix—extracting a shared `resolveContextDocPaths(agentId)` method on the agents service—as a "recommendation" and "optional." This is a mistake.
    *   **Problem:** Leaving a known, critical piece of business logic duplicated across two modules is an architectural smell that guarantees future divergence and bugs.
    *   **Why it matters:** If the logic for resolving context docs changes in one place but not the other, the brief will be generated with a different context than the main review run, breaking user expectations and trust in the feature. This is not optional; it's a requirement for correctness.
    *   **Suggested fix:** Mandate the refactoring as part of this work. Unit 3's scope must include creating a new method on `container.agentsService` (or a similar shared location) to resolve all context docs for a given agent, and then updating both `run-executor` and the new `brief/service.ts` to use it.

4.  **[MAJOR] Risk of Persisting Useless Empty Output.** The plan handles LLM *failures* (AC-10), but not structurally valid but content-empty *successes*. An LLM can technically satisfy the `Brief` schema by returning `{ what: '', why: '', risk_level: 'low', risks: [], review_focus: [] }`. If this happens, the `upsertBrief` call would happily overwrite a previously useful, detailed brief with this useless empty shell.
    *   **Problem:** The plan lacks a validation step to check for content-free LLM output before persisting.
    *   **Why it matters:** This can lead to silent data loss, where a user's action ("Regenerate") results in a worse state than before, with no error message.
    *   **Suggested fix:** In `brief/service.ts` (Unit 3), after the LLM call and before the `groundBrief` step, add a simple validation check. If `rawBrief.what` and `rawBrief.why` are both empty (or whitespace-only), treat it as a generation failure. Throw an `ExternalServiceError` with a message like "The model returned an empty brief. Please try again." Do not persist the result.

5.  **[MINOR] Incomplete Client Plan for Endpoint Links.** The plan's "discretion item 2" for grounding is smart: it distinguishes file paths from endpoint strings. However, the client-side plan (Unit 4) is vague, simply stating "clickable `file_refs` file/endpoint links." This doesn't account for the two different types of references. A file path should become a link to the file viewer, but an endpoint string (e.g., `POST /api/v1/users`) has no natural target URL.
    *   **Problem:** The client work-unit (U4) does not specify *how* it will render endpoint references differently from file path references.
    *   **Why it matters:** This will either lead to broken links (if it tries to treat an endpoint string as a file path) or a failure to meet the user story (US-3) of providing actionable references for non-file risks.
    *   **Suggested fix:** Update the plan for Unit 4. The `PrBriefCard` component must include logic to differentiate reference types. For each `file_ref` in a `risk`: if it looks like a file path (e.g., contains `/`), render it as a link to the file viewer. If it does not, render it as plain, non-clickable text (e.g., with a specific icon to denote it's an endpoint).

6.  **[MINOR] Insufficient Verification for Security and Grounding Logic.** The plan's testing strategy is generally good, but has two specific gaps:
    1.  The test for the grounding gate (Unit 2) doesn't explicitly verify the plan's own discretionary rule: that a non-file-path reference is kept *if and only if* it matches a string from the `endpoints_affected` input.
    2.  The plan correctly states that sensitive input text (PR body, specs) should not be logged, but there is no verification step to confirm this.
    *   **Problem:** The test plan does not fully cover the implementation's own stated security and correctness promises.
    *   **Why it matters:** Untested security controls are unreliable. The complex grounding logic for endpoints could easily have an off-by-one or regex error that goes uncaught.
    *   **Suggested fix:**
        1.  Expand the `brief/helpers.test.ts` (Unit 2) to include explicit test cases for the endpoint grounding rule: a ref that is not a file but is in `endpointsAffected` is kept; a ref that is neither is dropped.
        2.  Add a step to the `brief.it.test.ts` (Unit 3) verification that spies on the logger and asserts that during a `generate` call, no log messages at `info` level or higher contain the raw text of the PR body or spec documents.

***

**The single most important thing to change before implementation is to address the [BLOCKER] race condition.** The plan must be updated to include a locking mechanism that prevents concurrent LLM calls for the same pull request, as this directly impacts cost, system stability, and user experience.
