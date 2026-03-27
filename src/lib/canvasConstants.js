/** Matches template line / grid spacing in Canvas (px). */
export const LINE_SPACING = 24

/** Single persisted text block id for keyboard body content. */
export const KEYBOARD_DOC_BLOCK_ID = 'keyboard-doc'

/** Body text size tuned so one line fits within one template row. */
export const KEYBOARD_FONT_SIZE_PX = 15

export const KEYBOARD_HORIZONTAL_PADDING_PX = 12

/** Ink on white canvas (theme `text-primary` is for dark panels, not the page). */
export const CANVAS_TYPING_INK = '#171717'

/** Per-textbox size tiers — half / default / double of the base row. */
export const TEXT_SIZES = {
  small:  { fontSize: 7.5, lineHeight: 12 },
  medium: { fontSize: KEYBOARD_FONT_SIZE_PX, lineHeight: LINE_SPACING },
  large:  { fontSize: 30, lineHeight: 48 },
}

/** Toolbar zoom in/out multiplicative step. */
export const NOTE_ZOOM_BUTTON_STEP = 1.12
