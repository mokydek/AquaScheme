import { describe, expect, it } from 'vitest'
import {
  accumulateGravityFlows,
  buildSewerSchedule,
  circularSection,
  computeGravityProfile,
  designGravitySegment,
  fillForFlow,
  GRAVITY_DIAMETERS,
  gravityFlowM3s,
  manningVelocity,
  picketLabel,
  solveGravityNetwork,
} from './gravity'
import type { TracedNetwork } from '../trace'

// Reference values are computed by hand (Chezy-Manning, n = 0.014) as required
// by the engineering guardrails.

describe('standard diameter series', () => {
  it('offers every catalogued size, ascending and unique', () => {
    expect([...GRAVITY_DIAMETERS]).toEqual([...GRAVITY_DIAMETERS].sort((a, b) => a - b))
    expect(new Set(GRAVITY_DIAMETERS).size).toBe(GRAVITY_DIAMETERS.length)
  })

  it('includes DN450, catalogued as АГСК-3 241-702-0903 and demanded by municipal assignments', () => {
    expect(GRAVITY_DIAMETERS).toContain(450)
    // Without it the solver silently rounds a DN450 assignment to 400 or 500.
    const between = [...GRAVITY_DIAMETERS].filter((d) => d > 400 && d < 500)
    expect(between).toEqual([450])
  })

  it('actually selects DN450 when the flow lands between DN400 and DN500', () => {
    let picked450 = false
    for (let flowLps = 40; flowLps <= 400; flowLps += 5) {
      const design = designGravitySegment(flowLps, { system: 'sewer', strategy: 'minBurial' })
      if (design.diameterMm === 450) { picked450 = true; break }
    }
    expect(picked450).toBe(true)
  })
})

describe('circular partial-flow geometry', () => {
  it('full pipe matches A = πD²/4 and R = D/4', () => {
    const D = 0.3
    const s = circularSection(D, 1)
    expect(s.areaM2).toBeCloseTo((Math.PI * D * D) / 4, 6)
    expect(s.hydraulicRadiusM).toBeCloseTo(D / 4, 6)
  })

  it('half-full pipe: area is half of full, R equals full pipe R', () => {
    const D = 0.3
    const half = circularSection(D, 0.5)
    const full = circularSection(D, 1)
    expect(half.areaM2).toBeCloseTo(full.areaM2 / 2, 6)
    // A known property: R at half full equals R at full (both D/4).
    expect(half.hydraulicRadiusM).toBeCloseTo(D / 4, 6)
    expect(half.topWidthM).toBeCloseTo(D, 6)
  })
})

describe('Chezy-Manning reference (hand calc, n = 0.014)', () => {
  it('D=300 mm, i=0.005, full pipe: v≈0.898 m/s, Q≈63.5 L/s', () => {
    const D = 0.3
    const n = 0.014
    const i = 0.005
    const R = D / 4 // 0.075
    // v = (1/0.014) * 0.075^(2/3) * sqrt(0.005)
    const v = manningVelocity(R, i, n)
    expect(v).toBeCloseTo(0.898, 2)
    const Q = gravityFlowM3s(D, i, 1, n)
    expect(Q * 1000).toBeCloseTo(63.5, 0)
  })

  it('half-full carries half the full-pipe flow at the same velocity', () => {
    const D = 0.3
    const n = 0.014
    const i = 0.005
    const full = gravityFlowM3s(D, i, 1, n)
    const half = gravityFlowM3s(D, i, 0.5, n)
    expect(half).toBeCloseTo(full / 2, 5)
  })

  it('fillForFlow inverts the flow relation', () => {
    const D = 0.3
    const n = 0.014
    const i = 0.005
    const Q = gravityFlowM3s(D, i, 0.6, n)
    const fill = fillForFlow(Q, D, i, n)
    expect(fill).not.toBeNull()
    expect(fill as number).toBeCloseTo(0.6, 2)
  })

  it('returns null when flow exceeds capacity at the fill cap', () => {
    expect(fillForFlow(10, 0.2, 0.007, 0.014)).toBeNull()
  })
})

describe('gravity segment design (СН РК 4.01-03-2013*)', () => {
  it('street sewer uses at least the 200 mm minimum diameter (5.9.1)', () => {
    const d = designGravitySegment(5, { system: 'sewer', level: 'street' })
    expect(d.diameterMm).toBeGreaterThanOrEqual(200)
    expect(d.fillRatio).toBeLessThanOrEqual(0.8)
    expect(d.velocityMs).toBeGreaterThanOrEqual(0.7) // Таблица 5.19
  })

  it('storm street network uses at least 250 mm (5.9.1)', () => {
    const d = designGravitySegment(20, { system: 'storm', level: 'street' })
    expect(d.diameterMm).toBeGreaterThanOrEqual(250)
    expect(d.fillRatio).toBeLessThanOrEqual(1)
  })

  it('keeps filling at or below 0.8 for a large sewer flow (5.10.7)', () => {
    const d = designGravitySegment(120, { system: 'sewer', level: 'street' })
    expect(d.fillRatio).toBeLessThanOrEqual(0.8 + 1e-6)
    expect(d.velocityMs).toBeGreaterThanOrEqual(0.7)
  })

  it('a steep ground slope may exceed the max velocity and is flagged (5.10.3)', () => {
    const d = designGravitySegment(30, { system: 'sewer', level: 'street', groundSlope: 0.08, material: 'nonmetal' })
    if (d.velocityMs > 4) {
      expect(d.issues.some((i) => i.code === 'overMaxVelocity')).toBe(true)
    }
  })

  it('does not silently use the P=0.33 storm velocity exception when P is absent', () => {
    const regular = designGravitySegment(5, { system: 'storm', level: 'street' })
    const exceptional = designGravitySegment(5, {
      system: 'storm',
      level: 'street',
      stormRainPeriodYears: 0.33,
    })
    expect(regular.velocityMs).toBeGreaterThanOrEqual(0.7)
    expect(exceptional.velocityMs).toBeGreaterThanOrEqual(0.6)
  })

  it('never invents a diameter when the active catalogue has no usable position', () => {
    const empty = designGravitySegment(20, { system: 'storm', level: 'street', allowedDiametersMm: [] })
    expect(empty.diameterMm).toBe(0)
    expect(empty.issues.some((issue) => issue.code === 'noSuitableDiameter')).toBe(true)

    const undersized = designGravitySegment(20, { system: 'storm', level: 'street', allowedDiametersMm: [110, 160, 200] })
    expect(undersized.diameterMm).toBe(110)
    expect(undersized.issues.some((issue) => issue.code === 'noSuitableDiameter')).toBe(true)
  })
})

describe('network flow accumulation', () => {
  const network: TracedNetwork = {
    nodes: [
      { id: 'S', kind: 'source', x: 0, y: 0, groundElevation: 100 },
      { id: 'J1', kind: 'junction', x: 10, y: 0, groundElevation: 101 },
      { id: 'B1', kind: 'building', x: 20, y: 0, groundElevation: 102, buildingId: 'b1' },
      { id: 'B2', kind: 'building', x: 10, y: 10, groundElevation: 103, buildingId: 'b2' },
    ],
    pipes: [
      { id: 'p_sj', kind: 'main', fromNode: 'S', toNode: 'J1', lengthM: 10 },
      { id: 'p_jb1', kind: 'service', fromNode: 'J1', toNode: 'B1', lengthM: 10 },
      { id: 'p_jb2', kind: 'service', fromNode: 'J1', toNode: 'B2', lengthM: 10 },
    ],
    totalLengthM: 30,
  }

  it('sums building flows toward the outlet along the tree', () => {
    const flows = accumulateGravityFlows(network, new Map([['b1', 3], ['b2', 2]]))
    // The trunk S-J1 carries both buildings; each service carries its own.
    expect(flows.get('p_sj')).toBeCloseTo(5, 6)
    expect(flows.get('p_jb1')).toBeCloseTo(3, 6)
    expect(flows.get('p_jb2')).toBeCloseTo(2, 6)
  })

  it('solveGravityNetwork designs every pipe and reports the outlet flow', () => {
    const result = solveGravityNetwork({
      network,
      buildingFlowLps: new Map([['b1', 3], ['b2', 2]]),
      system: 'sewer',
      freezingDepthM: 1.5,
    })
    expect(result.pipes).toHaveLength(3)
    expect(result.outletFlowLps).toBeCloseTo(5, 6)
    const trunk = result.pipes.find((p) => p.id === 'p_sj')
    expect(trunk?.diameterMm).toBeGreaterThanOrEqual(200)
    expect(result.profile).not.toBeNull()
  })

  it('sums separate gravity branches that enter the outlet directly', () => {
    const branched: TracedNetwork = {
      nodes: [
        { id: 'S', kind: 'source', x: 0, y: 0, groundElevation: 100 },
        { id: 'B1', kind: 'building', x: 10, y: 0, groundElevation: 101, buildingId: 'b1' },
        { id: 'B2', kind: 'building', x: 0, y: 10, groundElevation: 101, buildingId: 'b2' },
      ],
      pipes: [
        { id: 'p1', kind: 'main', fromNode: 'S', toNode: 'B1', lengthM: 10 },
        { id: 'p2', kind: 'main', fromNode: 'S', toNode: 'B2', lengthM: 10 },
      ],
      totalLengthM: 20,
    }
    const result = solveGravityNetwork({
      network: branched,
      buildingFlowLps: new Map([['b1', 3], ['b2', 2]]),
      system: 'sewer',
      freezingDepthM: 1.5,
    })
    expect(result.outletFlowLps).toBeCloseTo(5, 6)
    expect(result.profile?.pipeIds).toHaveLength(1)
  })
})

describe('longitudinal profile (invert levels, depths — п. 7.2.4)', () => {
  // Flat ground forces the invert to drop by the hydraulic slope, so the
  // excavation depth grows from the head down to the outlet.
  const flat: TracedNetwork = {
    nodes: [
      { id: 'S', kind: 'source', x: 0, y: 0, groundElevation: 100 },
      { id: 'J1', kind: 'junction', x: 100, y: 0, groundElevation: 100 },
      { id: 'J2', kind: 'junction', x: 200, y: 0, groundElevation: 100 },
      { id: 'H', kind: 'building', x: 300, y: 0, groundElevation: 100, buildingId: 'b1' },
    ],
    pipes: [
      { id: 'p1', kind: 'main', fromNode: 'S', toNode: 'J1', lengthM: 100 },
      { id: 'p2', kind: 'main', fromNode: 'J1', toNode: 'J2', lengthM: 100 },
      { id: 'p3', kind: 'main', fromNode: 'J2', toNode: 'H', lengthM: 100 },
    ],
    totalLengthM: 300,
  }

  it('starts at min cover and deepens toward the outlet on flat ground', () => {
    const result = solveGravityNetwork({
      network: flat,
      buildingFlowLps: new Map([['b1', 6]]),
      system: 'sewer',
      freezingDepthM: 1.5,
    })
    const profile = result.profile!
    expect(profile.stations).toHaveLength(4)
    // Head (chainage 0) starts near min cover; outlet is the deepest.
    const head = profile.stations[0]
    const outlet = profile.stations[profile.stations.length - 1]
    expect(head.chainageM).toBe(0)
    expect(outlet.nodeId).toBe('S')
    expect(outlet.depthM).toBeGreaterThan(head.depthM)
    expect(profile.maxDepthM).toBeGreaterThanOrEqual(outlet.depthM - 1e-9)
    // Frost controls here: depth to invert is freezing 1.5 − 0.3 = 1.2 m.
    expect(head.depthM).toBeGreaterThanOrEqual(1.2)
    // Invert falls monotonically from head to outlet.
    for (let i = 1; i < profile.stations.length; i++) {
      expect(profile.stations[i].invertElevationM).toBeLessThanOrEqual(
        profile.stations[i - 1].invertElevationM + 1e-6,
      )
    }
  })

  it('computeGravityProfile returns null without an outlet', () => {
    const noOutlet: TracedNetwork = {
      nodes: [{ id: 'A', kind: 'junction', x: 0, y: 0, groundElevation: 100 }],
      pipes: [],
      totalLengthM: 0,
    }
    expect(computeGravityProfile({ network: noOutlet, design: new Map(), freezingDepthM: 1.5 })).toBeNull()
  })

  it('does not fabricate a longitudinal profile when freezing depth is omitted', () => {
    const result = solveGravityNetwork({
      network: flat,
      buildingFlowLps: new Map([['b1', 6]]),
      system: 'sewer',
    })
    expect(result.profile).toBeNull()
  })

  it('converts the 0.7 m crown cover to invert depth exactly once for a large pipe', () => {
    const twoNode: TracedNetwork = {
      nodes: [
        { id: 'S', kind: 'source', x: 0, y: 0, groundElevation: 100 },
        { id: 'H', kind: 'building', x: 100, y: 0, groundElevation: 100, buildingId: 'b1' },
      ],
      pipes: [{ id: 'p', kind: 'main', fromNode: 'S', toNode: 'H', lengthM: 100 }],
      totalLengthM: 100,
    }
    const profile = computeGravityProfile({
      network: twoNode,
      design: new Map([['p', { diameterMm: 1200, slope: 0 }]]),
      freezingDepthM: 1.8,
    })!
    expect(profile.stations[0].depthM).toBe(1.9)
    expect(profile.stations[0].depthM - profile.stations[0].diameterMm / 1000).toBeCloseTo(0.7, 9)
  })
})

describe('materials schedule (ведомость колодцев и труб)', () => {
  it('picketLabel formats chainage as ПК N+dd', () => {
    expect(picketLabel(0)).toBe('ПК0+00')
    expect(picketLabel(1057)).toBe('ПК10+57')
    expect(picketLabel(250)).toBe('ПК2+50')
  })

  it('buildSewerSchedule lists manholes and pipe totals by diameter', () => {
    const flat: TracedNetwork = {
      nodes: [
        { id: 'S', kind: 'source', x: 0, y: 0, groundElevation: 100 },
        { id: 'J1', kind: 'junction', x: 100, y: 0, groundElevation: 100 },
        { id: 'H', kind: 'building', x: 200, y: 0, groundElevation: 100, buildingId: 'b1' },
      ],
      pipes: [
        { id: 'p1', kind: 'main', fromNode: 'S', toNode: 'J1', lengthM: 100 },
        { id: 'p2', kind: 'main', fromNode: 'J1', toNode: 'H', lengthM: 100 },
      ],
      totalLengthM: 200,
    }
    const result = solveGravityNetwork({
      network: flat,
      buildingFlowLps: new Map([['b1', 6]]),
      system: 'sewer',
      freezingDepthM: 1.5,
    })
    const schedule = buildSewerSchedule(result)
    expect(schedule.manholes).toHaveLength(3)
    expect(schedule.manholes[0].label).toBe('ВК-1')
    expect(schedule.manholes[schedule.manholes.length - 1].label).toBe('Вып.')
    expect(schedule.manholes[0].depthMm).toBeGreaterThanOrEqual(1200)
    expect(schedule.manholes[0].picket).toMatch(/^ПК/)
    expect(schedule.pipes.every((p) => p.designation.includes('безнапорная'))).toBe(true)
    expect(schedule.pipes.every((p) => p.agskCode === '241-7')).toBe(true) // ЖБ раздел АГСК
    // Ведомость заказывает трубу, а не ось: из 200 м по осям вычитаются
    // половины камер на концах двух участков (п. 7.4.2). Меньше оси, но не
    // сильно — ровно на камеры, поэтому проверяется и величина вычета.
    const deductionM = 200 - schedule.totalPipeLengthM
    expect(deductionM).toBeGreaterThan(0)
    expect(deductionM).toBeLessThanOrEqual(3 * 1.5)
    expect(schedule.totalPipeLengthM).toBe(197)
  })
})

describe('designGravitySegment minBurial strategy (benchmark G-14)', () => {
  it('prefers a large flat pipe on flat terrain where minDiameter steepens a small one', () => {
    const flat = { system: 'storm' as const, groundSlope: 0.0005 }
    const a = designGravitySegment(2400, { ...flat, strategy: 'minBurial' })
    const b = designGravitySegment(2400, flat)
    expect(a.issues).toHaveLength(0)
    expect(a.diameterMm).toBeGreaterThanOrEqual(1500)
    expect(a.slope).toBeLessThanOrEqual(0.002)
    expect(a.diameterMm).toBeGreaterThan(b.diameterMm)
    expect(a.slope).toBeLessThan(b.slope)
  })

  it('still picks the smallest pipe that follows sloped terrain', () => {
    const a = designGravitySegment(100, { system: 'storm', groundSlope: 0.02, strategy: 'minBurial' })
    expect(a.diameterMm).toBeLessThanOrEqual(500)
    expect(a.slope).toBeGreaterThanOrEqual(0.002)
    expect(a.issues.filter((i) => i.code === 'overMaxFilling')).toHaveLength(0)
  })
})

describe('нулевой расчётный расход', () => {
  it('диаметр не подбирается, а принимается по ряду, и об этом сказано', () => {
    // Раньше перебор доходил до конца ряда: ни один диаметр не проходит
    // проверку на самоочищение при нулевой скорости. На реконструкции по
    // ул. Станкевича, где притока по зданиям нет, в план так попадало «Ø2400»
    // с замечанием о переполнении — при нулевом-то расходе.
    const design = designGravitySegment(0, { system: 'sewer' })
    expect(design.fillRatio).toBe(0)
    expect(design.velocityMs).toBe(0)
    expect(design.issues.map((issue) => issue.code)).toEqual(['noDesignFlow'])
    expect(design.diameterMm).toBeLessThan(500)
  })

  it('ряд по техническим условиям принимается как есть', () => {
    const design = designGravitySegment(0, { system: 'sewer', allowedDiametersMm: [450] })
    expect(design.diameterMm).toBe(450)
    expect(design.issues.map((issue) => issue.code)).toEqual(['noDesignFlow'])
  })
})
