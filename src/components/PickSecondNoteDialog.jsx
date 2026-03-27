import { X, FileText } from 'lucide-react'
import useNotesStore from '../stores/useNotesStore'

function collectNoteIdsInOrder(items, rootIds) {
  const out = []
  const walk = (id) => {
    const it = items[id]
    if (!it) return
    if (it.type === 'note') out.push(id)
    else if (it.type === 'folder')
      for (const cid of it.childIds) walk(cid)
  }
  for (const rid of rootIds) walk(rid)
  return out
}

export default function PickSecondNoteDialog({ onClose }) {
  const items = useNotesStore((s) => s.items)
  const rootIds = useNotesStore((s) => s.rootIds)
  const activeNoteId = useNotesStore((s) => s.activeNoteId)
  const enterSplitViewWithNote = useNotesStore((s) => s.enterSplitViewWithNote)

  const candidates = collectNoteIdsInOrder(items, rootIds).filter(
    (id) => id !== activeNoteId
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="bg-surface-light border border-border rounded-xl shadow-2xl w-full max-w-sm max-h-[min(70vh,28rem)] flex flex-col"
        role="dialog"
        aria-labelledby="split-note-dialog-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2
            id="split-note-dialog-title"
            className="text-sm font-semibold text-text-primary"
          >
            Open note beside current
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-lighter text-text-muted hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-2 overflow-y-auto flex-1 min-h-0">
          {candidates.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8 px-4">
              Create another note in the sidebar to compare side by side.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {candidates.map((id) => {
                const note = items[id]
                if (!note || note.type !== 'note') return null
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => {
                        enterSplitViewWithNote(id)
                        onClose()
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left text-sm text-text-secondary hover:bg-surface-lighter hover:text-text-primary transition-colors"
                    >
                      <FileText size={15} className="shrink-0 text-text-muted" />
                      <span className="truncate">{note.name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
