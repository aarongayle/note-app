import { PanelLeftOpen } from 'lucide-react'
import useNotesStore from './stores/useNotesStore'
import NotesConvexSync from './components/NotesConvexSync'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import Canvas from './components/Canvas'

export default function App() {
  const sidebarOpen = useNotesStore((s) => s.sidebarOpen)
  const activeNoteId = useNotesStore((s) => s.activeNoteId)
  const toggleSidebar = useNotesStore((s) => s.toggleSidebar)

  return (
    <div className="h-dvh w-full flex overflow-hidden">
      <NotesConvexSync />
      {sidebarOpen && <Sidebar />}

      <div className="flex-1 flex flex-col h-full min-w-0">
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

        <Canvas />
      </div>
    </div>
  )
}

