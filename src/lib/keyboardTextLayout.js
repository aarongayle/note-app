import {
  LINE_SPACING,
  KEYBOARD_HORIZONTAL_PADDING_PX,
} from './canvasConstants.js'

const TEXT_PAD_TOP_PX = 2

/**
 * Approximate bottom edge (layout px from textarea top) of wrapped text including
 * bottom padding band, for hit-testing vs. synthetic newline insertion.
 */
export function estimatedWrappedTextBottomLayoutPx(textarea, zoom, measureCtx) {
  const line = LINE_SPACING * zoom
  const padL = KEYBOARD_HORIZONTAL_PADDING_PX * zoom
  const padR = KEYBOARD_HORIZONTAL_PADDING_PX * zoom
  const padBottom = line
  const innerW = Math.max(1, textarea.clientWidth - padL - padR)
  const rawLines =
    textarea.value.length === 0 ? [''] : textarea.value.split('\n')
  let visualRows = 0
  for (const segment of rawLines) {
    if (!measureCtx) {
      visualRows += 1
      continue
    }
    const w = measureCtx.measureText(segment.length ? segment : ' ').width
    visualRows += Math.max(1, Math.ceil(w / innerW))
  }
  return TEXT_PAD_TOP_PX + visualRows * line + padBottom
}

/**
 * Pixel height needed to display `text` with fixed line height (textarea padding included).
 */
export function keyboardTextContentHeightPx(
  text,
  lineSpacingPx,
  padTopPx,
  padBottomPx
) {
  const lineCount = text.length === 0 ? 1 : text.split('\n').length
  return padTopPx + lineCount * lineSpacingPx + padBottomPx
}

function lineStartOffsets(lines) {
  const offsets = []
  let o = 0
  for (let i = 0; i < lines.length; i++) {
    offsets.push(o)
    o += (lines[i]?.length ?? 0) + 1
  }
  return offsets
}

/**
 * Column index in `line` for click at `x` px from the left content edge (0 = before first char).
 */
export function columnAtX(line, x, ctx) {
  if (x <= 0) return 0
  const w = ctx.measureText(line).width
  if (x >= w) return line.length
  let lo = 0
  let hi = line.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(line.slice(0, mid)).width <= x) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * After a click at (clientX, clientY), returns updated value (with trailing newlines if needed)
 * and caret offset. Caller should preventDefault on pointerdown before focus/selection.
 */
export function valueAndCaretForCanvasClick(
  value,
  clientX,
  clientY,
  textareaRect,
  ctx,
  {
    lineSpacingPx,
    padLeftPx,
    padTopPx,
  }
) {
  const x = clientX - textareaRect.left - padLeftPx
  const y = clientY - textareaRect.top - padTopPx
  let row = Math.floor(y / lineSpacingPx)
  if (row < 0) row = 0

  let lines = value.length === 0 ? [''] : value.split('\n')
  const neededRows = row + 1
  let nextValue = value
  if (lines.length < neededRows) {
    const add = neededRows - lines.length
    nextValue = value + '\n'.repeat(add)
    lines = nextValue.split('\n')
  }

  const line = lines[row] ?? ''
  const col = columnAtX(line, x, ctx)
  const starts = lineStartOffsets(lines)
  const index = Math.min(
    nextValue.length,
    (starts[row] ?? 0) + col
  )

  return { nextValue, index }
}
