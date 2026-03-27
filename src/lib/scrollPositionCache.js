/**
 * Module-level cache of scroll positions (physical scrollTop) per note.
 * Used by Canvas to restore scroll across split-view toggles, and by
 * the Toolbar bookmark feature to read the current position.
 */
export const scrollPositionCache = new Map()
