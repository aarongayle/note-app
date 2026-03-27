import { useMutation, useQuery } from 'convex/react'
import { useEffect, useRef } from 'react'
import { api } from '../../convex/_generated/api.js'
import { KEYBOARD_FONT_SIZE_PX } from '../lib/canvasConstants.js'
import {
  MIN_NOTE_SCROLL_HEIGHT,
  persistedScrollHeightForNote,
} from '../lib/noteScrollBounds.js'
import useNotesStore, {
  clearNotesPersistence,
  configureNotesPersistence,
  NOTE_ZOOM_MAX,
  NOTE_ZOOM_MIN,
} from '../stores/useNotesStore'

const SAVE_DEBOUNCE_MS = 450

function clampZoomForServer(z) {
  const n = Number.isFinite(z) ? z : 1
  return Math.min(NOTE_ZOOM_MAX, Math.max(NOTE_ZOOM_MIN, n))
}

function buildUpdateNotePayload(note) {
  return {
    clientId: note.id,
    strokes: note.strokes,
    textBlocks: note.textBlocks.map((b) => ({
      id: b.id,
      content: b.content,
    })),
    textBoxes: (note.textBoxes ?? []).map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      width: b.width,
      content: b.content,
    })),
    imageEmbeds: note.imageEmbeds ?? [],
    pdfBackgroundFileId: note.pdfBackgroundFileId ?? null,
    scrollHeight: persistedScrollHeightForNote(note),
    zoom: clampZoomForServer(note.zoom ?? 1),
    updatedAt: note.updatedAt,
    importDocFontSizePt: note.importDocFontSizePt ?? KEYBOARD_FONT_SIZE_PX,
    importEpubMarginPt: note.importEpubMarginPt ?? null,
    importEpubMargins: note.importEpubMargins ?? null,
  }
}
const noteSaveTimers = new Map()

function rowsToStoreState(rows) {
  const items = {}
  for (const row of rows) {
    if (row.itemType === 'folder') {
      items[row.clientId] = {
        id: row.clientId,
        type: 'folder',
        name: row.name,
        parentId: row.parentClientId,
        childIds: [],
        createdAt: row.createdAt,
      }
    } else {
      items[row.clientId] = {
        id: row.clientId,
        type: 'note',
        name: row.name,
        parentId: row.parentClientId,
        template: row.template ?? 'blank',
        strokes: row.strokes ?? [],
        textBlocks: row.textBlocks ?? [],
        textBoxes: row.textBoxes ?? [],
        imageEmbeds: row.imageEmbeds ?? [],
        pdfBackgroundFileId: row.pdfBackgroundFileId,
        importDocFontSizePt: row.importDocFontSizePt,
        importEpubMargins:
          row.importEpubMargins ??
          (row.importEpubMarginPt != null
            ? {
                top: row.importEpubMarginPt,
                right: row.importEpubMarginPt,
                bottom: row.importEpubMarginPt,
                left: row.importEpubMarginPt,
              }
            : undefined),
        importEpubMarginPt: row.importEpubMargins
          ? undefined
          : row.importEpubMarginPt,
        scrollHeight: row.scrollHeight ?? MIN_NOTE_SCROLL_HEIGHT,
        zoom: row.zoom ?? 1,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? row.createdAt,
      }
    }
  }

  const siblingSort = (a, b) => {
    if (a.itemType === 'folder' && b.itemType !== 'folder') return -1
    if (a.itemType !== 'folder' && b.itemType === 'folder') return 1
    if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex
    return a.createdAt - b.createdAt
  }

  const rootIds = rows
    .filter((r) => r.parentClientId === null)
    .sort(siblingSort)
    .map((r) => r.clientId)

  for (const row of rows) {
    if (row.itemType !== 'folder') continue
    const kids = rows
      .filter((r) => r.parentClientId === row.clientId)
      .sort(siblingSort)
    items[row.clientId].childIds = kids.map((k) => k.clientId)
  }

  return { items, rootIds }
}

/**
 * Loads and persists the notes tree to Convex (per signed-in user).
 */
export default function NotesConvexSync() {
  const rows = useQuery(api.notes.listForUser)
  const createFolderMutation = useMutation(api.notes.createFolder)
  const createNoteMutation = useMutation(api.notes.createNote)
  const deleteItemMutation = useMutation(api.notes.deleteItem)
  const renameItemMutation = useMutation(api.notes.renameItem)
  const updateNoteMutation = useMutation(api.notes.updateNote)

  const createFolderMutationRef = useRef(createFolderMutation)
  const createNoteMutationRef = useRef(createNoteMutation)
  const deleteItemMutationRef = useRef(deleteItemMutation)
  const renameItemMutationRef = useRef(renameItemMutation)
  const updateNoteMutationRef = useRef(updateNoteMutation)

  useEffect(() => {
    createFolderMutationRef.current = createFolderMutation
    createNoteMutationRef.current = createNoteMutation
    deleteItemMutationRef.current = deleteItemMutation
    renameItemMutationRef.current = renameItemMutation
    updateNoteMutationRef.current = updateNoteMutation
  }, [
    createFolderMutation,
    createNoteMutation,
    deleteItemMutation,
    renameItemMutation,
    updateNoteMutation,
  ])

  useEffect(() => {
    const scheduleNoteSave = (clientId) => {
      const prev = noteSaveTimers.get(clientId)
      if (prev) clearTimeout(prev)
      const t = setTimeout(() => {
        noteSaveTimers.delete(clientId)
        const note = useNotesStore.getState().items[clientId]
        if (!note || note.type !== 'note') return
        void updateNoteMutationRef.current(buildUpdateNotePayload(note))
      }, SAVE_DEBOUNCE_MS)
      noteSaveTimers.set(clientId, t)
    }

    configureNotesPersistence({
      onCreateFolder: (args) => {
        void createFolderMutationRef.current(args)
      },
      onCreateNote: (args) => {
        void createNoteMutationRef.current(args)
      },
      onDeleteItem: ({ clientId }) => {
        void deleteItemMutationRef.current({ clientId })
      },
      onRenameItem: ({ clientId, name }) => {
        void renameItemMutationRef.current({ clientId, name })
      },
      scheduleNoteSave,
    })

    return () => {
      for (const [clientId, timer] of noteSaveTimers) {
        clearTimeout(timer)
        const note = useNotesStore.getState().items[clientId]
        if (note?.type === 'note') {
          void updateNoteMutationRef.current(buildUpdateNotePayload(note))
        }
      }
      noteSaveTimers.clear()
      clearNotesPersistence()
      useNotesStore.setState({
        items: {},
        rootIds: [],
        activeNoteId: null,
        isTreeReady: false,
      })
    }
  }, [])

  useEffect(() => {
    if (rows === undefined) return
    const { items, rootIds } = rowsToStoreState(rows)
    useNotesStore.getState().hydrateFromServer({ items, rootIds })
  }, [rows])

  return null
}
