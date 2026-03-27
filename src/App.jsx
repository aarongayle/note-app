import { PanelLeftOpen } from 'lucide-react'
import useNotesStore from './stores/useNotesStore'
import NotesConvexSync from './components/NotesConvexSync'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import Canvas from './components/Canvas'
import SplitNoteLayout from './components/SplitNoteLayout'

export default function App() {
  const sidebarOpen = useNotesStore((s) => s.sidebarOpen)
  const activeNoteId = useNotesStore((s) => s.activeNoteId)
  const splitViewNoteId = useNotesStore((s) => s.splitViewNoteId)
  const items = useNotesStore((s) => s.items)
  const toggleSidebar = useNotesStore((s) => s.toggleSidebar)

  const splitNoteOk =
    Boolean(splitViewNoteId) &&
    items[splitViewNoteId]?.type === 'note' &&
    splitViewNoteId !== activeNoteId
  const showSplitView = Boolean(activeNoteId && splitNoteOk)

  return (
    <div className="h-dvh w-full flex overflow-hidden">
      <NotesConvexSync />
      {sidebarOpen && <Sidebar />}

      <div className="flex-1 flex flex-col h-full min-h-0 min-w-0">
        {activeNoteId && (
          <div className="flex min-w-0 items-center border-b border-border bg-surface">
            {!sidebarOpen && (
              <button
                onClick={toggleSidebar}
                className="p-2.5 text-text-muted hover:text-text-primary transition-colors border-r border-border"
              >
                <PanelLeftOpen size={18} />
              </button>
            )}
            <Toolbar />
          </div>
        )}
        {!activeNoteId && !sidebarOpen && (
          <div className="bg-surface border-b border-border">
            <button
              onClick={toggleSidebar}
              className="p-2.5 text-text-muted hover:text-text-primary transition-colors"
            >
              <PanelLeftOpen size={18} />
            </button>
          </div>
        )}

        {showSplitView ? <SplitNoteLayout /> : <Canvas />}
      </div>
    </div>
  )
}

