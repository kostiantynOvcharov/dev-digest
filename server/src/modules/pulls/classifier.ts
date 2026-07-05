import type { SmartDiffRole } from '@devdigest/shared';
import { BOILERPLATE_PATTERNS, WIRING_PATTERNS } from './classifier.constants.js';

/**
 * Classify a changed file into a Smart Diff risk bucket from its PATH alone —
 * no patch/content inspection, so it's cheap, pure and runs the instant a PR
 * is imported (before any review).
 *
 *   core        business logic — the substance of the change, review closely
 *   wiring      config / entry / barrel files — hooks the core into the app
 *   boilerplate generated / mechanical (lock-files, dist, snapshots, migrations)
 *
 * Precedence is boilerplate → wiring → core: the more "ignorable" buckets are
 * matched first so a generated `dist/index.js` lands in boilerplate, not wiring.
 */
export function classifyFile(path: string): SmartDiffRole {
  // Normalize Windows separators so the patterns (forward-slash) match anywhere.
  const p = path.replace(/\\/g, '/');
  if (BOILERPLATE_PATTERNS.some((re) => re.test(p))) return 'boilerplate';
  if (WIRING_PATTERNS.some((re) => re.test(p))) return 'wiring';
  return 'core';
}
