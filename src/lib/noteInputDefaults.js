import { useEffect, useState } from 'react'

/** Same breakpoint as Tailwind `sm` minus 1px — phones, not typical tablets. */
export const PHONE_CLASS_MAX_PX = 639

/** Viewports narrower than Tailwind `sm` (640px) — phones, not typical tablets. */
export const PHONE_VIEWPORT_MEDIA = `(max-width: ${PHONE_CLASS_MAX_PX}px)`

/**
 * True for portrait phones (narrow width) or landscape phones (short height).
 * Tablets usually exceed both dimensions; keeps finger input off large canvases where
 * stylus + ignoring touch preserves palm rejection.
 */
export function getPhoneClassViewport() {
  if (typeof window === 'undefined') return false
  const mqW = window.matchMedia(PHONE_VIEWPORT_MEDIA)
  const mqH = window.matchMedia(`(max-height: ${PHONE_CLASS_MAX_PX}px)`)
  return mqW.matches || mqH.matches
}

/**
 * Subscribes to width/height media queries so stylus mode updates when rotating a phone.
 * @returns {boolean}
 */
export function usePhoneClassViewport() {
  const [phoneClass, setPhoneClass] = useState(getPhoneClassViewport)
  useEffect(() => {
    const mqW = window.matchMedia(PHONE_VIEWPORT_MEDIA)
    const mqH = window.matchMedia(`(max-height: ${PHONE_CLASS_MAX_PX}px)`)
    const sync = () => setPhoneClass(mqW.matches || mqH.matches)
    sync()
    mqW.addEventListener('change', sync)
    mqH.addEventListener('change', sync)
    return () => {
      mqW.removeEventListener('change', sync)
      mqH.removeEventListener('change', sync)
    }
  }, [])
  return phoneClass
}

/**
 * @returns {'stylus' | 'keyboard'}
 */
export function getDefaultNoteInputMode() {
  if (typeof window === 'undefined') return 'stylus'
  return window.matchMedia(PHONE_VIEWPORT_MEDIA).matches
    ? 'keyboard'
    : 'stylus'
}

/**
 * Reactive default when a note has no explicit `noteInputModes[id]`.
 * @returns {'stylus' | 'keyboard'}
 */
export function useDefaultNoteInputMode() {
  const [mode, setMode] = useState(getDefaultNoteInputMode)
  useEffect(() => {
    const mq = window.matchMedia(PHONE_VIEWPORT_MEDIA)
    const sync = () =>
      setMode(mq.matches ? 'keyboard' : 'stylus')
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return mode
}
