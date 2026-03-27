import { X } from 'lucide-react'
import useNotesStore from '../stores/useNotesStore'
import Canvas from './Canvas'
import Toolbar from './Toolbar'

export default function SplitNoteLayout() {
  const activeNoteId = useNotesStore((s) => s.activeNoteId)
  const splitViewNoteId = useNotesStore((s) => s.splitViewNoteId)
  const exitSplitViewFromPane = useNotesStore((s) => s.exitSplitViewFromPane)
  const items = useNotesStore((s) => s.items)

  const firstName =
    activeNoteId && items[activeNoteId]?.type === 'note'
      ? items[activeNoteId].name
      : 'Note'
  const secondName =
    splitViewNoteId && items[splitViewNoteId]?.type === 'note'
      ? items[splitViewNoteId].name
      : 'Note'

  const pane = (which, noteId, label) => (
    <div className="flex flex-1 flex-col min-h-0 min-w-0">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface/90 px-2 py-1 min-h-9">
        <span className="truncate text-xs font-medium text-text-secondary min-w-0">
          {label}
        </span>
        <button
          type="button"
          onClick={() => exitSplitViewFromPane(which)}
          title="Close this pane — return to single note"
          className="shrink-0 ml-auto p-1.5 rounded-lg text-text-muted hover:bg-surface-lighter hover:text-text-primary transition-colors"
        >
          <X size={16} />
        </button>
      </div>
      <div className="shrink-0 border-b border-border bg-surface">
        <Toolbar noteId={noteId} />
      </div>
      <div className="flex flex-1 min-h-0 min-w-0 flex-col">
        <Canvas noteId={noteId} />
      </div>
    </div>
  )

  return (
    <div className="flex flex-1 flex-col landscape:flex-row min-h-0 min-w-0 overflow-hidden">
      <div className="flex flex-1 flex-col min-h-0 min-w-0 border-b border-border landscape:border-b-0 landscape:border-r">
        {pane('first', activeNoteId, firstName)}
      </div>
      <div className="flex flex-1 flex-col min-h-0 min-w-0">
        {pane('second', splitViewNoteId, secondName)}
      </div>
    </div>
  )
}
