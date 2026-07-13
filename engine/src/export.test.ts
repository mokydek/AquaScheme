import { describe, expect, it } from 'vitest'
import { createDemoDataset } from './demo'
import { computeNetworkDemand } from './demand'
import { placeFittings, selectMaterials } from './equipment'
import { NORMATIVE_DEFAULTS } from './norms'
import { sizeNetwork } from './sizing'
import { traceNetwork } from './trace'
import { buildNetworkDxf } from './dxf'
import { buildSpecification, specificationToCsv } from './specification'
import { buildNoteDoc } from './note'
import type { ExportInput } from './exportdata'

async function demoExportInput(): Promise<ExportInput> {
  const demo = createDemoDataset()
  const buildings = demo.buildings.map((b, i) => ({
    id: `bld-${i}`,
    label: b.label,
    x: b.x,
    y: b.y,
    floors: b.floors,
    residents: b.residents,
  }))
  const network = traceNetwork(
    buildings.map((b) => ({ id: b.id, x: b.x, y: b.y })),
    demo.source,
    demo.surveyPoints,
  )
  const sizing = await sizeNetwork({
    network,
    buildings: buildings.map((b) => ({ id: b.id, floors: b.floors, residents: b.residents })),
    availableHeadM: demo.source.availableHead,
  })
  const demand = computeNetworkDemand(buildings.map((b) => ({ id: b.id, residents: b.residents })))
  const maxPressure = Math.max(
    ...sizing.nodes.filter((n) => n.kind !== 'source').map((n) => n.pressureM),
  )
  const material = selectMaterials({
    geology: demo.geology,
    seismicity: demo.seismicity,
    maxPressureM: maxPressure,
  })
  const fittings = placeFittings(network)
  return {
    projectName: 'Демо микрорайон',
    dateIso: '2026-07-11',
    source: {
      x: demo.source.x,
      y: demo.source.y,
      groundElevation: demo.source.groundElevation,
      availableHead: demo.source.availableHead,
    },
    buildings,
    network,
    sizing,
    demand,
    material,
    fittings,
    norms: NORMATIVE_DEFAULTS,
    geology: demo.geology,
    seismicity: demo.seismicity,
    surveyPoints: demo.surveyPoints,
    region: { name: 'г. Астана', source: 'auto' },
    boreholes: [
      {
        label: 'С-1', x: demo.source.x, y: demo.source.y, mouthElevationM: 100,
        layers: [
          { igeCode: '1', soilName: 'суглинок', topDepthM: 0, bottomDepthM: 2.5 },
          { igeCode: '2', soilName: 'песок', topDepthM: 2.5, bottomDepthM: 6 },
        ],
        water: { depthM: 1.5, aggressivenessSteel: 'high' as const },
      },
      {
        label: 'С-2', x: demo.source.x + 100, y: demo.source.y + 100, mouthElevationM: 101,
        layers: [{ igeCode: '1', soilName: 'глина', topDepthM: 0, bottomDepthM: 5 }],
        water: { depthM: 4 },
      },
    ],
    geologyAttributes: { subsidenceType: 'I' as const, heaving: true },
  }
}

describe('DXF export', () => {
  it('produces a valid DXF with GOST layers and network entities', async () => {
    const input = await demoExportInput()
    const dxf = buildNetworkDxf(input)

    expect(dxf).toContain('SECTION')
    expect(dxf).toContain('ENTITIES')
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true)
    expect(dxf).toContain('В1-сеть')
    expect(dxf).toContain('В1-колодцы')
    expect(dxf).toContain('В1-здания')
    expect(dxf).toContain('LWPOLYLINE') // profile lines
    expect(dxf).toContain('CIRCLE') // wells
    expect(dxf).toContain('ВОС')
    expect(dxf).toContain('Продольный профиль магистрали В1')
    // Requirements update 3 (G3): geology cross-section on the profile.
    expect(dxf).toContain('В1-геология')
    expect(dxf).toContain('УГВ')
    expect(dxf).toContain('С-1')
  }, 60000)
})

describe('specification', () => {
  it('lists pipes by diameter and fittings by count', async () => {
    const input = await demoExportInput()
    const items = buildSpecification(input)

    const pipeItems = items.filter((i) => i.name.includes('Труба'))
    expect(pipeItems.length).toBeGreaterThan(0)
    expect(pipeItems.every((i) => i.unit === 'м' && i.quantity > 0)).toBe(true)

    const hydrant = items.find((i) => i.name.includes('Гидрант'))
    expect(hydrant?.quantity).toBe(input.fittings.counts.hydrants)

    const wells = items.find((i) => i.name.includes('Колодец'))
    expect(wells?.quantity).toBe(input.fittings.counts.wells)

    const csv = specificationToCsv(items)
    expect(csv.charCodeAt(0)).toBe(0xfeff) // BOM
    expect(csv).toContain('Наименование')
    expect(csv.split('\r\n').length).toBeGreaterThan(items.length)
  }, 60000)
})

describe('explanatory note', () => {
  it('builds a document definition with all sections', async () => {
    const input = await demoExportInput()
    const doc = buildNoteDoc(input)
    const json = JSON.stringify(doc)

    expect(json).toContain('Пояснительная записка')
    expect(json).toContain('1. Исходные данные')
    expect(json).toContain('4. Гидравлический расчёт по участкам')
    expect(json).toContain('Проверка свободных напоров')
    expect(json).toContain('СП РК 4.01-101-2012')
    // Requirements update 2: normative basis in decision sections and a list
    // of documents, with unverified clauses marked.
    expect(json).toContain('Нормативное обоснование')
    expect(json).toContain('Перечень использованных нормативных документов')
    expect(json).toContain('требует проверки')
    expect(json).toContain('норматив выбор не регламентирует')
    // Requirements update 3: regional risks section.
    expect(json).toContain('8. Учёт региональных рисков и ЧС')
    expect(json).toContain('Регион: г. Астана (определён по координатам площадки)')
    expect(json).toContain('9. Перечень использованных нормативных документов')
    // Requirements update 3 (G3): geology along the route.
    expect(json).toContain('Геологический разрез по трассе')
    expect(json).toContain('Влияние геологии вдоль трассы')
    expect(Array.isArray((doc as { content: unknown[] }).content)).toBe(true)
  }, 60000)

  it('warns about slopes and lists flood measures when hazards are declared', async () => {
    const input = await demoExportInput()
    input.seismicity = { ...input.seismicity, floodProne: true, hazards: ['mudflow'] }
    const json = JSON.stringify(buildNoteDoc(input))
    expect(json).toContain('герметичными')
    expect(json).toContain('обратные клапаны')
    expect(json).toContain('выше расчётного горизонта воды')
    expect(json).toContain('специальные инженерные мероприятия')
    expect(json).toContain('сель')
  }, 60000)
})
