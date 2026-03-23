import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { KEYBOARD_DOC_BLOCK_ID } from '../lib/canvasConstants.js'
import { MIN_NOTE_SCROLL_HEIGHT } from '../lib/noteScrollBounds.js'

export const TEMPLATES = {
  blank: { id: 'blank', name: 'Blank', icon: 'Square' },
  lined: { id: 'lined', name: 'Lined', icon: 'AlignJustify' },
  grid: { id: 'grid', name: 'Grid', icon: 'Grid3X3' },
  dotted: { id: 'dotted', name: 'Dotted', icon: 'Grip' },
}

export const PEN_TYPES = {
  pen: {
    id: 'pen',
    name: 'Pen',
    icon: 'Pen',
    size: 3,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    color: '#000000',
  },
  pencil: {
    id: 'pencil',
    name: 'Pencil',
    icon: 'Pencil',
    size: 2,
    thinning: 0.6,
    smoothing: 0.3,
    streamline: 0.3,
    color: '#333333',
  },
  marker: {
    id: 'marker',
    name: 'Marker',
    icon: 'Highlighter',
    size: 16,
    thinning: 0,
    smoothing: 0.6,
    streamline: 0.6,
    color: '#fde047',
    opacity: 0.4,
  },
  eraser: {
    id: 'eraser',
    name: 'Eraser',
    icon: 'Eraser',
    size: 20,
    isEraser: true,
  },
  lasso: {
    id: 'lasso',
    name: 'Lasso select',
    icon: 'Lasso',
    isLasso: true,
  },
}

const COLORS = [
  '#000000', '#374151', '#dc2626', '#ea580c',
  '#2563eb', '#059669', '#7c3aed', '#db2777',
]

/** @type {null | { onCreateFolder: (a: object) => void, onCreateNote: (a: object) => void, onDeleteItem: (a: { clientId: string }) => void, onRenameItem: (a: { clientId: string, name: string }) => void, scheduleNoteSave: (clientId: string) => void }} */
let persistence = null

export function configureNotesPersistence(api) {
  persistence = api
}

export function clearNotesPersistence() {
  persistence = null
}

export const NOTE_ZOOM_MIN = 0.5
export const NOTE_ZOOM_MAX = 3

/** Snapshot of strokes at eraser pointer-down, keyed by note id */
let eraserGestureSnapshots = {}

/** Full stroke list snapshot at transform / bulk edit pointer-down */
let strokesEditSnapshots = {}

/** @param {unknown} s */
function cloneStroke(s) {
  if (!s || typeof s !== 'object') return s
  const o = /** @type {{ points?: unknown[]; options?: object }} */ (s)
  return {
    ...o,
    points: (o.points ?? []).map((p) =>
      Array.isArray(p) ? [...p] : p
    ),
    options: o.options ? { ...o.options } : o.options,
  }
}

/** @param {unknown[]} strokes */
function cloneStrokes(strokes) {
  return strokes.map((st) => cloneStroke(st))
}

function strokesArraysEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

const useNotesStore = create((set, get) => ({
  items: {},
  rootIds: [],
  /** @type {Record<string, 'stylus' | 'keyboard'>} Per-note input mode (not synced). */
  noteInputModes: {},
  activeNoteId: null,
  activePen: 'pen',
  activeColor: COLORS[0],
  penSize: 3,
  colors: COLORS,
  sidebarOpen: true,
  /** False until first Convex `listForUser` result is applied */
  isTreeReady: false,
  /** @type {Record<string, { prev: unknown[]; next: unknown[] }[]>} Local-only stroke history */
  stylusUndoStacks: {},
  /** @type {Record<string, { prev: unknown[]; next: unknown[] }[]>} */
  stylusRedoStacks: {},

  hydrateFromServer: ({ items, rootIds }) =>
    set((state) => ({
      items,
      rootIds,
      isTreeReady: true,
      activeNoteId:
        state.activeNoteId && items[state.activeNoteId]
          ? state.activeNoteId
          : null,
      stylusUndoStacks: {},
      stylusRedoStacks: {},
    })),

  createFolder: (name, parentId = null) => {
    const id = uuidv4()
    const createdAt = Date.now()
    const before = useNotesStore.getState()
    const sortIndex =
      parentId && before.items[parentId]
        ? before.items[parentId].childIds.length
        : before.rootIds.length

    const folder = {
      id,
      type: 'folder',
      name,
      parentId,
      childIds: [],
      createdAt,
    }

    set((state) => {
      const items = { ...state.items, [id]: folder }
      let rootIds = state.rootIds

      if (parentId && state.items[parentId]) {
        const parent = { ...state.items[parentId] }
        parent.childIds = [...parent.childIds, id]
        items[parentId] = parent
      } else {
        rootIds = [...rootIds, id]
      }

      return { items, rootIds }
    })

    persistence?.onCreateFolder?.({
      clientId: id,
      name,
      parentClientId: parentId,
      sortIndex,
      createdAt,
    })

    return id
  },

  createNote: (name, template = 'blank', parentId = null) => {
    const id = uuidv4()
    const createdAt = Date.now()
    const before = useNotesStore.getState()
    const sortIndex =
      parentId && before.items[parentId]
        ? before.items[parentId].childIds.length
        : before.rootIds.length

    const note = {
      id,
      type: 'note',
      name,
      parentId,
      template,
      strokes: [],
      textBlocks: [],
      scrollHeight: MIN_NOTE_SCROLL_HEIGHT,
      zoom: 1,
      createdAt,
      updatedAt: createdAt,
    }

    set((state) => {
      const items = { ...state.items, [id]: note }
      let rootIds = state.rootIds

      if (parentId && state.items[parentId]) {
        const parent = { ...state.items[parentId] }
        parent.childIds = [...parent.childIds, id]
        items[parentId] = parent
      } else {
        rootIds = [...rootIds, id]
      }

      return { items, rootIds, activeNoteId: id }
    })

    persistence?.onCreateNote?.({
      clientId: id,
      name,
      parentClientId: parentId,
      sortIndex,
      createdAt,
      template,
    })

    return id
  },

  setActiveNote: (id) => set({ activeNoteId: id }),

  deleteItem: (id) => {
    set((state) => {
      const item = state.items[id]
      if (!item) return state

      const items = { ...state.items }
      const removedIds = []
      const collectIds = (itemId) => {
        const it = items[itemId]
        if (!it) return
        removedIds.push(itemId)
        if (it.type === 'folder') {
          it.childIds.forEach(collectIds)
        }
        delete items[itemId]
      }
      collectIds(id)

      const noteInputModes = { ...state.noteInputModes }
      const stylusUndoStacks = { ...state.stylusUndoStacks }
      const stylusRedoStacks = { ...state.stylusRedoStacks }
      for (const rid of removedIds) {
        delete noteInputModes[rid]
        delete stylusUndoStacks[rid]
        delete stylusRedoStacks[rid]
        delete eraserGestureSnapshots[rid]
      }

      let rootIds = state.rootIds.filter((rid) => rid !== id)

      if (item.parentId && items[item.parentId]) {
        const parent = { ...items[item.parentId] }
        parent.childIds = parent.childIds.filter((cid) => cid !== id)
        items[item.parentId] = parent
      }

      const activeNoteId =
        state.activeNoteId === id ? null : state.activeNoteId

      return {
        items,
        rootIds,
        activeNoteId,
        noteInputModes,
        stylusUndoStacks,
        stylusRedoStacks,
      }
    })

    persistence?.onDeleteItem?.({ clientId: id })
  },

  renameItem: (id, name) => {
    set((state) => {
      const item = state.items[id]
      if (!item) return state
      return {
        items: { ...state.items, [id]: { ...item, name } },
      }
    })
    persistence?.onRenameItem?.({ clientId: id, name })
  },

  addStroke: (noteId, stroke) => {
    const strokeCopy = cloneStroke(stroke)
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      const prev = cloneStrokes(note.strokes)
      const next = [...prev, strokeCopy]
      const entry = { prev, next }
      const undo = [...(state.stylusUndoStacks[noteId] ?? []), entry]
      return {
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            strokes: next,
            updatedAt: Date.now(),
          },
        },
        stylusUndoStacks: { ...state.stylusUndoStacks, [noteId]: undo },
        stylusRedoStacks: { ...state.stylusRedoStacks, [noteId]: [] },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  beginStrokeEraserGesture: (noteId) => {
    const note = get().items[noteId]
    if (note?.type === 'note') {
      eraserGestureSnapshots[noteId] = cloneStrokes(note.strokes)
    }
  },

  cancelStrokeEraserGesture: (noteId) => {
    delete eraserGestureSnapshots[noteId]
  },

  commitStrokeEraserGesture: (noteId) => {
    const snapshot = eraserGestureSnapshots[noteId]
    delete eraserGestureSnapshots[noteId]
    if (!snapshot) return

    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      const next = cloneStrokes(note.strokes)
      if (strokesArraysEqual(snapshot, next)) return state
      const entry = { prev: snapshot, next }
      const undo = [...(state.stylusUndoStacks[noteId] ?? []), entry]
      return {
        stylusUndoStacks: { ...state.stylusUndoStacks, [noteId]: undo },
        stylusRedoStacks: { ...state.stylusRedoStacks, [noteId]: [] },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  undoStylus: (noteId) => {
    set((state) => {
      const stack = state.stylusUndoStacks[noteId] ?? []
      if (stack.length === 0) return state
      const entry = stack[stack.length - 1]
      const newUndo = stack.slice(0, -1)
      const redo = [...(state.stylusRedoStacks[noteId] ?? []), entry]
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      return {
        stylusUndoStacks: { ...state.stylusUndoStacks, [noteId]: newUndo },
        stylusRedoStacks: { ...state.stylusRedoStacks, [noteId]: redo },
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            strokes: cloneStrokes(entry.prev),
            updatedAt: Date.now(),
          },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  redoStylus: (noteId) => {
    set((state) => {
      const stack = state.stylusRedoStacks[noteId] ?? []
      if (stack.length === 0) return state
      const entry = stack[stack.length - 1]
      const newRedo = stack.slice(0, -1)
      const undo = [...(state.stylusUndoStacks[noteId] ?? []), entry]
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      return {
        stylusRedoStacks: { ...state.stylusRedoStacks, [noteId]: newRedo },
        stylusUndoStacks: { ...state.stylusUndoStacks, [noteId]: undo },
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            strokes: cloneStrokes(entry.next),
            updatedAt: Date.now(),
          },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  beginStrokesEditGesture: (noteId) => {
    const note = get().items[noteId]
    if (note?.type === 'note') {
      strokesEditSnapshots[noteId] = cloneStrokes(note.strokes)
    }
  },

  cancelStrokesEditGesture: (noteId) => {
    const snapshot = strokesEditSnapshots[noteId]
    delete strokesEditSnapshots[noteId]
    if (!snapshot) return
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      return {
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            strokes: cloneStrokes(snapshot),
            updatedAt: Date.now(),
          },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  commitStrokesEditGesture: (noteId) => {
    const snapshot = strokesEditSnapshots[noteId]
    delete strokesEditSnapshots[noteId]
    if (!snapshot) return

    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      const next = cloneStrokes(note.strokes)
      if (strokesArraysEqual(snapshot, next)) return state
      const entry = { prev: snapshot, next }
      const undo = [...(state.stylusUndoStacks[noteId] ?? []), entry]
      return {
        stylusUndoStacks: { ...state.stylusUndoStacks, [noteId]: undo },
        stylusRedoStacks: { ...state.stylusRedoStacks, [noteId]: [] },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  /** Replace all strokes while a gesture is in progress (undo handled by commit/cancel). */
  setNoteStrokesLive: (noteId, strokes) => {
    if (!strokesEditSnapshots[noteId]) return
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      return {
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            strokes: cloneStrokes(strokes),
            updatedAt: Date.now(),
          },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  eraseStrokesAt: (noteId, point, radius) => {
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state

      const strokes = note.strokes.filter((stroke) => {
        return !stroke.points.some((p) => {
          const dx = p[0] - point[0]
          const dy = p[1] - point[1]
          return Math.sqrt(dx * dx + dy * dy) < radius
        })
      })

      if (strokes.length === note.strokes.length) return state

      return {
        items: {
          ...state.items,
          [noteId]: { ...note, strokes, updatedAt: Date.now() },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  addTextBlock: (noteId, textBlock) => {
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      return {
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            textBlocks: [...note.textBlocks, textBlock],
            updatedAt: Date.now(),
          },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  updateTextBlock: (noteId, blockId, content) => {
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      return {
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            textBlocks: note.textBlocks.map((b) =>
              b.id === blockId ? { ...b, content } : b
            ),
            updatedAt: Date.now(),
          },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  extendScrollHeight: (noteId, amount = 1000) => {
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      const updatedAt = Date.now()
      return {
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            scrollHeight: note.scrollHeight + amount,
            updatedAt,
          },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  ensureNoteScrollHeight: (noteId, minHeight) => {
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      if (note.scrollHeight >= minHeight) return state
      const updatedAt = Date.now()
      return {
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            scrollHeight: minHeight,
            updatedAt,
          },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  setNoteInputMode: (noteId, mode) =>
    set((state) => ({
      noteInputModes: { ...state.noteInputModes, [noteId]: mode },
    })),

  /** @param {number} zoom Absolute zoom clamped to NOTE_ZOOM_MIN..NOTE_ZOOM_MAX */
  setNoteZoom: (noteId, zoom) => {
    const state = useNotesStore.getState()
    const note = state.items[noteId]
    if (!note || note.type !== 'note') return
    const z = Math.min(
      NOTE_ZOOM_MAX,
      Math.max(NOTE_ZOOM_MIN, Number.isFinite(zoom) ? zoom : 1)
    )
    if ((note.zoom ?? 1) === z) return
    const updatedAt = Date.now()
    set({
      items: {
        ...state.items,
        [noteId]: { ...note, zoom: z, updatedAt },
      },
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  /** Multiply current note zoom by `factor` (e.g. 1.12 / 0.89). */
  zoomNoteBy: (noteId, factor) => {
    const state = useNotesStore.getState()
    const note = state.items[noteId]
    if (!note || note.type !== 'note') return
    const cur = note.zoom ?? 1
    const f = Number.isFinite(factor) ? factor : 1
    const z = Math.min(NOTE_ZOOM_MAX, Math.max(NOTE_ZOOM_MIN, cur * f))
    if ((note.zoom ?? 1) === z) return
    const updatedAt = Date.now()
    set({
      items: {
        ...state.items,
        [noteId]: { ...note, zoom: z, updatedAt },
      },
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  setNoteKeyboardContent: (noteId, content) => {
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      return {
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            textBlocks: [{ id: KEYBOARD_DOC_BLOCK_ID, content }],
            updatedAt: Date.now(),
          },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  setActivePen: (penId) => set({ activePen: penId }),
  setActiveColor: (color) => set({ activeColor: color }),
  setPenSize: (size) => set({ penSize: size }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}))

export default useNotesStore
