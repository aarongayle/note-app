import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api.js'
import { quadWarpMatrix3d } from '../lib/imageEmbedGeometry.js'

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
        const rot = e.rotation ?? 0
        const cropLeft = Math.max(0, Number(e.cropLeft ?? 0))
        const cropTop = Math.max(0, Number(e.cropTop ?? 0))
        const cropRight = Math.max(0, Number(e.cropRight ?? 0))
        const cropBottom = Math.max(0, Number(e.cropBottom ?? 0))
        const skewNwX = Number(e.skewNwX ?? 0)
        const skewNwY = Number(e.skewNwY ?? 0)
        const skewNeX = Number(e.skewNeX ?? 0)
        const skewNeY = Number(e.skewNeY ?? 0)
        const skewSeX = Number(e.skewSeX ?? 0)
        const skewSeY = Number(e.skewSeY ?? 0)
        const skewSwX = Number(e.skewSwX ?? 0)
        const skewSwY = Number(e.skewSwY ?? 0)
        const sourceW = Math.max(1, e.width + cropLeft + cropRight)
        const sourceH = Math.max(1, e.height + cropTop + cropBottom)
        const hasSkew =
          skewNwX || skewNwY || skewNeX || skewNeY ||
          skewSeX || skewSeY || skewSwX || skewSwY
        const warpTransform = hasSkew
          ? quadWarpMatrix3d(
              e.width,
              e.height,
              [skewNwX, skewNwY],
              [e.width + skewNeX, skewNeY],
              [e.width + skewSeX, e.height + skewSeY],
              [skewSwX, e.height + skewSwY]
            )
          : undefined
        return (
          <div
            key={e.id}
            className="absolute select-none"
            style={{
              left: e.x,
              top: e.y,
              width: e.width,
              height: e.height,
              transform: rot !== 0 ? `rotate(${rot}deg)` : undefined,
              transformOrigin: 'center center',
              overflow: 'visible',
            }}
          >
            <div
              style={{
                width: e.width,
                height: e.height,
                overflow: 'hidden',
                transform: warpTransform,
                transformOrigin: '0 0',
              }}
            >
              <img
                src={href}
                alt=""
                draggable={false}
                className="block absolute max-w-none"
                style={{
                  left: -cropLeft,
                  top: -cropTop,
                  width: sourceW,
                  height: sourceH,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
