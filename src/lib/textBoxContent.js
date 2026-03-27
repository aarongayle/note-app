/**
 * Text boxes with only whitespace are treated as empty for persistence and cleanup.
 * @param {string | undefined} content
 */
export function textBoxHasVisibleContent(content) {
  return typeof content === 'string' && content.trim().length > 0
}
