import { useState } from 'react'
import { X, Square, AlignJustify, Grid3X3, Grip } from 'lucide-react'
import useNotesStore, { TEMPLATES } from '../stores/useNotesStore'

const TEMPLATE_ICONS = {
  blank: Square,
  lined: AlignJustify,
  grid: Grid3X3,
  dotted: Grip,
}

export default function NewItemDialog({ type, parentId = null, onClose }) {
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('lined')
  const createNote = useNotesStore((s) => s.createNote)
  const createFolder = useNotesStore((s) => s.createFolder)

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    if (type === 'note') {
      createNote(trimmed, template, parentId)
    } else {
      createFolder(trimmed, parentId)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface-light border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">
            New {type === 'note' ? 'Note' : 'Folder'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-lighter text-text-muted hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder={type === 'note' ? 'My Note' : 'My Folder'}
              className="w-full px-3 py-2 rounded-lg bg-surface text-text-primary text-sm border border-border focus:border-accent focus:outline-none placeholder:text-text-muted"
            />
          </div>

          {type === 'note' && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-2">
                Template
              </label>
              <div className="grid grid-cols-4 gap-2">
                {Object.values(TEMPLATES).map((tmpl) => {
                  const Icon = TEMPLATE_ICONS[tmpl.id]
                  return (
                    <button
                      key={tmpl.id}
                      type="button"
                      onClick={() => setTemplate(tmpl.id)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs transition-colors ${
                        template === tmpl.id
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-border bg-surface hover:border-border-light text-text-secondary'
                      }`}
                    >
                      <Icon size={20} />
                      {tmpl.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-surface-lighter text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
