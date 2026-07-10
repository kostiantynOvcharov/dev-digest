import { createHash } from 'node:crypto';

/**
 * Stable hash of a file's patch text — used to detect whether a cached
 * per-file artifact (e.g. a Diff Summary entry) is still current for the
 * file's CURRENT hunk content. Pure, no I/O: both the generator (diff-summary
 * service) and the reader (Smart Diff GET) import this SAME helper so they can
 * never disagree on what counts as "unchanged" (mirrors how `smart-diff.ts`'s
 * `composeSmartDiff` is shared between `brief` and this module).
 *
 * `null`/`undefined` (binary/rename/no-textual-diff files) hash to the SAME
 * sentinel every time so repeated calls agree without a special case at the
 * call sites.
 */
export function hunkHash(patch: string | null | undefined): string {
  return createHash('sha1').update(patch ?? '').digest('hex');
}
