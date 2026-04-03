import { useCallback, useEffect, useRef, useMemo, memo } from 'react'
import { LINE_SPACING, CANVAS_TYPING_INK, TEXT_SIZES } from '../lib/canvasConstants.js'

function textStyleForSize(size) {
  const tier = TEXT_SIZES[size] ?? TEXT_SIZES.medium
  return { fontSize: tier.fontSize, lineHeight: `${tier.lineHeight}px` }
}

const DRAG_THRESHOLD_PX = 5

const TextBox = memo(function TextBox({
  textBox,
  noteZoom,
  isEditing,
  isSelected,
  isSelectMode,
  isTextMode,
  onStartEdit,
  onEditFromSelect,
  onCommitEdit,
  onHeightChange,
  onTextBoxEditBlur,
  onSelectTextBox,
  onDelete,
  onResize,
  onMove,
}) {
  const editRef = useRef(null)
  const lastHtmlRef = useRef(null)

  const syncHeight = useCallback(() => {
    if (!editRef.current) return
    const { scrollHeight } = editRef.current
    const s = textStyleForSize(textBox.size)
    const minH = parseFloat(s.lineHeight) + 4
    const newH = Math.max(minH, scrollHeight)
    if (newH !== textBox.height) onHeightChange(textBox.id, newH)
  }, [textBox.id, textBox.size, textBox.height, onHeightChange])

  useEffect(() => {
    if (!isEditing) return
    const el = editRef.current
    if (!el) return
    if (lastHtmlRef.current !== textBox.content) {
      el.innerHTML = textBox.content || ''
      lastHtmlRef.current = textBox.content
    }
    el.focus()
    const sel = window.getSelection()
    if (sel) {
      sel.selectAllChildren(el)
      sel.collapseToEnd()
    }
  }, [isEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isEditing) return
    const el = editRef.current
    if (!el) return
    if (el.innerHTML !== (textBox.content || '')) {
      el.innerHTML = textBox.content || ''
    }
    lastHtmlRef.current = textBox.content
  }, [isEditing, textBox.content])

  useEffect(() => { syncHeight() }, [syncHeight, textBox.size])

  const isInitialMount = useRef(true)
  useEffect(() => {
    if (isInitialMount.current) { isInitialMount.current = false; return }
    syncHeight()
  }, [textBox.content, syncHeight])

  const handleInput = useCallback(() => {
    if (!editRef.current) return
    const html = editRef.current.innerHTML
    lastHtmlRef.current = html
    onCommitEdit(textBox.id, html)
  }, [textBox.id, onCommitEdit])

  const handleBlur = useCallback(
    (e) => {
      if (e.relatedTarget === editRef.current) return
      onTextBoxEditBlur(textBox.id)
    },
    [textBox.id, onTextBoxEditBlur],
  )

  // ── Pointer interactions ──────────────────────────────────────────────

  const handleWrapperPointerDown = useCallback(
    (e) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()

      if (isEditing) return

      // -- Text mode: always start editing immediately --
      if (isTextMode) {
        onStartEdit(textBox.id)
        return
      }

      // -- Select mode --
      if (!isSelectMode) return

      if (!isSelected) {
        // First click on an unselected box → just select it.
        onSelectTextBox(textBox.id)
        return
      }

      // Already selected: click→edit OR drag→move.
      const startX = e.clientX
      const startY = e.clientY
      const origX = textBox.x
      const origY = textBox.y
      const zoom = noteZoom || 1
      let dragging = false

      const handlePointerMove = (me) => {
        const dx = me.clientX - startX
        const dy = me.clientY - startY
        if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
        dragging = true
        onMove(textBox.id, origX + dx / zoom, origY + dy / zoom)
      }

      const handlePointerUp = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
        if (!dragging) {
          // Was a click — start editing the already-selected box.
          onEditFromSelect(textBox.id)
        }
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [isEditing, isTextMode, isSelectMode, isSelected, noteZoom,
     onStartEdit, onEditFromSelect, onSelectTextBox, onMove,
     textBox.id, textBox.x, textBox.y],
  )

  const handleResizePointerDown = useCallback(
    (e) => {
      e.stopPropagation()
      e.preventDefault()
      const startX = e.clientX
      const startW = textBox.width
      const zoom = noteZoom || 1
      const handlePointerMove = (me) => {
        onResize(textBox.id, Math.max(60, startW + (me.clientX - startX) / zoom))
      }
      const handlePointerUp = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    },
    [noteZoom, onResize, textBox.id, textBox.width],
  )

  const handleDeleteClick = useCallback(
    (e) => {
      e.stopPropagation()
      e.preventDefault()
      onDelete(textBox.id)
    },
    [onDelete, textBox.id],
  )

  // ── Render ────────────────────────────────────────────────────────────

  const sizeStyle = textStyleForSize(textBox.size)
  const lineHeightNum = parseFloat(sizeStyle.lineHeight)
  const showChrome = isSelected && !isEditing

  return (
    <div
      data-text-box-wrapper
      data-text-box-id={textBox.id}
      onPointerDown={handleWrapperPointerDown}
      style={{
        position: 'absolute',
        left: textBox.x,
        top: textBox.y,
        width: textBox.width,
        ...(textBox.height ? { minHeight: textBox.height } : {}),
        cursor: isEditing ? 'text'
          : isSelectMode && isSelected ? 'move'
          : (isSelectMode || isTextMode) ? 'text'
          : 'default',
        zIndex: isEditing ? 10 : isSelected ? 5 : 1,
      }}
    >
      {/* Selection chrome — shown when selected but not actively editing */}
      {showChrome && (
        <>
          {/* Dashed border */}
          <div
            style={{
              position: 'absolute', inset: -3,
              border: '1.5px dashed rgb(99 102 241 / 0.5)',
              borderRadius: 3, pointerEvents: 'none',
            }}
          />

          {/* Delete × button — top-left */}
          <div
            onPointerDown={handleDeleteClick}
            style={{
              position: 'absolute', top: -14, left: -14,
              width: 20, height: 20,
              background: 'rgb(99 102 241)', borderRadius: '50%',
              border: '1.5px solid white', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: 12, fontWeight: 700,
              fontFamily: 'system-ui, sans-serif', userSelect: 'none',
              lineHeight: 1, zIndex: 4,
            }}
          >
            &times;
          </div>

          {/* Resize handle — bottom-right */}
          <div
            onPointerDown={handleResizePointerDown}
            style={{
              position: 'absolute', right: -4, bottom: -4,
              width: 12, height: 12,
              background: 'rgb(99 102 241)', borderRadius: '50%',
              cursor: 'nwse-resize', border: '1.5px solid white',
              zIndex: 4,
            }}
          />
        </>
      )}

      {/* contentEditable text area */}
      <div
        ref={editRef}
        contentEditable={isEditing}
        suppressContentEditableWarning
        onInput={isEditing ? handleInput : undefined}
        onBlur={isEditing ? handleBlur : undefined}
        style={{
          display: 'block', width: '100%',
          background: isEditing ? 'rgba(255,255,255,0.92)' : 'transparent',
          border: isEditing ? '1.5px solid rgb(99 102 241 / 0.7)' : 'none',
          borderRadius: 3, outline: 'none', overflow: 'hidden',
          fontFamily: 'inherit', ...sizeStyle,
          color: CANVAS_TYPING_INK,
          padding: '2px 4px', boxSizing: 'border-box',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          minHeight: lineHeightNum + 4,
          ...(!isEditing ? { pointerEvents: 'none' } : {}),
        }}
      />
    </div>
  )
})

// ═══════════════════════════════════════════════════════════════════════════

export default function TextBoxesLayer({
  textBoxes,
  noteZoom,
  isSelectMode,
  isTextMode,
  editingId,
  onStartEdit,
  onEditFromSelect,
  onCommitEdit,
  onHeightChange,
  onTextBoxEditBlur,
  onSelectTextBox,
  onDelete,
  onResize,
  onMove,
  onRotate,
  selectedIds,
}) {
  const selectedBoxIds = useMemo(() => new Set(selectedIds ?? []), [selectedIds])

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
      {textBoxes.map((tb) => (
        <div key={tb.id} style={{ pointerEvents: 'auto' }}>
          <TextBox
            textBox={tb}
            noteZoom={noteZoom}
            isEditing={editingId === tb.id}
            isSelected={selectedBoxIds.has(tb.id)}
            isSelectMode={isSelectMode}
            isTextMode={isTextMode}
            onStartEdit={onStartEdit}
            onEditFromSelect={onEditFromSelect}
            onCommitEdit={onCommitEdit}
            onHeightChange={onHeightChange}
            onTextBoxEditBlur={onTextBoxEditBlur}
            onSelectTextBox={onSelectTextBox}
            onDelete={onDelete}
            onResize={onResize}
            onMove={onMove}
            onRotate={onRotate}
          />
        </div>
      ))}
    </div>
  )
}
