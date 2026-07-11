/**
 * Georeferencing of imported drawings by two control points: a similarity
 * transform (translation, rotation and uniform scale) from the drawing
 * coordinate system into the local project system. For full CRS support the
 * frontend additionally offers a proj4 string (handled with proj4js there).
 */

export interface ControlPair {
  from: { x: number; y: number }
  to: { x: number; y: number }
}

export type PointTransform = (x: number, y: number) => { x: number; y: number }

export function similarityTransform(p1: ControlPair, p2: ControlPair): PointTransform {
  const sx = p2.from.x - p1.from.x
  const sy = p2.from.y - p1.from.y
  const tx = p2.to.x - p1.to.x
  const ty = p2.to.y - p1.to.y
  const sourceLength = Math.hypot(sx, sy)
  if (sourceLength < 1e-9) {
    throw new Error('control points coincide')
  }
  const scale = Math.hypot(tx, ty) / sourceLength
  const rotation = Math.atan2(ty, tx) - Math.atan2(sy, sx)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  return (x: number, y: number) => {
    const rx = x - p1.from.x
    const ry = y - p1.from.y
    return {
      x: p1.to.x + scale * (rx * cos - ry * sin),
      y: p1.to.y + scale * (rx * sin + ry * cos),
    }
  }
}
