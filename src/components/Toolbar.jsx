import { useState, useRef, useCallback } from 'react'
import {
  Pen,
  PenLine,
  Highlighter,
  Eraser,
  LassoSelect,
  Type,
  MousePointer2,
  Minus,
  Plus,
  ZoomIn,
  ZoomOut,
  Undo2,
  Redo2,
  Columns2,
  Bookmark,
} from 'lucide-react'
import { NOTE_ZOOM_BUTTON_STEP } from '../lib/canvasConstants.js'
import useNotesStore, {
  PEN_TYPES,
  NOTE_ZOOM_MIN,
  NOTE_ZOOM_MAX,
} from '../stores/useNotesStore'
import { useDefaultNoteInputMode } from '../lib/noteInputDefaults.js'
import { scrollPositionCache } from '../lib/scrollPositionCache.js'
import PickSecondNoteDialog from './PickSecondNoteDialog'

const PEN_ICONS = {
  pen: Pen,
  marker: Highlighter,
  eraser: Eraser,
  lasso: LassoSelect,
}

/**
 * @param {{ noteId?: string }} props
 * When `noteId` is provided the toolbar targets that specific note
 * (used for per-pane toolbars in split view).  When omitted it falls
 * back to the global active-note / split-toolbar logic.
 */
export default function Toolbar({ noteId: noteIdProp } = {}) {
  const [splitPickerOpen, setSplitPickerOpen] = useState(false)
  const defaultInputMode = useDefaultNoteInputMode()

  const activeNoteId = useNotesStore((s) => s.activeNoteId)
  const splitViewNoteId = useNotesStore((s) => s.splitViewNoteId)

  const targetNoteId = useNotesStore((s) => {
    if (noteIdProp) return noteIdProp
    return s.splitViewNoteId != null
      ? s.splitToolbarNoteId ?? s.activeNoteId
      : s.activeNoteId
  })

  const inputMode = useNotesStore((s) => {
    if (!targetNoteId) return defaultInputMode
    return s.noteInputModes[targetNoteId] ?? defaultInputMode
  })

  const setNoteInputMode = useNotesStore((s) => s.setNoteInputMode)
  const setEditorInputMode = useNotesStore((s) => s.setEditorInputMode)

  const setMode = useCallback(
    (mode) => {
      if (noteIdProp) {
        setNoteInputMode(noteIdProp, mode)
      } else {
        setEditorInputMode(mode)
      }
    },
    [noteIdProp, setNoteInputMode, setEditorInputMode],
  )

  const activePen = useNotesStore((s) => s.activePen)
  const activeColor = useNotesStore((s) => s.activeColor)
  const penSize = useNotesStore((s) => s.penSize)
  const colors = useNotesStore((s) => s.colors)
  const setActivePen = useNotesStore((s) => s.setActivePen)
  const setActiveColor = useNotesStore((s) => s.setActiveColor)
  const setPenSize = useNotesStore((s) => s.setPenSize)
  const zoomNoteBy = useNotesStore((s) => s.zoomNoteBy)
  const undoStylus = useNotesStore((s) => s.undoStylus)
  const redoStylus = useNotesStore((s) => s.redoStylus)
  const canUndoStylus = useNotesStore((s) => {
    if (!targetNoteId) return false
    return (s.stylusUndoStacks[targetNoteId]?.length ?? 0) > 0
  })
  const canRedoStylus = useNotesStore((s) => {
    if (!targetNoteId) return false
    return (s.stylusRedoStacks[targetNoteId]?.length ?? 0) > 0
  })
  const noteZoom = useNotesStore((s) => {
    const n = targetNoteId ? s.items[targetNoteId] : null
    if (!n || n.type !== 'note') return 1
    return n.zoom ?? 1
  })
  const bookmarkY = useNotesStore((s) => {
    const n = targetNoteId ? s.items[targetNoteId] : null
    if (!n || n.type !== 'note') return undefined
    return n.bookmarkY
  })
  const setNoteBookmark = useNotesStore((s) => s.setNoteBookmark)
  const clearNoteBookmark = useNotesStore((s) => s.clearNoteBookmark)

  const longPressTimer = useRef(null)
  const didLongPress = useRef(false)

  const handleBookmarkPointerDown = useCallback(() => {
    didLongPress.current = false
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true
      if (targetNoteId) clearNoteBookmark(targetNoteId)
    }, 500)
  }, [targetNoteId, clearNoteBookmark])

  const handleBookmarkPointerUp = useCallback(() => {
    clearTimeout(longPressTimer.current)
    if (didLongPress.current) return
    if (!targetNoteId) return

    if (bookmarkY != null) {
      const container = document.querySelector(
        `[data-note-scroll="${targetNoteId}"]`,
      )
      if (container) {
        container.scrollTo({ top: bookmarkY * noteZoom, behavior: 'smooth' })
      }
    } else {
      const physicalY = scrollPositionCache.get(targetNoteId) ?? 0
      const logicalY = physicalY / noteZoom
      setNoteBookmark(targetNoteId, logicalY)
    }
  }, [targetNoteId, bookmarkY, noteZoom, setNoteBookmark])

  const currentPen = PEN_TYPES[activePen]
  const isStylus = inputMode === 'stylus'
  const isKeyboard = inputMode === 'keyboard'
  const isSelect = inputMode === 'select'
  const showSplitButton = !noteIdProp && activeNoteId && !splitViewNoteId

  const groupClass =
    'flex shrink-0 items-center gap-0.5 border-r border-border pr-2 sm:pr-3'

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-1.5 pl-2 pr-2 sm:h-12 sm:flex-row sm:items-center sm:gap-3 sm:py-0 sm:pl-3 sm:pr-3">
      {/* Row 1 (mobile): mode, undo/redo, zoom — on sm+ merges into one row with row 2 */}
      <div
        className={`flex min-w-0 flex-wrap items-center gap-2 sm:contents ${
          isStylus
            ? 'border-b border-border pb-1.5 sm:border-0 sm:pb-0'
            : ''
        }`}
      >
        {showSplitButton && (
          <div className={groupClass}>
            <button
              type="button"
              onClick={() => setSplitPickerOpen(true)}
              title="View two notes — side by side in landscape, stacked in portrait"
              className="p-2 rounded-lg transition-colors text-text-secondary hover:bg-surface-lighter hover:text-text-primary"
            >
              <Columns2 size={18} />
            </button>
          </div>
        )}

        {targetNoteId && (
          <div className={groupClass}>
            <button
              type="button"
              onPointerDown={handleBookmarkPointerDown}
              onPointerUp={handleBookmarkPointerUp}
              onPointerLeave={() => clearTimeout(longPressTimer.current)}
              title={
                bookmarkY != null
                  ? 'Click to jump to bookmark · Long-press to clear'
                  : 'Bookmark current scroll position'
              }
              className={`p-2 rounded-lg transition-colors ${
                bookmarkY != null
                  ? 'text-accent'
                  : 'text-text-secondary hover:bg-surface-lighter hover:text-text-primary'
              }`}
            >
              <Bookmark
                size={18}
                fill={bookmarkY != null ? 'currentColor' : 'none'}
              />
            </button>
          </div>
        )}

        {targetNoteId && (
          <div className={groupClass}>
            <button
              type="button"
              onClick={() => setMode('stylus')}
              title="Stylus — draw with pen"
              className={`p-2 rounded-lg transition-colors ${
                isStylus
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:bg-surface-lighter hover:text-text-primary'
              }`}
            >
              <PenLine size={18} />
            </button>
            <button
              type="button"
              onClick={() => setMode('keyboard')}
              title="Keyboard — type text"
              className={`p-2 rounded-lg transition-colors ${
                isKeyboard
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:bg-surface-lighter hover:text-text-primary'
              }`}
            >
              <Type size={18} />
            </button>
            <button
              type="button"
              onClick={() => setMode('select')}
              title="Select — read and select text"
              className={`p-2 rounded-lg transition-colors ${
                isSelect
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:bg-surface-lighter hover:text-text-primary'
              }`}
            >
              <MousePointer2 size={18} />
            </button>
          </div>
        )}

        {targetNoteId && isStylus && (
          <div className={groupClass}>
            <button
              type="button"
              onClick={() => undoStylus(targetNoteId)}
              disabled={!canUndoStylus}
              title="Undo stroke"
              className="p-2 rounded-lg transition-colors text-text-secondary hover:bg-surface-lighter hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
            >
              <Undo2 size={18} />
            </button>
            <button
              type="button"
              onClick={() => redoStylus(targetNoteId)}
              disabled={!canRedoStylus}
              title="Redo stroke"
              className="p-2 rounded-lg transition-colors text-text-secondary hover:bg-surface-lighter hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
            >
              <Redo2 size={18} />
            </button>
          </div>
        )}

        {targetNoteId && (
          <div className={groupClass}>
            <button
              type="button"
              onClick={() =>
                zoomNoteBy(targetNoteId, 1 / NOTE_ZOOM_BUTTON_STEP)
              }
              disabled={noteZoom <= NOTE_ZOOM_MIN + 1e-6}
              title="Zoom out"
              className="p-2 rounded-lg transition-colors text-text-secondary hover:bg-surface-lighter hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
            >
              <ZoomOut size={18} />
            </button>
            <button
              type="button"
              onClick={() =>
                zoomNoteBy(targetNoteId, NOTE_ZOOM_BUTTON_STEP)
              }
              disabled={noteZoom >= NOTE_ZOOM_MAX - 1e-6}
              title="Zoom in"
              className="p-2 rounded-lg transition-colors text-text-secondary hover:bg-surface-lighter hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
            >
              <ZoomIn size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Row 2 (mobile): drawing tools — shown only in stylus mode */}
      {isStylus && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:contents">
          <div className="flex shrink-0 items-center gap-1 border-r border-border pr-2 sm:pr-3">
            {Object.values(PEN_TYPES).map((pen) => {
              const Icon = PEN_ICONS[pen.id]
              return (
                <button
                  key={pen.id}
                  type="button"
                  onClick={() => {
                    setActivePen(pen.id)
                    if (!pen.isEraser && !pen.isLasso && pen.size)
                      setPenSize(pen.size)
                  }}
                  title={pen.name}
                  className={`p-2 rounded-lg transition-colors ${
                    activePen === pen.id
                      ? 'bg-accent/20 text-accent'
                      : 'text-text-secondary hover:bg-surface-lighter hover:text-text-primary'
                  }`}
                >
                  <Icon size={18} />
                </button>
              )
            })}
          </div>

          {!currentPen?.isEraser && !currentPen?.isLasso && (
            <div className="flex shrink-0 items-center gap-1.5 border-r border-border pr-2 sm:pr-3">
              <button
                onClick={() => setPenSize(Math.max(1, penSize - 1))}
                className="p-1 rounded text-text-muted hover:text-text-primary"
              >
                <Minus size={14} />
              </button>
              <div
                className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface-lighter"
                title={`Size: ${penSize}`}
              >
                <div
                  className="rounded-full bg-current"
                  style={{
                    width: Math.min(penSize * 2, 20),
                    height: Math.min(penSize * 2, 20),
                    color: activeColor,
                  }}
                />
              </div>
              <button
                onClick={() => setPenSize(Math.min(50, penSize + 1))}
                className="p-1 rounded text-text-muted hover:text-text-primary"
              >
                <Plus size={14} />
              </button>
            </div>
          )}

          {!currentPen?.isEraser && !currentPen?.isLasso && (
            <div className="flex shrink-0 items-center gap-1.5 pr-1">
              {colors.map((color) => (
                <button
                  key={color}
                  onClick={() => setActiveColor(color)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                    activeColor === color
                      ? 'border-accent scale-110'
                      : 'border-transparent'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {splitPickerOpen && (
        <PickSecondNoteDialog onClose={() => setSplitPickerOpen(false)} />
      )}
    </div>
  )
}
