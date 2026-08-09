/**
 * Version of the engine's on-disk record formats — the event envelope and the
 * checkpoint payload. Bumped only when a record written by an older worker
 * would be misread by a newer one.
 */
export const ENGINE_FORMAT_VERSION = 1;
