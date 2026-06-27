/** Constants for the skills module. */

/** Initial body version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Default skill type when none can be inferred on import. */
export const DEFAULT_SKILL_TYPE = 'custom' as const;

/** Default skill source for a hand-authored skill. */
export const DEFAULT_SKILL_SOURCE = 'manual' as const;

/** Default description when none is supplied on insert. */
export const DEFAULT_SKILL_DESCRIPTION = '';

/**
 * Hard cap on an uploaded import payload (decoded bytes). Skills are small text
 * rubrics; this only exists to refuse an accidental multi-MB archive before we
 * decompress it. 1 MiB is generous for a markdown skill + a few sidecar files.
 */
export const MAX_IMPORT_BYTES = 1024 * 1024;
