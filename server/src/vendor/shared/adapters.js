import { z } from 'zod';
/**
 * Adapter interfaces. ALL external calls go behind these interfaces.
 * Real implementations live in `apps/api/src/adapters/*`; mock implementations
 * live alongside for tests/dev (Services depend on the interface, not the impl).
 */
// ---------- LLM ----------
export const ModelInfo = z.object({
    id: z.string(),
    provider: z.enum(['openai', 'anthropic', 'openrouter']),
    label: z.string().nullish(),
    created: z.number().int().nullish(),
    /** Pricing in USD per 1M tokens (when the provider exposes it, e.g. OpenRouter). */
    pricing: z
        .object({ promptPerM: z.number(), completionPerM: z.number() })
        .nullish(),
    /** Max context window in tokens (when the provider exposes it). */
    contextLength: z.number().int().nullish(),
});
//# sourceMappingURL=adapters.js.map