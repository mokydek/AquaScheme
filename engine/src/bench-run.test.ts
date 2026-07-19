import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assessLiftStationNeed } from './norms/structures'
import { buildSewerSchedule, solveGravityNetwork } from './norms/gravity'
import { buildSewerSpecification } from './norms/sewerspec'
import {
  buildManholeMaterialSheetsDxf,
  buildPlanSheetSetDxf,
  buildProfileSheetSetDxf,
  buildProtectiveGrilleSheetDxf,
  buildSewerGeneralDataDxf,
  buildSewerPlanDxf,
  buildSewerProfileDxf,
  buildSpecSheetDxf,
} from './dxf'
import type { TracedNetwork } from './trace'

/**
 * End-to-end benchmark run (docs/benchmark/SCORECARD.md): design the storm
 * trunk with the REAL benchmark parameters and export the full sheet set to
 * docs/benchmark/out/ for `npm run benchmark` to score. Confidential inputs
 * live only locally, so the test skips itself when the folder is absent.
 *
 * Geometry assumption (recorded in out/README.md): the route is generated as
 * a straight line of the real chainage (ПК157+92.89) with manholes every
 * 100 m and the surveyed elevation range (345.9 → 338.0). The real polyline
 * arrives with the DWG import once the converter service is deployed; the
 * sheet COMPOSITION scored by group 1 does not depend on the plan geometry.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const BM = join(ROOT, 'docs', 'benchmark')
const OUT = join(BM, 'out')

const TOTAL_M = 15792.89
const STEP_M = 100
// Master-plan inflows south → north (docs/benchmark/masterplan.json).
const INFLOWS: Array<{ atM: number; flowLps: number; label: string }> = [
  { atM: 0, flowLps: 611.1, label: 'ОС III-4' },
  { atM: 3000, flowLps: 531, label: 'ОС III-8' },
  { atM: 8000, flowLps: 1154.7, label: 'ОС II-1' },
  { atM: 15000, flowLps: 200, label: 'ОС III-6' },
]

function buildBenchmarkNetwork(): { network: TracedNetwork; flows: Map<string, number> } {
  const nodes: TracedNetwork['nodes'] = []
  const pipes: TracedNetwork['pipes'] = []
  const stations: number[] = []
  for (let m = 0; m <= TOTAL_M; m += STEP_M) stations.push(m)
  if (stations[stations.length - 1] < TOTAL_M) stations.push(TOTAL_M)

  const elevationAt = (m: number) => 345.9 - (m / TOTAL_M) * (345.9 - 338.0)
  stations.forEach((m, i) => {
    const isOutlet = i === stations.length - 1
    nodes.push({
      id: `M${i}`,
      kind: isOutlet ? 'source' : 'junction',
      x: 0,
      y: m,
      groundElevation: elevationAt(m),
    })
    if (i > 0) {
      pipes.push({ id: `P${i}`, kind: 'main', fromNode: `M${i - 1}`, toNode: `M${i}`, lengthM: m - stations[i - 1] })
    }
  })

  const flows = new Map<string, number>()
  INFLOWS.forEach((inflow, k) => {
    const nearest = Math.round(inflow.atM / STEP_M)
    const id = `OS${k}`
    nodes.push({ id, kind: 'building', x: 50, y: nearest * STEP_M, groundElevation: elevationAt(nearest * STEP_M), buildingId: id })
    pipes.push({ id: `S${k}`, kind: 'service', fromNode: id, toNode: `M${nearest}`, lengthM: 50 })
    flows.set(id, inflow.flowLps)
  })

  const totalLengthM = pipes.reduce((s, p) => s + p.lengthM, 0)
  return { network: { nodes, pipes, totalLengthM }, flows }
}

describe.skipIf(!existsSync(BM))('benchmark end-to-end run (composition)', () => {
  it('designs the trunk and writes the full sheet set to docs/benchmark/out', () => {
    const { network, flows } = buildBenchmarkNetwork()
    const result = solveGravityNetwork({
      network,
      buildingFlowLps: flows,
      system: 'storm',
      freezingDepthM: 2.2,
    })
    expect(result.profile).not.toBeNull()
    const profile = result.profile!
    expect(result.outletFlowLps).toBeCloseTo(2496.8, 0)

    const schedule = buildSewerSchedule(result)
    const spec = buildSewerSpecification({
      schedule,
      liftStation: assessLiftStationNeed(profile.stations.map((s) => s.depthM)).needed.value,
      highGroundwater: true, // УГВ 0.5-5.6 м по отчёту ИГИ — выше глубины выемки
    })

    const projectName = 'Водосбросной коллектор (бенчмарк)'
    const nodeById = new Map(network.nodes.map((n) => [n.id, n]))
    const mainPath = profile.stations
      .map((s) => nodeById.get(s.nodeId))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .map((n) => ({ x: n.x, y: n.y }))
    const pipeDiameterMm = new Map(result.pipes.map((p) => [p.id, p.diameterMm]))

    mkdirSync(OUT, { recursive: true })
    const write = (name: string, content: string | Uint8Array) => writeFileSync(join(OUT, name), content)

    write('01_общие_данные.dxf', buildSewerGeneralDataDxf({
      projectName,
      schedule,
      outletFlowLps: result.outletFlowLps,
      maxDepthM: profile.maxDepthM,
    }))
    write('02_план_сетей_К2_сводный.dxf', buildSewerPlanDxf({ projectName, network, pipeDiameterMm, sheetTitle: 'План сетей К2' }))
    write('03_профиль_К2_сводный.dxf', buildSewerProfileDxf({ projectName, profile }))
    write('04_спецификация_НК.dxf', buildSpecSheetDxf({ projectName }, spec))

    const planSheets = buildPlanSheetSetDxf({ projectName, network, pipeDiameterMm, mainPath, system: 'storm' })
    const profileSheets = buildProfileSheetSetDxf(projectName, profile, 'storm')
    const manholeSheets = buildManholeMaterialSheetsDxf(projectName, schedule)
    let no = 5
    for (const sheet of [...planSheets, ...profileSheets, ...manholeSheets]) {
      write(`${String(no).padStart(2, '0')}_${sheet.title.replace(/\.\s*М1:500$/, '').replace(/[\s.()]+/g, '_')}.dxf`, sheet.dxf)
      no++
    }
    write(`${String(no).padStart(2, '0')}_защитная_сетка_для_колодцев.dxf`, buildProtectiveGrilleSheetDxf(projectName, schedule.manholes.length))

    write('README.md', [
      '# Прогон бенчмарка (генерируется bench-run.test.ts)',
      '',
      `Листов: ${4 + planSheets.length + profileSheets.length}; планов ${planSheets.length}, профилей ${profileSheets.length}.`,
      `Расход на выпуске: ${result.outletFlowLps.toFixed(1)} л/с (сумма ОС по схеме генплана; показатель эталона 2335.8 л/с — расхождение в GAP.md).`,
      '',
      'Допущение: трасса синтетическая прямая реального пикетажа (ПК157+92.89) с колодцами через 100 м и съёмочным диапазоном отметок 345.9-338.0;',
      'реальная полилиния придёт с DWG-импортом после деплоя конвертера. Состав комплекта (группа 1 SCORECARD) от геометрии плана не зависит.',
    ].join('\n'))

    // The set must reach the etalon's scale: ~28 plans + ~19 profiles.
    expect(planSheets.length).toBeGreaterThanOrEqual(20)
    expect(profileSheets.length).toBeGreaterThanOrEqual(15)
  }, 240000)
})
