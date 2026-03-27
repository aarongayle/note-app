import { useMutation, useQuery } from 'convex/react'
import { useEffect, useRef } from 'react'
import { api } from '../../convex/_generated/api.js'
import { KEYBOARD_FONT_SIZE_PX } from '../lib/canvasConstants.js'
import {
  MIN_NOTE_SCROLL_HEIGHT,
  persistedScrollHeightForNote,
} from '../lib/noteScrollBounds.js'
import { seedViewStateFromServer } from '../lib/noteViewState.js'
import { textBoxHasVisibleContent } from '../lib/textBoxContent.js'
import useNotesStore, {
  clearNotesPersistence,
  configureNotesPersistence,
  TEMPLATES,
} from '../stores/useNotesStore'

const SAVE_DEBOUNCE_MS = 450

function buildUpdateNotePayload(note) {
  return {
    clientId: note.id,
    strokes: note.strokes,
    textBlocks: note.textBlocks.map((b) => ({
      id: b.id,
      content: b.content,
    })),
    textBoxes: (note.textBoxes ?? [])
      .filter((b) => textBoxHasVisibleContent(b.content))
      .map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        width: b.width,
        content: b.content.trim(),
        ...(b.rotation != null && { rotation: b.rotation }),
        ...(b.size && b.size !== 'medium' && { size: b.size }),
      })),
    imageEmbeds: note.imageEmbeds ?? [],
    pdfBackgroundFileId: note.pdfBackgroundFileId ?? null,
    epubBackgroundFileId: note.epubBackgroundFileId ?? null,
    epubContentWidth: note.epubContentWidth ?? null,
    bookmarkY: note.bookmarkY ?? null,
    scrollHeight: persistedScrollHeightForNote(note),
    updatedAt: note.updatedAt,
    template:
      note.template && TEMPLATES[note.template] ? note.template : 'blank',
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
      // Seed per-device view state from server (migration: only writes keys
      // not already present in localStorage, so local always wins).
      seedViewStateFromServer(row.clientId, {
        zoom: row.zoom,
        inputMode: row.inputMode,
        lastScrollY: row.lastScrollY,
      })

      items[row.clientId] = {
        id: row.clientId,
        type: 'note',
        name: row.name,
        parentId: row.parentClientId,
        template: row.template ?? 'blank',
        strokes: row.strokes ?? [],
        textBlocks: row.textBlocks ?? [],
        textBoxes: (row.textBoxes ?? []).filter((b) =>
          textBoxHasVisibleContent(b.content)
        ),
        imageEmbeds: row.imageEmbeds ?? [],
        pdfBackgroundFileId: row.pdfBackgroundFileId,
        epubBackgroundFileId: row.epubBackgroundFileId,
        epubContentWidth: row.epubContentWidth,
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
        bookmarkY: row.bookmarkY,
        scrollHeight: row.scrollHeight ?? MIN_NOTE_SCROLL_HEIGHT,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? row.createdAt,
      }
    }
  }

  const siblingSort = (a, b) => {
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
  const moveItemMutation = useMutation(api.notes.moveItem)
  const updateNoteMutation = useMutation(api.notes.updateNote)

  const createFolderMutationRef = useRef(createFolderMutation)
  const createNoteMutationRef = useRef(createNoteMutation)
  const deleteItemMutationRef = useRef(deleteItemMutation)
  const renameItemMutationRef = useRef(renameItemMutation)
  const moveItemMutationRef = useRef(moveItemMutation)
  const updateNoteMutationRef = useRef(updateNoteMutation)

  useEffect(() => {
    createFolderMutationRef.current = createFolderMutation
    createNoteMutationRef.current = createNoteMutation
    deleteItemMutationRef.current = deleteItemMutation
    renameItemMutationRef.current = renameItemMutation
    moveItemMutationRef.current = moveItemMutation
    updateNoteMutationRef.current = updateNoteMutation
  }, [
    createFolderMutation,
    createNoteMutation,
    deleteItemMutation,
    renameItemMutation,
    moveItemMutation,
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
      onMoveItem: (args) => {
        void moveItemMutationRef.current(args)
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
