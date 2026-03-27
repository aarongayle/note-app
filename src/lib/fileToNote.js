import { v4 as uuidv4 } from 'uuid'

export function stripExtension(name) {
  return name.replace(/\.[^/.]+$/, '') || 'Imported'
}

export async function measureImageBitmap(file) {
  const bmp = await createImageBitmap(file)
  return { w: bmp.width, h: bmp.height }
}

export function layoutImageSize(natW, natH, maxW) {
  if (natW <= maxW) return { width: natW, height: natH }
  const width = maxW
  const height = (natH * maxW) / natW
  return { width, height }
}

/**
 * @param {string} fileId
 * @param {{ width: number, height: number }} size
 */
export function singleImageEmbed(fileId, size) {
  return [
    {
      id: uuidv4(),
      fileId,
      x: 40,
      y: 40,
      width: size.width,
      height: size.height,
      rotation: 0,
    },
  ]
}
