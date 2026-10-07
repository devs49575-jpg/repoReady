/**
 * Version of the analysis engine (analyzers, scoring and their rules). Stored on each public
 * analysis; the commit-SHA cache only reuses results from the current version, so analyzer fixes
 * take effect immediately instead of after CACHE_TTL_HOURS.
 *
 * Bump this whenever a change alters what a report contains for the same commit.
 */
export const ENGINE_VERSION = 4;
