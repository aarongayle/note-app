import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react'
import { KEYBOARD_FONT_SIZE_PX, LINE_SPACING, CANVAS_TYPING_INK } from '../lib/canvasConstants.js'

const RESIZE_HANDLE_W = 8
/** ~screen px — actual size is divided by zoom inside the scaled canvas. */
const UI_HANDLE = 20
const UI_HANDLE_OFF = 10

/**
 * Renders all textboxes for a note inside the scaled-inner coordinate space.
 * Positions are in note-coordinate pixels (same space as strokes).
 *
 * @param {{
 *   textBoxes: Array<{ id: string, x: number, y: number, width: number, content: string, rotation?: number }>,
 *   editingId: string | null,
 *   selectedIds: string[],
 *   isTextMode: boolean,
 *   isSelectMode: boolean,
 *   noteZoom: number,
 *   onSelectTextBox: (id: string) => void,
 *   onEditFromSelect: (id: string) => void,
 *   onTextBoxEditBlur: (id: string) => void,
 *   onStartEdit: (id: string) => void,
 *   onCommitEdit: (id: string, content: string) => void,
 *   onDelete: (id: string) => void,
 *   onResize: (id: string, newWidth: number) => void,
 *   onMove: (id: string, newX: number, newY: number) => void,
 *   onRotate: (id: string, rotation: number) => void,
 *   onHeightChange: (id: string, height: number) => void,
 * }} props
 */
export default function TextBoxesLayer({
  textBoxes,
  editingId,
  selectedIds,
  isTextMode,
  isSelectMode,
  noteZoom = 1,
  onSelectTextBox,
  onEditFromSelect,
  onTextBoxEditBlur,
  onStartEdit,
  onCommitEdit,
  onDelete,
  onResize,
  onMove,
  onRotate,
  onHeightChange,
}) {
  if (!textBoxes || textBoxes.length === 0) return null

  const layerZ = isTextMode || isSelectMode ? 6 : undefined

  return (
    <div
      className="absolute left-0 top-0 pointer-events-none"
      style={{ width: 0, height: 0, zIndex: layerZ }}
    >
      {textBoxes.map((tb) => (
        <TextBox
          key={tb.id}
          textBox={tb}
          isEditing={editingId === tb.id}
          isSelected={selectedIds.includes(tb.id)}
          isTextMode={isTextMode}
          isSelectMode={isSelectMode}
          noteZoom={noteZoom}
          onSelectTextBox={onSelectTextBox}
          onEditFromSelect={onEditFromSelect}
          onTextBoxEditBlur={onTextBoxEditBlur}
          onStartEdit={onStartEdit}
          onCommitEdit={onCommitEdit}
          onDelete={onDelete}
          onResize={onResize}
          onMove={onMove}
          onRotate={onRotate}
          onHeightChange={onHeightChange}
        />
      ))}
    </div>
  )
}

function TextBox({
  textBox,
  isEditing,
  isSelected,
  isTextMode,
  isSelectMode,
  noteZoom,
  onSelectTextBox,
  onEditFromSelect,
  onTextBoxEditBlur,
  onStartEdit,
  onCommitEdit,
  onDelete,
  onResize,
  onMove,
  onRotate,
  onHeightChange,
}) {
  const taRef = useRef(null)
  const divRef = useRef(null)
  const [isHovered, setIsHovered] = useState(false)
  const s = 1 / Math.max(noteZoom, 0.05)
  const h = UI_HANDLE * s
  const off = UI_HANDLE_OFF * s
  const borderW = 2 * s
  const resizeW = RESIZE_HANDLE_W * s
  const resizeH = 24 * s

  // Focus textarea when entering edit mode. useLayoutEffect runs synchronously
  // after the DOM update, before pointerup/click can steal focus away.
  useLayoutEffect(() => {
    if (isEditing && taRef.current) {
      taRef.current.focus()
      const len = taRef.current.value.length
      taRef.current.setSelectionRange(len, len)
    }
  }, [isEditing])

  // Auto-grow height and report it upstream for SVG chrome placement.
  const autoGrow = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
    onHeightChange?.(textBox.id, ta.scrollHeight)
  }, [textBox.id, onHeightChange])

  useEffect(() => {
    autoGrow()
  })

  const handlePointerDown = useCallback(
    (e) => {
      if (isSelectMode) {
        e.stopPropagation()
        onSelectTextBox?.(textBox.id)
        return
      }
      if (!isTextMode) return
      e.stopPropagation()
      onStartEdit(textBox.id)
    },
    [isTextMode, isSelectMode, textBox.id, onStartEdit, onSelectTextBox]
  )

  const handleTextAreaPointerDownSelect = useCallback(
    (e) => {
      if (!isSelectMode) return
      e.stopPropagation()
      onEditFromSelect?.(textBox.id)
    },
    [isSelectMode, textBox.id, onEditFromSelect]
  )

  const handleTextAreaBlur = useCallback(() => {
    onTextBoxEditBlur?.(textBox.id)
  }, [textBox.id, onTextBoxEditBlur])

  const handleChange = useCallback(
    (e) => {
      onCommitEdit(textBox.id, e.target.value)
      autoGrow()
    },
    [textBox.id, onCommitEdit, autoGrow]
  )

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        taRef.current?.blur()
      }
    },
    []
  )

  const handleDeletePointerDown = useCallback((e) => {
    // Prevent the textarea from blurring before the click fires.
    e.preventDefault()
  }, [])

  const handleDeleteClick = useCallback(
    (e) => {
      e.stopPropagation()
      onDelete?.(textBox.id)
    },
    [textBox.id, onDelete]
  )

  // Right-edge resize handle drag.
  const handleResizePointerDown = useCallback(
    (e) => {
      e.stopPropagation()
      e.preventDefault()
      const startX = e.clientX
      const startWidth = textBox.width

      const onMoveResize = (mv) => {
        const el = taRef.current?.closest('[data-notezoom]')
        const zoom = el ? parseFloat(el.dataset.notezoom) : 1
        const delta = (mv.clientX - startX) / (zoom || 1)
        const newW = Math.max(40, startWidth + delta)
        onResize(textBox.id, newW)
      }
      const onUpResize = () => {
        window.removeEventListener('pointermove', onMoveResize)
        window.removeEventListener('pointerup', onUpResize)
      }
      window.addEventListener('pointermove', onMoveResize)
      window.addEventListener('pointerup', onUpResize)
    },
    [textBox.id, textBox.width, onResize]
  )

  // Move handle drag — translates x/y in note-space coordinates.
  const handleMovePointerDown = useCallback(
    (e) => {
      e.stopPropagation()
      e.preventDefault()
      const startClientX = e.clientX
      const startClientY = e.clientY
      const baseX = textBox.x
      const baseY = textBox.y

      const onMoveDrag = (mv) => {
        const el = divRef.current?.closest('[data-notezoom]')
        const zoom = el ? parseFloat(el.dataset.notezoom) : 1
        const dx = (mv.clientX - startClientX) / zoom
        const dy = (mv.clientY - startClientY) / zoom
        onMove(textBox.id, baseX + dx, baseY + dy)
      }
      const onUpDrag = () => {
        window.removeEventListener('pointermove', onMoveDrag)
        window.removeEventListener('pointerup', onUpDrag)
      }
      window.addEventListener('pointermove', onMoveDrag)
      window.addEventListener('pointerup', onUpDrag)
    },
    [textBox.id, textBox.x, textBox.y, onMove]
  )

  // Rotate handle drag — computes angle from textbox center to pointer.
  const handleRotatePointerDown = useCallback(
    (e) => {
      e.stopPropagation()
      e.preventDefault()
      const rect = divRef.current?.getBoundingClientRect()
      if (!rect) return
      // Center is preserved under CSS rotation around center.
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const angle0 = Math.atan2(e.clientY - cy, e.clientX - cx)
      const baseRotation = textBox.rotation ?? 0

      const onMoveRotate = (mv) => {
        const ang = Math.atan2(mv.clientY - cy, mv.clientX - cx)
        const delta = ang - angle0
        onRotate(textBox.id, baseRotation + (delta * 180) / Math.PI)
      }
      const onUpRotate = () => {
        window.removeEventListener('pointermove', onMoveRotate)
        window.removeEventListener('pointerup', onUpRotate)
      }
      window.addEventListener('pointermove', onMoveRotate)
      window.addEventListener('pointerup', onUpRotate)
    },
    [textBox.id, textBox.rotation, onRotate]
  )

  const showControls = isEditing || isSelected || isHovered
  const rotation = textBox.rotation ?? 0

  return (
    <div
      ref={divRef}
      style={{
        position: 'absolute',
        left: textBox.x,
        top: textBox.y,
        width: textBox.width,
        pointerEvents: isTextMode || isSelectMode ? 'auto' : 'none',
        boxSizing: 'border-box',
        transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: 'center center',
      }}
      onPointerDown={handlePointerDown}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
    >
      {/* Controls: move handle (left), rotate handle (center), delete button (right) */}
      {showControls && (
        <>
          {/* Move handle */}
          <div
            onPointerDown={handleMovePointerDown}
            title="Move"
            style={{
              position: 'absolute',
              top: -off,
              left: -off,
              width: h,
              height: h,
              borderRadius: '50%',
              background: 'rgb(99 102 241)',
              border: `${borderW}px solid white`,
              cursor: 'grab',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'auto',
              zIndex: 10,
              boxShadow: `0 ${1 * s}px ${3 * s}px rgba(0,0,0,0.2)`,
            }}
          >
            <svg
              width={10 * s}
              height={10 * s}
              viewBox="0 0 10 10"
              style={{ pointerEvents: 'none' }}
            >
              <path
                d="M5 1v8M1 5h8M3 2.5L5 1l2 1.5M3 7.5L5 9l2-1.5M2.5 3L1 5l1.5 2M7.5 3L9 5l-1.5 2"
                fill="none"
                stroke="white"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {/* Rotate handle */}
          <div
            onPointerDown={handleRotatePointerDown}
            title="Rotate"
            style={{
              position: 'absolute',
              top: -off,
              left: '50%',
              transform: 'translateX(-50%)',
              width: h,
              height: h,
              borderRadius: '50%',
              background: 'rgb(99 102 241)',
              border: `${borderW}px solid white`,
              cursor: 'grab',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'auto',
              zIndex: 10,
              boxShadow: `0 ${1 * s}px ${3 * s}px rgba(0,0,0,0.2)`,
            }}
          >
            <svg
              width={10 * s}
              height={10 * s}
              viewBox="0 0 10 10"
              style={{ pointerEvents: 'none' }}
            >
              <path
                d="M8.5 5A3.5 3.5 0 1 1 6.5 1.8"
                fill="none"
                stroke="white"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M6 0.5L8 2.5l-2 1.5"
                fill="none"
                stroke="white"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {/* Delete button */}
          <button
            onPointerDown={handleDeletePointerDown}
            onClick={handleDeleteClick}
            title="Delete text box"
            style={{
              position: 'absolute',
              top: -off,
              right: -off,
              width: h,
              height: h,
              borderRadius: '50%',
              background: 'rgb(99 102 241)',
              border: `${borderW}px solid white`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'auto',
              padding: 0,
              color: 'white',
              fontSize: 10 * s,
              fontWeight: 'bold',
              zIndex: 10,
              boxShadow: `0 ${1 * s}px ${3 * s}px rgba(0,0,0,0.2)`,
            }}
          >
            ✕
          </button>
        </>
      )}

      <textarea
        ref={taRef}
        value={textBox.content}
        readOnly={!isEditing}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPointerDown={handleTextAreaPointerDownSelect}
        onBlur={handleTextAreaBlur}
        rows={1}
        style={{
          display: 'block',
          width: '100%',
          background: isEditing ? 'rgba(255,255,255,0.92)' : 'transparent',
          border: isEditing
            ? '1.5px solid rgb(99 102 241 / 0.7)'
            : isSelected || isHovered
              ? '1.5px dashed rgb(99 102 241 / 0.5)'
              : 'none',
          borderRadius: 3,
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          fontFamily: 'inherit',
          fontSize: KEYBOARD_FONT_SIZE_PX,
          lineHeight: `${LINE_SPACING}px`,
          color: CANVAS_TYPING_INK,
          padding: '2px 4px',
          boxSizing: 'border-box',
          cursor: isEditing
            ? 'text'
            : isSelectMode
              ? 'text'
              : isTextMode
                ? 'text'
                : 'default',
          caretColor: CANVAS_TYPING_INK,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
        spellCheck={isEditing}
        tabIndex={isEditing ? 0 : -1}
      />

      {/* Right-edge resize handle — visible when selected or editing */}
      {(isSelected || isEditing) && (
        <div
          onPointerDown={handleResizePointerDown}
          style={{
            position: 'absolute',
            right: -resizeW / 2,
            top: '50%',
            transform: 'translateY(-50%)',
            width: resizeW,
            height: resizeH,
            background: 'rgb(99 102 241)',
            borderRadius: 4 * s,
            cursor: 'ew-resize',
            pointerEvents: 'auto',
          }}
        />
      )}
    </div>
  )
}
