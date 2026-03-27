const STORAGE_KEY = 'noteViewState'

let cache = null

function readAll() {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    cache = {}
  }
  return cache
}

function writeAll(data) {
  cache = data
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch { /* quota exceeded — best-effort */ }
}

/**
 * Read per-device view state for a note.
 * Returns `{ lastScrollY, inputMode, zoom }` with undefined for missing keys.
 */
export function getViewState(noteId) {
  return readAll()[noteId] ?? {}
}

/**
 * Merge a partial update into the stored view state for a note.
 * Only the provided keys are overwritten.
 */
export function setViewState(noteId, partial) {
  const all = readAll()
  all[noteId] = { ...all[noteId], ...partial }
  writeAll(all)
}

/**
 * Remove view state for a deleted note.
 */
export function deleteViewState(noteId) {
  const all = readAll()
  delete all[noteId]
  writeAll(all)
}

/**
 * Seed a note's view state from server data (migration). Only writes keys
 * that don't already exist in localStorage, so local values always win.
 */
export function seedViewStateFromServer(noteId, { zoom, inputMode, lastScrollY }) {
  const all = readAll()
  const existing = all[noteId] ?? {}
  let changed = false
  if (existing.zoom == null && zoom != null) { existing.zoom = zoom; changed = true }
  if (existing.inputMode == null && inputMode != null) { existing.inputMode = inputMode; changed = true }
  if (existing.lastScrollY == null && lastScrollY != null) { existing.lastScrollY = lastScrollY; changed = true }
  if (changed) {
    all[noteId] = existing
    writeAll(all)
  }
}
