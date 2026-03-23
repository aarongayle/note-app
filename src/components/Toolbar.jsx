import {
  Pen,
  PenLine,
  Pencil,
  Highlighter,
  Eraser,
  LassoSelect,
  Type,
  Minus,
  Plus,
  ZoomIn,
  ZoomOut,
  Undo2,
  Redo2,
} from 'lucide-react'
import { NOTE_ZOOM_BUTTON_STEP } from '../lib/canvasConstants.js'
import useNotesStore, {
  PEN_TYPES,
  NOTE_ZOOM_MIN,
  NOTE_ZOOM_MAX,
} from '../stores/useNotesStore'

const PEN_ICONS = {
  pen: Pen,
  pencil: Pencil,
  marker: Highlighter,
  eraser: Eraser,
  lasso: LassoSelect,
}

export default function Toolbar() {
  const activeNoteId = useNotesStore((s) => s.activeNoteId)
  const inputMode = useNotesStore((s) => {
    const id = s.activeNoteId
    if (!id) return 'stylus'
    return s.noteInputModes[id] ?? 'stylus'
  })
  const setNoteInputMode = useNotesStore((s) => s.setNoteInputMode)

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
    const id = s.activeNoteId
    if (!id) return false
    return (s.stylusUndoStacks[id]?.length ?? 0) > 0
  })
  const canRedoStylus = useNotesStore((s) => {
    const id = s.activeNoteId
    if (!id) return false
    return (s.stylusRedoStacks[id]?.length ?? 0) > 0
  })
  const noteZoom = useNotesStore((s) => {
    const id = s.activeNoteId
    const n = id ? s.items[id] : null
    if (!n || n.type !== 'note') return 1
    return n.zoom ?? 1
  })

  const currentPen = PEN_TYPES[activePen]
  const isKeyboard = inputMode === 'keyboard'

  return (
    <div className="h-12 flex items-center px-3 gap-3 flex-1">
      {/* Stylus vs keyboard */}
      {activeNoteId && (
        <div className="flex items-center gap-0.5 border-r border-border pr-3">
          <button
            type="button"
            onClick={() => setNoteInputMode(activeNoteId, 'stylus')}
            title="Stylus — draw with pen"
            className={`p-2 rounded-lg transition-colors ${
              !isKeyboard
                ? 'bg-accent/20 text-accent'
                : 'text-text-secondary hover:bg-surface-lighter hover:text-text-primary'
            }`}
          >
            <PenLine size={18} />
          </button>
          <button
            type="button"
            onClick={() => setNoteInputMode(activeNoteId, 'keyboard')}
            title="Keyboard — type text"
            className={`p-2 rounded-lg transition-colors ${
              isKeyboard
                ? 'bg-accent/20 text-accent'
                : 'text-text-secondary hover:bg-surface-lighter hover:text-text-primary'
            }`}
          >
            <Type size={18} />
          </button>
        </div>
      )}

      {activeNoteId && !isKeyboard && (
        <div className="flex items-center gap-0.5 border-r border-border pr-3">
          <button
            type="button"
            onClick={() => undoStylus(activeNoteId)}
            disabled={!canUndoStylus}
            title="Undo stroke"
            className="p-2 rounded-lg transition-colors text-text-secondary hover:bg-surface-lighter hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
          >
            <Undo2 size={18} />
          </button>
          <button
            type="button"
            onClick={() => redoStylus(activeNoteId)}
            disabled={!canRedoStylus}
            title="Redo stroke"
            className="p-2 rounded-lg transition-colors text-text-secondary hover:bg-surface-lighter hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
          >
            <Redo2 size={18} />
          </button>
        </div>
      )}

      {activeNoteId && (
        <div className="flex items-center gap-0.5 border-r border-border pr-3">
          <button
            type="button"
            onClick={() =>
              zoomNoteBy(activeNoteId, 1 / NOTE_ZOOM_BUTTON_STEP)
            }
            disabled={noteZoom <= NOTE_ZOOM_MIN + 1e-6}
            title="Zoom out"
            className="p-2 rounded-lg transition-colors text-text-secondary hover:bg-surface-lighter hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
          >
            <ZoomOut size={18} />
          </button>
          <button
            type="button"
            onClick={() => zoomNoteBy(activeNoteId, NOTE_ZOOM_BUTTON_STEP)}
            disabled={noteZoom >= NOTE_ZOOM_MAX - 1e-6}
            title="Zoom in"
            className="p-2 rounded-lg transition-colors text-text-secondary hover:bg-surface-lighter hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
          >
            <ZoomIn size={18} />
          </button>
        </div>
      )}

      {/* Pen tools */}
      {!isKeyboard && (
        <div className="flex items-center gap-1 border-r border-border pr-3">
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
      )}

      {/* Size control */}
      {!isKeyboard && !currentPen?.isEraser && !currentPen?.isLasso && (
        <div className="flex items-center gap-1.5 border-r border-border pr-3">
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

      {/* Color palette */}
      {!isKeyboard && !currentPen?.isEraser && !currentPen?.isLasso && (
        <div className="flex items-center gap-1.5">
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
  )
}
