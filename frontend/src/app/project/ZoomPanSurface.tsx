import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PointerEvent as ReactPointerEvent, ReactNode, WheelEvent as ReactWheelEvent } from 'react'

const MIN_ZOOM = 1
const MAX_ZOOM = 5

export function ZoomPanSurface({ children, label }: { children: ReactNode; label: string }) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null)

  const setClampedZoom = (next: number) => {
    const value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))
    setZoom(value)
    if (value === 1) setPan({ x: 0, y: 0 })
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    setClampedZoom(zoom * (event.deltaY < 0 ? 1.18 : 1 / 1.18))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= 1 || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    setPan({ x: active.panX + event.clientX - active.x, y: active.panY + event.clientY - active.y })
  }

  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
  }

  const reset = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  return (
    <div
      className={`zoom-pan-surface${zoom > 1 ? ' is-zoomed' : ''}`}
      aria-label={label}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      <div className="zoom-pan-content" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        {children}
      </div>
      <div className="zoom-pan-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => setClampedZoom(zoom * 1.3)} disabled={zoom >= MAX_ZOOM} aria-label={t('project.zoom.zoomIn')}>+</button>
        <span className="mono">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setClampedZoom(zoom / 1.3)} disabled={zoom <= MIN_ZOOM} aria-label={t('project.zoom.zoomOut')}>−</button>
        <button type="button" onClick={reset} disabled={zoom === 1 && pan.x === 0 && pan.y === 0}>{t('project.zoom.reset')}</button>
      </div>
    </div>
  )
}
