/**
 * repo-intel pipeline — markdown doc walk (Project Context / SPEC-01).
 *
 * A markdown sibling to `walk.ts`. Where `walkClone` collects code files for the
 * indexer, `walkDocs` collects `.md` files that live under a configured ROOT
 * folder name (default `specs`/`docs`/`insights`) at ANY depth, tagging each
 * with the matched root name so the caller can derive a type badge.
 *
 * Guards reused from the code walker (`constants.ts`):
 *   - MAX_FILE_SIZE     — a `.md` larger than this is skipped (oversized/binary).
 *   - MAX_INDEXED_FILES — the result is bounded to the first N by sorted path.
 *
 * EXCLUDED_DIRS precedence (Decision D3): a folder whose name matches a
 * configured root is ALWAYS scanned — even when it (or a parent) would otherwise
 * be excluded. We honor that by descending through every directory and only
 * COLLECTING `.md` once we are inside a configured-root subtree. Consequences:
 *   - Loose markdown outside any configured root (e.g. a repo-root `README.md`,
 *     or `dist/notes.md`) is never collected — the spirit of EXCLUDED_DIRS.
 *   - A configured root nested below an excluded parent (e.g. `vendor/docs/x.md`)
 *     IS collected — the D3 exception. This is the documented, accepted trade-off
 *     (SPEC-01 Risks: "a configured root inside an ignored path is still scanned
 *     by design").
 *
 * Returns repo-relative POSIX paths only — never absolute clone paths (security:
 * stored/serialized paths must not leak the on-disk clone location).
 *
 * Pure-ish: takes a root path + does fs ops; returns plain data.
 */
import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { MAX_FILE_SIZE, MAX_INDEXED_FILES } from '../constants.js';

const MD_EXT = '.md';

/** One discovered markdown doc. `type` is the matched root folder NAME (raw);
 * the caller canonicalizes it to a `ContextDocType` badge. */
export interface DiscoveredDocFile {
  /** Repo-relative POSIX path (never absolute). */
  path: string;
  /** The configured root folder name this doc was found under. */
  type: string;
  sizeBytes: number;
}

/**
 * Recursively discover `.md` docs under any folder named in `rootNames`.
 * Returns a stable (path-sorted) list, bounded to MAX_INDEXED_FILES.
 */
export async function walkDocs(
  root: string,
  rootNames: readonly string[],
): Promise<DiscoveredDocFile[]> {
  const rootSet = new Set(rootNames.filter((n) => n.length > 0));
  const out: DiscoveredDocFile[] = [];

  // Nothing is discoverable without at least one configured root.
  if (rootSet.size > 0) {
    await walkDir(root, root, null, rootSet, out);
  }

  // Stable order: alphabetical relpath — keeps "first N when bounded" and the
  // snapshot reproducible across reindexes.
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (out.length > MAX_INDEXED_FILES) out.length = MAX_INDEXED_FILES;

  return out;
}

/**
 * @param activeType the configured root name we are currently inside, or `null`
 *   when we have not yet descended into a configured root. `.md` files are only
 *   collected while `activeType !== null`. A nested configured root re-tags the
 *   subtree (nearest matched root wins).
 */
async function walkDir(
  root: string,
  dir: string,
  activeType: string | null,
  rootSet: ReadonlySet<string>,
  out: DiscoveredDocFile[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory (permissions, dangling symlink) — skip cleanly.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks (loops, perf)
    const name = entry.name;

    if (entry.isDirectory()) {
      // A directory whose name matches a configured root (re)starts collection
      // for its subtree; otherwise carry the current activeType down so we keep
      // searching for roots (including through EXCLUDED_DIRS — Decision D3).
      const nextType = rootSet.has(name) ? name : activeType;
      await walkDir(root, join(dir, name), nextType, rootSet, out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (activeType === null) continue; // only `.md` inside a configured root
    if (extname(name).toLowerCase() !== MD_EXT) continue;

    const full = join(dir, name);
    let size: number;
    try {
      size = (await stat(full)).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_SIZE) continue; // oversized/binary — skip like the code walker

    // POSIX-relative path so DB rows are platform-agnostic (matches the
    // `pr_files.path` / code-walker convention). Never the absolute clone path.
    const rel = relative(root, full).split(sep).join('/');
    out.push({ path: rel, type: activeType, sizeBytes: size });
  }
}
