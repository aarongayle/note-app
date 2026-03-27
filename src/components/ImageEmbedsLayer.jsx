import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api.js'

/**
 * Absolutely positioned images in note space (same box as the SVG layer).
 * @param {{ embeds: Array<{ id: string, fileId: string, x: number, y: number, width: number, height: number, rotation: number }>, minHeight: number, isKeyboard: boolean }} props
 */
export default function ImageEmbedsLayer({ embeds, minHeight, isKeyboard }) {
  const fileIds = embeds.map((e) => e.fileId)
  const urlMap = useQuery(
    api.files.getBatchDownloadUrls,
    fileIds.length > 0 ? { fileIds } : 'skip'
  )

  if (embeds.length === 0) return null

  return (
    <div
      className={`absolute left-0 right-0 top-0 w-full pointer-events-none ${isKeyboard ? 'z-[1]' : 'z-[1]'}`}
      style={{ minHeight }}
    >
      {embeds.map((e) => {
        const href = urlMap?.[e.fileId]
        if (!href) return null
        const cx = e.x + e.width / 2
        const cy = e.y + e.height / 2
        const rot = e.rotation ?? 0
        return (
          <img
            key={e.id}
            src={href}
            alt=""
            draggable={false}
            className="absolute select-none"
            style={{
              left: 0,
              top: 0,
              width: e.width,
              height: e.height,
              transform: `translate(${cx}px, ${cy}px) rotate(${rot}deg) translate(-50%, -50%)`,
              transformOrigin: 'center center',
            }}
          />
        )
      })}
    </div>
  )
}
