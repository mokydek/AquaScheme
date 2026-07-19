import { describe, expect, it } from 'vitest'
import { compareWithMasterPlan } from './masterplan'

/** Generic shape mirroring a master-plan storm scheme: sources into a trunk. */
const PLAN = [
  { id: 'ОС-А — узел 1', planDiameterMm: 1200, planFlowLps: 200 },
  { id: 'узел 1 — выпуск', planDiameterMm: 2000 },
  { id: 'НС — узел 1', planDiameterMm: 800, parallelLines: 2 },
]

describe('compareWithMasterPlan', () => {
  it('matches when design repeats the plan steps and line counts', () => {
    const cmp = compareWithMasterPlan(
      [
        { id: 'ОС-А — узел 1', designDiameterMm: 1200 },
        { id: 'узел 1 — выпуск', designDiameterMm: 2000 },
        { id: 'НС — узел 1', designDiameterMm: 800, parallelLines: 2 },
      ],
      PLAN,
    )
    expect(cmp.differing).toBe(0)
    expect(cmp.agreesWithPlan.value).toBe(true)
    expect(cmp.agreesWithPlan.refs).toContain('scheme.masterPlanBasis')
  })

  it('reports step differences without hiding them', () => {
    const cmp = compareWithMasterPlan(
      [
        { id: 'ОС-А — узел 1', designDiameterMm: 1500 },
        { id: 'узел 1 — выпуск', designDiameterMm: 2000 },
        { id: 'НС — узел 1', designDiameterMm: 800, parallelLines: 2 },
      ],
      PLAN,
    )
    const row = cmp.rows.find((r) => r.id === 'ОС-А — узел 1')
    expect(row?.verdict).toBe('stepDiffers')
    expect(row?.stepDelta).toBe(1)
    expect(cmp.agreesWithPlan.value).toBe(false)
  })

  it('flags different parallel line counts and missing/extra segments', () => {
    const cmp = compareWithMasterPlan(
      [
        { id: 'узел 1 — выпуск', designDiameterMm: 2000 },
        { id: 'НС — узел 1', designDiameterMm: 800 },
        { id: 'новый боковой', designDiameterMm: 400 },
      ],
      PLAN,
    )
    expect(cmp.rows.find((r) => r.id === 'ОС-А — узел 1')?.verdict).toBe('missingInDesign')
    expect(cmp.rows.find((r) => r.id === 'НС — узел 1')?.verdict).toBe('linesDiffer')
    expect(cmp.rows.find((r) => r.id === 'новый боковой')?.verdict).toBe('extraInDesign')
  })

  it('the extended diameter series reaches the trunk sizes (1600, 2000)', () => {
    const cmp = compareWithMasterPlan(
      [{ id: 'узел 1 — выпуск', designDiameterMm: 1600 }],
      [{ id: 'узел 1 — выпуск', planDiameterMm: 2000 }],
    )
    // 1600 and 2000 are distinct steps of the series, one apart.
    expect(cmp.rows[0].stepDelta).toBe(-1)
  })
})
