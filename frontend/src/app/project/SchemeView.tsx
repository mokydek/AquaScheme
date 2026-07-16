import { useMemo } from 'react'
import type { TracedNetwork } from '@aquascheme/engine'

/**
 * Visual network scheme in the style of the генплановская «Схема ливневой
 * канализации»: white sheet, the designed route as a thick blue line with
 * diameter labels rotated along the segments, the outlet as a filled blue
 * rectangle with its design flow, light red context (buildings), a north
 * compass and a legend. Pure SVG built from the project data — no map tiles.
 */

const W = 1000
const H = 640
const PAD = 56

const ROUTE = '#1f3f9e' // толстая синяя линия коридора сетей
const CONTEXT = '#d98873' // красные линии (подоснова)
const INK = '#1a1a1a'

export interface SchemeViewProps {
  title: string
  network: TracedNetwork
  buildings: Array<{ x: number; y: number; label?: string | null }>
  pipeDiameterMm: Map<string, number>
  outletFlowLps?: number
  outletLabel?: string
}

export function SchemeView({ title, network, buildings, pipeDiameterMm, outletFlowLps, outletLabel }: SchemeViewProps) {
  const model = useMemo(() => {
    const pts = [...network.nodes.map((n) => ({ x: n.x, y: n.y })), ...buildings]
    if (pts.length === 0) return null
    const minX = Math.min(...pts.map((p) => p.x))
    const maxX = Math.max(...pts.map((p) => p.x))
    const minY = Math.min(...pts.map((p) => p.y))
    const maxY = Math.max(...pts.map((p) => p.y))
    const scale = Math.min((W - 2 * PAD) / Math.max(maxX - minX, 1), (H - 2 * PAD) / Math.max(maxY - minY, 1))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const tx = (x: number) => W / 2 + (x - cx) * scale
    const ty = (y: number) => H / 2 - (y - cy) * scale // flip: north up
    const nodeById = new Map(network.nodes.map((n) => [n.id, n]))

    const segments = network.pipes.flatMap((p) => {
      const a = nodeById.get(p.fromNode)
      const b = nodeById.get(p.toNode)
      if (!a || !b) return []
      return [{ id: p.id, x1: tx(a.x), y1: ty(a.y), x2: tx(b.x), y2: ty(b.y), d: pipeDiameterMm.get(p.id) }]
    })

    // Diameter labels only where the diameter changes along the list.
    let last = 0
    const labels = segments.flatMap((s) => {
      if (!s.d || s.d === last) return []
      last = s.d
      const mx = (s.x1 + s.x2) / 2
      const my = (s.y1 + s.y2) / 2
      let angle = (Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180) / Math.PI
      if (angle > 90 || angle < -90) angle += 180
      return [{ id: s.id, mx, my, angle, text: `Ø${s.d}` }]
    })

    const outlet = network.nodes.find((n) => n.kind === 'source')
    return {
      segments,
      labels,
      buildings: buildings.map((b) => ({ x: tx(b.x), y: ty(b.y), label: b.label ?? '' })),
      outlet: outlet ? { x: tx(outlet.x), y: ty(outlet.y) } : null,
    }
  }, [network, buildings, pipeDiameterMm])

  if (!model) return null

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', background: '#ffffff', border: '1px solid var(--border, #d9d9d9)' }}
      role="img"
      aria-label={title}
    >
      {/* Title */}
      <text x={W / 2} y={30} textAnchor="middle" fontSize={20} fill={INK} fontWeight={600}>
        {title}
      </text>

      {/* North compass */}
      <g transform="translate(42,58)" stroke={INK} fill="none" strokeWidth={1}>
        <circle r={16} />
        <line x1={0} y1={12} x2={0} y2={-12} />
        <path d="M 0 -12 L -4 -4 L 4 -4 Z" fill={INK} stroke="none" />
        <text x={0} y={-22} textAnchor="middle" fontSize={12} fill={INK} stroke="none">С</text>
      </g>

      {/* Context: buildings (красные линии style) */}
      {model.buildings.map((b, i) => (
        <g key={i}>
          <rect x={b.x - 7} y={b.y - 5} width={14} height={10} fill="none" stroke={CONTEXT} strokeWidth={1} />
          {b.label && (
            <text x={b.x} y={b.y - 8} textAnchor="middle" fontSize={9} fill={CONTEXT}>
              {b.label}
            </text>
          )}
        </g>
      ))}

      {/* Route: thick blue */}
      {model.segments.map((s) => (
        <line key={s.id} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={ROUTE} strokeWidth={4} strokeLinecap="round" />
      ))}

      {/* Diameter labels along the route */}
      {model.labels.map((l) => (
        <text
          key={l.id}
          x={l.mx}
          y={l.my - 7}
          textAnchor="middle"
          fontSize={12}
          fill={ROUTE}
          transform={`rotate(${l.angle} ${l.mx} ${l.my})`}
        >
          {l.text}
        </text>
      ))}

      {/* Outlet: filled blue rectangle with flow */}
      {model.outlet && (
        <g>
          <rect x={model.outlet.x - 10} y={model.outlet.y - 8} width={20} height={16} fill={ROUTE} opacity={0.85} />
          <text x={model.outlet.x + 14} y={model.outlet.y - 2} fontSize={12} fill={INK}>
            {outletLabel ?? 'Выпуск'}
          </text>
          {outletFlowLps != null && (
            <text x={model.outlet.x + 14} y={model.outlet.y + 12} fontSize={11} fill={INK}>
              {outletFlowLps.toFixed(1)} л/с
            </text>
          )}
        </g>
      )}

      {/* Legend */}
      <g transform={`translate(${PAD - 20},${H - 64})`} fontSize={11} fill={INK}>
        <text x={0} y={0} fontWeight={600}>Условные обозначения</text>
        <line x1={0} y1={14} x2={34} y2={14} stroke={CONTEXT} strokeWidth={1} />
        <text x={42} y={18}>подоснова (здания, красные линии)</text>
        <line x1={0} y1={30} x2={34} y2={30} stroke={ROUTE} strokeWidth={4} />
        <text x={42} y={34}>коридор сетей (проектируемая трасса)</text>
        <rect x={11} y={40} width={12} height={10} fill={ROUTE} opacity={0.85} />
        <text x={42} y={49}>выпуск / очистные сооружения</text>
      </g>
    </svg>
  )
}
