/** Constants for the conventions module. */

/** How many top-ranked repo files to sample (in addition to config files). */
export const SAMPLE_FILE_COUNT = 12;

/** Config files probed at the repo root before the ranked samples. */
export const CONFIG_GLOBS = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'eslint.config.js',
  'eslint.config.mjs',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  'prettier.config.js',
  'package.json',
];

/** Cap per-file characters fed to the model so the prompt stays bounded. */
export const MAX_FILE_CHARS = 8_000;

/** Schema name for the structured extraction call. */
export const SCHEMA_NAME = 'ConventionCandidates';
