import { useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  FolderPlus,
  Trash2,
  PanelLeftClose,
  LogOut,
  GripVertical,
  Settings,
} from 'lucide-react'
import { useAuthActions } from '@convex-dev/auth/react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core'
import useNotesStore from '../stores/useNotesStore'
import NewItemDialog from './NewItemDialog'
import NoteSettingsDialog from './NoteSettingsDialog'
import FileStoragePanel from './FileStoragePanel'

/** @param {string | null} parentId @param {number} index */
function gapDropId(parentId, index) {
  return `gap|${parentId ?? 'root'}|${index}`
}

/** @param {string} id */
function parseGapDropId(id) {
  if (typeof id !== 'string' || !id.startsWith('gap|')) return null
  const parts = id.split('|')
  if (parts.length < 3) return null
  const parentKey = parts[1]
  const index = parseInt(parts[2], 10)
  if (Number.isNaN(index)) return null
  return { parentId: parentKey === 'root' ? null : parentKey, index }
}

/** @param {string} folderId */
function intoDropId(folderId) {
  return `into|${folderId}`
}

function GapDropZone({ parentId, index }) {
  const id = gapDropId(parentId, index)
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`h-2 shrink-0 rounded transition-colors ${
        isOver ? 'bg-accent/35' : 'hover:bg-surface-lighter/50'
      }`}
      aria-hidden
    />
  )
}

function GripDragHandle({ id }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id })
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="shrink-0 p-0.5 rounded cursor-grab touch-none text-text-muted hover:text-text-primary active:cursor-grabbing"
      onClick={(e) => e.stopPropagation()}
      aria-label="Drag to move"
    >
      <GripVertical size={14} />
    </button>
  )
}

function TreeRow({ id, depth, activeDragId, onOpenNoteSettings }) {
  const item = useNotesStore((s) => s.items[id])
  const activeNoteId = useNotesStore((s) => s.activeNoteId)
  const splitViewNoteId = useNotesStore((s) => s.splitViewNoteId)
  const isTreeReady = useNotesStore((s) => s.isTreeReady)
  const setActiveNote = useNotesStore((s) => s.setActiveNote)
  const deleteItem = useNotesStore((s) => s.deleteItem)
  const [expanded, setExpanded] = useState(true)
  const [showNewItem, setShowNewItem] = useState(null)

  const isFolder = item?.type === 'folder'
  const isNote = item?.type === 'note'
  const { setNodeRef: setIntoRef, isOver: isOverInto } = useDroppable({
    id: intoDropId(id),
    disabled: !item || item.type !== 'folder',
  })

  if (!item) return null

  const isActive =
    item.id === activeNoteId ||
    (item.type === 'note' && item.id === splitViewNoteId)
  const isDragging = activeDragId === id

  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-2 py-1 rounded-md text-sm transition-colors ${
          isDragging ? 'opacity-40' : ''
        } ${
          isActive
            ? 'bg-accent/20 text-accent-hover'
            : 'text-text-secondary hover:bg-surface-lighter hover:text-text-primary'
        }`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        <GripDragHandle id={id} />

        {isFolder ? (
          <div
            ref={setIntoRef}
            className={`flex flex-1 min-w-0 items-center gap-1.5 cursor-pointer rounded px-0.5 py-0.5 -my-0.5 transition-colors ${
              isOverInto ? 'bg-accent/15 ring-1 ring-accent/35' : ''
            }`}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown size={14} className="shrink-0 text-text-muted" />
            ) : (
              <ChevronRight size={14} className="shrink-0 text-text-muted" />
            )}
            {expanded ? (
              <FolderOpen size={15} className="shrink-0 text-accent" />
            ) : (
              <Folder size={15} className="shrink-0 text-accent" />
            )}
            <span className="truncate flex-1">{item.name}</span>
          </div>
        ) : (
          <div
            className="flex flex-1 min-w-0 items-center gap-1.5 cursor-pointer"
            onClick={() => setActiveNote(item.id)}
          >
            <span className="w-3.5 shrink-0" />
            <FileText size={15} className="shrink-0 text-text-muted" />
            <span className="truncate flex-1">{item.name}</span>
          </div>
        )}

        <div
          className={`items-center gap-0.5 shrink-0 ${
            isNote && isActive
              ? 'flex'
              : 'hidden md:group-hover:flex'
          }`}
        >
          {isFolder && (
            <>
              <button
                type="button"
                disabled={!isTreeReady}
                onClick={(e) => {
                  e.stopPropagation()
                  setShowNewItem('note')
                }}
                className="p-0.5 rounded hover:bg-surface-light text-text-muted hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
              >
                <Plus size={13} />
              </button>
              <button
                type="button"
                disabled={!isTreeReady}
                onClick={(e) => {
                  e.stopPropagation()
                  setShowNewItem('folder')
                }}
                className="p-0.5 rounded hover:bg-surface-light text-text-muted hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none"
              >
                <FolderPlus size={13} />
              </button>
            </>
          )}
          {isNote && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenNoteSettings?.(item.id)
              }}
              className="p-0.5 rounded hover:bg-surface-light text-text-muted hover:text-text-primary"
              aria-label="Note settings"
            >
              <Settings size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              deleteItem(item.id)
            }}
            className="p-0.5 rounded hover:bg-danger/20 text-text-muted hover:text-danger"
            aria-label={isFolder ? 'Delete folder' : 'Delete note'}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {isFolder && expanded && (
        <TreeList
          parentId={id}
          depth={depth + 1}
          activeDragId={activeDragId}
          onOpenNoteSettings={onOpenNoteSettings}
        />
      )}

      {showNewItem && (
        <NewItemDialog
          type={showNewItem}
          parentId={item.id}
          onClose={() => setShowNewItem(null)}
        />
      )}

    </div>
  )
}

function TreeList({ parentId, depth, activeDragId, onOpenNoteSettings }) {
  const rootIds = useNotesStore((s) => s.rootIds)
  const items = useNotesStore((s) => s.items)
  const childIds =
    parentId === null ? rootIds : items[parentId]?.childIds ?? []

  return (
    <>
      <GapDropZone parentId={parentId} index={0} />
      {childIds.map((childId, i) => (
        <div key={childId}>
          <TreeRow
            id={childId}
            depth={depth}
            activeDragId={activeDragId}
            onOpenNoteSettings={onOpenNoteSettings}
          />
          <GapDropZone parentId={parentId} index={i + 1} />
        </div>
      ))}
    </>
  )
}

export default function Sidebar() {
  const rootIds = useNotesStore((s) => s.rootIds)
  const items = useNotesStore((s) => s.items)
  const isTreeReady = useNotesStore((s) => s.isTreeReady)
  const moveItem = useNotesStore((s) => s.moveItem)
  const toggleSidebar = useNotesStore((s) => s.toggleSidebar)
  const { signOut } = useAuthActions()
  const [showNewItem, setShowNewItem] = useState(null)
  const [activeDragId, setActiveDragId] = useState(null)
  const [settingsNoteId, setSettingsNoteId] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 6 },
    }),
  )

  function handleDragStart({ active }) {
    setActiveDragId(String(active.id))
  }

  function handleDragEnd({ active, over }) {
    setActiveDragId(null)
    if (!over || !isTreeReady) return
    const draggedId = String(active.id)
    const overId = String(over.id)
    if (draggedId === overId) return

    const intoPrefix = 'into|'
    if (overId.startsWith(intoPrefix)) {
      const folderId = overId.slice(intoPrefix.length)
      const folder = items[folderId]
      if (!folder || folder.type !== 'folder') return
      if (draggedId === folderId) return
      const siblings = folder.childIds.filter((c) => c !== draggedId)
      moveItem(draggedId, folderId, siblings.length)
      return
    }

    const gap = parseGapDropId(overId)
    if (!gap) return
    moveItem(draggedId, gap.parentId, gap.index)
  }

  function handleDragCancel() {
    setActiveDragId(null)
  }

  const activeItem = activeDragId ? items[activeDragId] : null

  return (
    <div className="w-64 h-full bg-surface flex flex-col border-r border-border">
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        <h1 className="text-sm font-semibold text-text-primary tracking-wide">
          Notes
        </h1>
        <button
          type="button"
          onClick={toggleSidebar}
          className="p-1 rounded hover:bg-surface-lighter text-text-muted hover:text-text-primary transition-colors"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
        <button
          type="button"
          disabled={!isTreeReady}
          onClick={() => setShowNewItem('note')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors flex-1 justify-center disabled:opacity-50 disabled:pointer-events-none"
        >
          <Plus size={13} />
          Note
        </button>
        <button
          type="button"
          disabled={!isTreeReady}
          onClick={() => setShowNewItem('folder')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-surface-lighter text-text-secondary hover:text-text-primary transition-colors flex-1 justify-center disabled:opacity-50 disabled:pointer-events-none"
        >
          <FolderPlus size={13} />
          Folder
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5 px-1.5 min-h-0">
        {!isTreeReady ? (
          <div className="text-center text-text-muted text-xs py-8 px-4">
            Loading notes…
          </div>
        ) : rootIds.length === 0 ? (
          <div className="text-center text-text-muted text-xs py-8 px-4">
            No notes yet. Create one to get started.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <TreeList
              parentId={null}
              depth={0}
              activeDragId={activeDragId}
              onOpenNoteSettings={(noteId) => setSettingsNoteId(noteId)}
            />
            <DragOverlay dropAnimation={null}>
              {activeItem ? (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface border border-border shadow-lg text-sm text-text-primary max-w-[220px]">
                  {activeItem.type === 'folder' ? (
                    <Folder size={15} className="shrink-0 text-accent" />
                  ) : (
                    <FileText size={15} className="shrink-0 text-text-muted" />
                  )}
                  <span className="truncate">{activeItem.name}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {import.meta.env.VITE_CONVEX_URL ? <FileStoragePanel /> : null}

      <div className="shrink-0 border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md text-xs text-text-muted hover:text-text-primary hover:bg-surface-lighter transition-colors"
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>

      {showNewItem && (
        <NewItemDialog
          type={showNewItem}
          onClose={() => setShowNewItem(null)}
        />
      )}

      {settingsNoteId && (
        <NoteSettingsDialog
          noteId={settingsNoteId}
          onClose={() => setSettingsNoteId(null)}
        />
      )}
    </div>
  )
}
