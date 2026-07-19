import { describe, expect, it } from 'vitest'
import { assessLiftStationNeed, findRoadCrossings, protectiveGrilles } from './structures'

describe('findRoadCrossings', () => {
  const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]

  it('finds crossings with chainage and justified casing length', () => {
    const crossings = findRoadCrossings(route, [
      { id: 'дорога А', points: [{ x: 50, y: -10 }, { x: 50, y: 10 }], widthM: 30 },
      { id: 'дорога Б', points: [{ x: 90, y: 50 }, { x: 110, y: 50 }] },
    ])
    expect(crossings).toHaveLength(2)
    expect(crossings[0].roadId).toBe('дорога А')
    expect(crossings[0].stationM).toBe(50)
    expect(crossings[0].casingLengthM.value).toBe(40) // 30 + 2×5
    expect(crossings[0].casingLengthM.refs).toContain('crossing.casing')
    expect(crossings[1].stationM).toBe(150) // 100 along leg 1 + 50 up leg 2
    expect(crossings[1].casingLengthM.value).toBe(30) // default 20 + 2×5
  })

  it('ignores roads that do not cross the route', () => {
    const crossings = findRoadCrossings(route, [
      { id: 'вдали', points: [{ x: 0, y: 50 }, { x: 50, y: 50 }] },
    ])
    expect(crossings).toHaveLength(0)
  })
})

describe('protectiveGrilles', () => {
  it('one grille per inspection manhole, justified by the design task', () => {
    const g = protectiveGrilles(57)
    expect(g.value).toBe(57)
    expect(g.refs).toContain('manhole.grille')
  })
})

describe('assessLiftStationNeed', () => {
  it('flags a station when the gravity depth exceeds the limit', () => {
    const a = assessLiftStationNeed([2, 4, 6.5, 8.4], 8)
    expect(a.needed.value).toBe(true)
    expect(a.atDepthM).toBe(8.4)
    expect(a.constraints.join(' ')).toContain('аварийный перелив')
    expect(a.needed.refs).toContain('pump.liftStation')
  })

  it('stays gravity-only within the limit', () => {
    const a = assessLiftStationNeed([2, 4, 6], 8)
    expect(a.needed.value).toBe(false)
    expect(a.atDepthM).toBeNull()
    expect(a.constraints).toHaveLength(0)
  })
})
