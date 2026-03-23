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
} from 'lucide-react'
import useNotesStore, { TEMPLATES } from '../stores/useNotesStore'
import NewItemDialog from './NewItemDialog'
import FileStoragePanel from './FileStoragePanel'

function TreeItem({ id, depth = 0 }) {
  const item = useNotesStore((s) => s.items[id])
  const activeNoteId = useNotesStore((s) => s.activeNoteId)
  const isTreeReady = useNotesStore((s) => s.isTreeReady)
  const setActiveNote = useNotesStore((s) => s.setActiveNote)
  const deleteItem = useNotesStore((s) => s.deleteItem)
  const [expanded, setExpanded] = useState(true)
  const [showNewItem, setShowNewItem] = useState(null)

  if (!item) return null

  const isFolder = item.type === 'folder'
  const isActive = item.id === activeNoteId

  return (
    <div>
      <div
        className={`group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer rounded-md text-sm transition-colors ${
          isActive
            ? 'bg-accent/20 text-accent-hover'
            : 'text-text-secondary hover:bg-surface-lighter hover:text-text-primary'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (isFolder) setExpanded(!expanded)
          else setActiveNote(item.id)
        }}
      >
        {isFolder ? (
          <>
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
          </>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            <FileText size={15} className="shrink-0 text-text-muted" />
          </>
        )}

        <span className="truncate flex-1">{item.name}</span>

        <div className="hidden group-hover:flex items-center gap-0.5">
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
          <button
            onClick={(e) => {
              e.stopPropagation()
              deleteItem(item.id)
            }}
            className="p-0.5 rounded hover:bg-danger/20 text-text-muted hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {isFolder && expanded && (
        <div>
          {item.childIds.map((childId) => (
            <TreeItem key={childId} id={childId} depth={depth + 1} />
          ))}
        </div>
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

export default function Sidebar() {
  const rootIds = useNotesStore((s) => s.rootIds)
  const items = useNotesStore((s) => s.items)
  const isTreeReady = useNotesStore((s) => s.isTreeReady)
  const toggleSidebar = useNotesStore((s) => s.toggleSidebar)
  const [showNewItem, setShowNewItem] = useState(null)

  const sortedRootIds = [...rootIds].sort((a, b) => {
    const aItem = items[a]
    const bItem = items[b]
    if (aItem?.type === 'folder' && bItem?.type !== 'folder') return -1
    if (aItem?.type !== 'folder' && bItem?.type === 'folder') return 1
    return (aItem?.createdAt ?? 0) - (bItem?.createdAt ?? 0)
  })

  return (
    <div className="w-64 h-full bg-surface flex flex-col border-r border-border">
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        <h1 className="text-sm font-semibold text-text-primary tracking-wide">
          Notes
        </h1>
        <button
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
        ) : sortedRootIds.length === 0 ? (
          <div className="text-center text-text-muted text-xs py-8 px-4">
            No notes yet. Create one to get started.
          </div>
        ) : (
          sortedRootIds.map((id) => <TreeItem key={id} id={id} />)
        )}
      </div>

      {import.meta.env.VITE_CONVEX_URL ? <FileStoragePanel /> : null}

      {showNewItem && (
        <NewItemDialog
          type={showNewItem}
          onClose={() => setShowNewItem(null)}
        />
      )}
    </div>
  )
}
