import { LINE_SPACING } from './canvasConstants.js'

/** Matches default note canvas height in the store / Convex. */
export const MIN_NOTE_SCROLL_HEIGHT = 2000

/** Padding below the lowest ink so the last stroke isn’t flush with the edge. */
const BOTTOM_CONTENT_PAD = 280

function bottomFromStrokes(strokes) {
  let bottom = 0
  for (const s of strokes ?? []) {
    const margin = s.options?.size ?? 3
    for (const p of s.points) {
      const y = p[1] + margin
      if (y > bottom) bottom = y
    }
  }
  return bottom
}

function bottomFromTextBlocks(textBlocks) {
  const text = (textBlocks ?? []).map((b) => b.content).join('\n')
  if (!text) return 0
  const logicalLines = text.split('\n').length
  /** Rough wrap estimate (no viewport width on server); keeps scroll tall enough after sync. */
  const approxWrappedLines = Math.max(
    logicalLines,
    Math.ceil(text.length / 40)
  )
  return approxWrappedLines * LINE_SPACING
}

/**
 * Scroll height to persist: tall enough for ink and keyboard text, but not extra
 * canvas added only because the user scrolled.
 *
 * @param {{ strokes?: unknown[], textBlocks?: { content: string }[] }} note
 */
export function persistedScrollHeightForNote(note) {
  const bottom = Math.max(
    bottomFromStrokes(note.strokes),
    bottomFromTextBlocks(note.textBlocks)
  )

  if (bottom <= 0) return MIN_NOTE_SCROLL_HEIGHT

  return Math.max(
    MIN_NOTE_SCROLL_HEIGHT,
    Math.ceil(bottom + BOTTOM_CONTENT_PAD)
  )
}
