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

/**
 * @type {null | { onCreateFolder: (a: object) => void, onCreateNote: (a: object) => void, onDeleteItem: (a: { clientId: string }) => void, onRenameItem: (a: { clientId: string, name: string }) => void, scheduleNoteSave: (clientId: string) => void }}
 * onCreateNote payload may include imageEmbeds, pdfBackgroundFileId.
 */
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

/** Snapshot of imageEmbeds at transform pointer-down */
let imageEmbedEditSnapshots = {}

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
  /** @type {Record<string, 'stylus' | 'keyboard' | 'select'>} Per-note input mode; toolbar changes apply to all open editor panes (see setEditorInputMode). */
  noteInputModes: {},
  activeNoteId: null,
  /** Second note id when comparing two notes side by side; null = single canvas */
  splitViewNoteId: null,
  /** Which note receives toolbar actions in split view; null = active (first) pane */
  splitToolbarNoteId: null,
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
  /**
   * In-memory (not persisted): logical scroll height (px) needed to display
   * all rendered PDF/EPUB pages, set by PdfNoteBackground after each render.
   * Used to determine how much excess canvas can be trimmed after extension.
   * @type {Record<string, number>}
   */
  pdfBaseScrollHeights: {},

  hydrateFromServer: ({ items: serverItems, rootIds: serverRootIds }) =>
    set((state) => {
      const mergedItems = { ...serverItems }

      // Optimistic creates (and any id not yet in listForUser) must survive hydrates.
      for (const [id, localItem] of Object.entries(state.items)) {
        if (!(id in serverItems)) {
          mergedItems[id] = localItem
        }
      }

      // Stale subscription snapshots can arrive before debounced save lands; never clobber
      // newer local note bodies with older server data.
      for (const [id, localItem] of Object.entries(state.items)) {
        const srv = serverItems[id]
        if (
          localItem?.type === 'note' &&
          srv?.type === 'note' &&
          (localItem.updatedAt ?? 0) > (srv.updatedAt ?? 0)
        ) {
          mergedItems[id] = localItem
        }
      }

      for (const [id, item] of Object.entries(mergedItems)) {
        if (id in serverItems || !item?.parentId) continue
        const parent = mergedItems[item.parentId]
        if (parent?.type === 'folder' && !parent.childIds.includes(id)) {
          mergedItems[item.parentId] = {
            ...parent,
            childIds: [...parent.childIds, id],
          }
        }
      }

      const mergedRootIds = [...serverRootIds]
      for (const id of state.rootIds) {
        if (
          !mergedRootIds.includes(id) &&
          mergedItems[id]?.parentId == null
        ) {
          mergedRootIds.push(id)
        }
      }

      /** Keep local undo/redo; Convex does not store them. Server echo would otherwise clear stacks after each save. */
      const pruneStacks = (stacks) => {
        const next = {}
        for (const [id, stack] of Object.entries(stacks)) {
          if (mergedItems[id]?.type === 'note') next[id] = stack
        }
        return next
      }

      const nextActive =
        state.activeNoteId && mergedItems[state.activeNoteId]
          ? state.activeNoteId
          : null
      let nextSplit = state.splitViewNoteId
      let nextSplitToolbar = state.splitToolbarNoteId
      if (
        !nextActive ||
        !nextSplit ||
        nextSplit === nextActive ||
        mergedItems[nextSplit]?.type !== 'note'
      ) {
        nextSplit = null
        nextSplitToolbar = null
      } else if (
        nextSplitToolbar &&
        mergedItems[nextSplitToolbar]?.type !== 'note'
      ) {
        nextSplitToolbar = null
      }

      return {
        items: mergedItems,
        rootIds: mergedRootIds,
        isTreeReady: true,
        activeNoteId: nextActive,
        splitViewNoteId: nextSplit,
        splitToolbarNoteId: nextSplitToolbar,
        stylusUndoStacks: pruneStacks(state.stylusUndoStacks),
        stylusRedoStacks: pruneStacks(state.stylusRedoStacks),
      }
    }),

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

  /**
   * @param {object} [media]
   * @param {Array<{ id: string, fileId: string, x: number, y: number, width: number, height: number, rotation: number }>} [media.imageEmbeds]
   * @param {string} [media.pdfBackgroundFileId]
   * @param {number} [media.importDocFontSizePt]
   * @param {{ top: number, right: number, bottom: number, left: number }} [media.importEpubMargins]
   */
  createNote: (name, template = 'blank', parentId = null, media = null) => {
    const id = uuidv4()
    const createdAt = Date.now()
    const before = useNotesStore.getState()
    const sortIndex =
      parentId && before.items[parentId]
        ? before.items[parentId].childIds.length
        : before.rootIds.length

    const imageEmbeds = media?.imageEmbeds?.length
      ? [...media.imageEmbeds]
      : []
    const pdfBackgroundFileId = media?.pdfBackgroundFileId
    const importDocFontSizePt = media?.importDocFontSizePt
    const importEpubMargins = media?.importEpubMargins
    const noteTemplate =
      pdfBackgroundFileId ? 'blank' : template

    const note = {
      id,
      type: 'note',
      name,
      parentId,
      template: noteTemplate,
      strokes: [],
      textBlocks: [],
      textBoxes: [],
      imageEmbeds,
      pdfBackgroundFileId,
      importDocFontSizePt,
      importEpubMargins,
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
      template: noteTemplate,
      imageEmbeds: imageEmbeds.length > 0 ? imageEmbeds : undefined,
      pdfBackgroundFileId,
      importDocFontSizePt,
      importEpubMargins,
    })

    return id
  },

  setActiveNote: (id) =>
    set({
      activeNoteId: id,
      splitViewNoteId: null,
      splitToolbarNoteId: null,
    }),

  enterSplitViewWithNote: (secondNoteId) => {
    set((state) => {
      const first = state.activeNoteId
      if (!first || !secondNoteId || first === secondNoteId) return state
      const a = state.items[first]
      const b = state.items[secondNoteId]
      if (a?.type !== 'note' || b?.type !== 'note') return state
      return {
        splitViewNoteId: secondNoteId,
        splitToolbarNoteId: null,
      }
    })
  },

  setSplitToolbarNoteId: (id) => set({ splitToolbarNoteId: id }),

  /** @param {'first' | 'second'} which — first = active note pane, second = split pane */
  exitSplitViewFromPane: (which) => {
    set((state) => {
      if (!state.splitViewNoteId) return state
      if (which === 'first') {
        return {
          activeNoteId: state.splitViewNoteId,
          splitViewNoteId: null,
          splitToolbarNoteId: null,
        }
      }
      return {
        splitViewNoteId: null,
        splitToolbarNoteId: null,
      }
    })
  },

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
        delete imageEmbedEditSnapshots[rid]
      }

      let rootIds = state.rootIds.filter((rid) => rid !== id)

      if (item.parentId && items[item.parentId]) {
        const parent = { ...items[item.parentId] }
        parent.childIds = parent.childIds.filter((cid) => cid !== id)
        items[item.parentId] = parent
      }

      const activeNoteId =
        state.activeNoteId === id ? null : state.activeNoteId

      let splitViewNoteId = state.splitViewNoteId
      let splitToolbarNoteId = state.splitToolbarNoteId
      if (splitViewNoteId && removedIds.includes(splitViewNoteId)) {
        splitViewNoteId = null
        splitToolbarNoteId = null
      }
      if (splitToolbarNoteId && removedIds.includes(splitToolbarNoteId)) {
        splitToolbarNoteId = null
      }

      return {
        items,
        rootIds,
        activeNoteId,
        splitViewNoteId,
        splitToolbarNoteId,
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

  beginImageEmbedEditGesture: (noteId) => {
    const note = get().items[noteId]
    if (note?.type === 'note') {
      imageEmbedEditSnapshots[noteId] = structuredClone(note.imageEmbeds ?? [])
    }
  },

  cancelImageEmbedEditGesture: (noteId) => {
    const snapshot = imageEmbedEditSnapshots[noteId]
    delete imageEmbedEditSnapshots[noteId]
    if (!snapshot) return
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      return {
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            imageEmbeds: snapshot,
            updatedAt: Date.now(),
          },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  commitImageEmbedEditGesture: (noteId) => {
    delete imageEmbedEditSnapshots[noteId]
    persistence?.scheduleNoteSave?.(noteId)
  },

  /** @param {Array<{ id: string, fileId: string, x: number, y: number, width: number, height: number, rotation: number }>} embeds */
  setNoteImageEmbedsLive: (noteId, embeds) => {
    if (!imageEmbedEditSnapshots[noteId]) return
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      return {
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            imageEmbeds: embeds.map((e) => ({ ...e })),
            updatedAt: Date.now(),
          },
        },
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

  /** @param {{ id: string, x: number, y: number, width: number, content: string }} textBox */
  createTextBox: (noteId, textBox) => {
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      return {
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            textBoxes: [...(note.textBoxes ?? []), textBox],
            updatedAt: Date.now(),
          },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  /** @param {Partial<{ x: number, y: number, width: number, content: string }>} patch */
  updateTextBox: (noteId, boxId, patch) => {
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      return {
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            textBoxes: (note.textBoxes ?? []).map((b) =>
              b.id === boxId ? { ...b, ...patch } : b
            ),
            updatedAt: Date.now(),
          },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  deleteTextBox: (noteId, boxId) => {
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      return {
        items: {
          ...state.items,
          [noteId]: {
            ...note,
            textBoxes: (note.textBoxes ?? []).filter((b) => b.id !== boxId),
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

  /**
   * Record the logical scroll height (px) that covers all rendered PDF/EPUB
   * pages for a note.  In-memory only — not persisted to Convex.
   */
  setPdfBaseScrollHeight: (noteId, height) => {
    set((state) => ({
      pdfBaseScrollHeights: { ...state.pdfBaseScrollHeights, [noteId]: height },
    }))
  },

  /**
   * Reduce a note's scroll height to `targetHeight` (clamped to
   * MIN_NOTE_SCROLL_HEIGHT).  Only shrinks — never grows.
   */
  trimScrollHeight: (noteId, targetHeight) => {
    set((state) => {
      const note = state.items[noteId]
      if (!note || note.type !== 'note') return state
      const clamped = Math.max(MIN_NOTE_SCROLL_HEIGHT, Math.ceil(targetHeight))
      if (note.scrollHeight <= clamped) return state
      return {
        items: {
          ...state.items,
          [noteId]: { ...note, scrollHeight: clamped, updatedAt: Date.now() },
        },
      }
    })
    persistence?.scheduleNoteSave?.(noteId)
  },

  setNoteInputMode: (noteId, mode) =>
    set((state) => ({
      noteInputModes: { ...state.noteInputModes, [noteId]: mode },
    })),

  /** Stylus/keyboard toggle from toolbar: keep split panes in sync (same mode on both notes). */
  setEditorInputMode: (mode) =>
    set((state) => {
      const ids = [
        state.activeNoteId,
        state.splitViewNoteId,
      ].filter((id) => id && state.items[id]?.type === 'note')
      if (ids.length === 0) return state
      const noteInputModes = { ...state.noteInputModes }
      for (const id of ids) {
        noteInputModes[id] = mode
      }
      return { noteInputModes }
    }),

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

  setActivePen: (penId) =>
    set({ activePen: PEN_TYPES[penId] ? penId : 'pen' }),
  setActiveColor: (color) => set({ activeColor: color }),
  setPenSize: (size) => set({ penSize: size }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}))

if (!PEN_TYPES[useNotesStore.getState().activePen]) {
  useNotesStore.setState({ activePen: 'pen' })
}

export default useNotesStore
