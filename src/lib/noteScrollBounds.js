import { LINE_SPACING } from './canvasConstants.js'
import { bottomExtentForEmbed } from './imageEmbedGeometry.js'

/** Matches default note canvas height in the store / Convex. */
export const MIN_NOTE_SCROLL_HEIGHT = 2000

/** Padding below the lowest ink so the last stroke isn't flush with the edge. */
export const BOTTOM_CONTENT_PAD = 280

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

function bottomFromImageEmbeds(imageEmbeds) {
  let bottom = 0
  for (const e of imageEmbeds ?? []) {
    bottom = Math.max(bottom, bottomExtentForEmbed(e))
  }
  return bottom
}

/**
 * Raw content bottom (logical px) from strokes, keyboard text, and image
 * embeds — without clamping or padding.  Text boxes are excluded because
 * their rendered height is only known in the client; callers that have access
 * to measured text-box heights should fold them in separately.
 *
 * @param {{ strokes?: unknown[], textBlocks?: { content: string }[], imageEmbeds?: unknown[] }} note
 */
export function contentBottomForNote(note) {
  return Math.max(
    bottomFromStrokes(note.strokes),
    bottomFromTextBlocks(note.textBlocks),
    bottomFromImageEmbeds(note.imageEmbeds)
  )
}

/**
 * Scroll height to persist: tall enough for ink and keyboard text, but not extra
 * canvas added only because the user scrolled.
 *
 * @param {{ strokes?: unknown[], textBlocks?: { content: string }[] }} note
 */
export function persistedScrollHeightForNote(note) {
  if (note.pdfBackgroundFileId || note.epubBackgroundFileId) {
    const contentBottom = contentBottomForNote(note)
    const fromBackground = note.scrollHeight ?? MIN_NOTE_SCROLL_HEIGHT
    return Math.max(
      MIN_NOTE_SCROLL_HEIGHT,
      Math.ceil(Math.max(fromBackground, contentBottom + BOTTOM_CONTENT_PAD))
    )
  }
  const bottom = contentBottomForNote(note)

  if (bottom <= 0) return MIN_NOTE_SCROLL_HEIGHT

  return Math.max(
    MIN_NOTE_SCROLL_HEIGHT,
    Math.ceil(bottom + BOTTOM_CONTENT_PAD)
  )
}
