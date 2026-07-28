import { describe, expect, it } from 'vitest'
import { createDemoDataset } from './demo'
import { computeNetworkDemand } from './demand'
import { placeFittings, selectMaterials } from './equipment'
import { NORMATIVE_DEFAULTS } from './norms'
import { sizeNetwork } from './sizing'
import { traceNetwork } from './trace'
import {
  buildGeneralDataDxf,
  buildManholeMaterialSheetsDxf,
  buildNetworkDxf,
  buildPlanSheetSetDxf,
  buildProtectiveGridDetailDxf,
  buildProfileSheetSetDxf,
  buildSewerGeneralDataDxf,
  buildSewerPlanDxf,
  buildSewerProfileDxf,
  buildSituationDxf,
  buildSpecSheetDxf,
} from './dxf'
import { buildSewerSchedule, solveGravityNetwork } from './norms/gravity'
import type { GravityProfile } from './norms/gravity'
import type { TracedNetwork } from './trace'
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

describe('picket profile sheet set (benchmark G-1)', () => {
  it('cuts the profile into named К2 sheets, each a valid DXF', () => {
    const stations = Array.from({ length: 17 }, (_, i) => i * 100)
    const profile: GravityProfile = {
      stations: stations.map((c, i) => ({
        nodeId: `K${i}`,
        chainageM: c,
        groundElevationM: 350 - c * 0.001,
        invertElevationM: 348 - c * 0.002,
        depthM: 2 + c * 0.001,
        diameterMm: 2000,
      })),
      maxDepthM: 3.6,
      outletInvertElevationM: 348,
      totalLengthM: 1600,
      pipeIds: stations.slice(1).map((_, index) => `P${index}`),
    }
    const sheets = buildProfileSheetSetDxf('Тестовый коллектор', profile, 'storm', 850, [{
      id: 'X-1',
      stationM: 1200,
      kind: 'существующая сеть',
      existingElevationM: 349,
      designInvertElevationM: 346.2,
      clearanceM: 1.8,
      approved: true,
    }])
    expect(sheets.length).toBeGreaterThan(1)
    expect(sheets[0].title).toMatch(/^Профиль К2 ПК0 - ПК\d/)
    for (const sheet of sheets) {
      expect(sheet.dxf).toContain(sheet.title)
      expect(sheet.dxf.trimEnd().endsWith('EOF')).toBe(true)
      const xCoordinates = [...sheet.dxf.matchAll(/\r?\n10\r?\n(-?\d+(?:\.\d+)?)/g)]
        .map((match) => Number(match[1]))
      expect(Math.max(...xCoordinates)).toBeLessThanOrEqual(430)
    }
    expect(sheets[0].dxf).not.toContain('X-1')
    expect(sheets[1].dxf).toContain('X-1')
    expect(sheets[1].dxf).toContain('просвет 1.80 м')
  }, 60000)
})

describe('picket plan sheet set (benchmark G-1)', () => {
  it('windows the network into named plan sheets containing only nearby nodes', () => {
    // Straight main 0..1600 m with manholes every 100 m and one far building.
    const nodes = [
      ...Array.from({ length: 17 }, (_, i) => ({
        id: `K${i}`,
        kind: (i === 16 ? 'source' : 'junction') as 'source' | 'junction',
        x: i * 100,
        y: 0,
        groundElevation: 350,
      })),
      { id: 'FAR', kind: 'building' as const, x: 1590, y: 20, groundElevation: 350, buildingId: 'b-far' },
    ]
    const pipes = Array.from({ length: 16 }, (_, i) => ({
      id: `P${i}`,
      kind: 'main' as const,
      fromNode: `K${i}`,
      toNode: `K${i + 1}`,
      lengthM: 100,
    }))
    const sheets = buildPlanSheetSetDxf({
      projectName: 'Тестовый коллектор',
      network: { nodes, pipes, totalLengthM: 1600 },
      pipeDiameterMm: new Map(pipes.map((p) => [p.id, 2000])),
      mainPath: nodes.slice(0, 17).map((n) => ({ x: n.x, y: n.y })),
      buildingLabels: new Map([['b-far', 'Здание-Х']]),
      system: 'storm',
      targetPerSheetM: 550,
    })
    expect(sheets.length).toBeGreaterThanOrEqual(3)
    expect(sheets[0].title).toMatch(/^План К2 ПК0 - ПК\d.*М1:500$/)
    // The far building sits at the tail: present on the last sheet, absent on the first.
    expect(sheets[0].dxf).not.toContain('Здание-Х')
    expect(sheets[sheets.length - 1].dxf).toContain('Здание-Х')
    for (const sheet of sheets) {
      expect(sheet.dxf).toContain(sheet.title)
      expect(sheet.dxf.trimEnd().endsWith('EOF')).toBe(true)
    }
  }, 60000)

  it('keeps a long curved pipe visible on intermediate windows and clips it to every sheet', () => {
    const nodes = [
      { id: 'A', kind: 'junction' as const, x: 0, y: 0, groundElevation: 100 },
      { id: 'B', kind: 'source' as const, x: 1200, y: 0, groundElevation: 98 },
    ]
    const alignment = [
      { x: 0, y: 0 }, { x: 300, y: 80 }, { x: 600, y: -60 }, { x: 900, y: 70 }, { x: 1200, y: 0 },
    ]
    const pipe = { id: 'AB', kind: 'gravity_collector' as const, fromNode: 'A', toNode: 'B', lengthM: 1260, alignment }
    const sheets = buildPlanSheetSetDxf({
      projectName: 'Synthetic collector',
      network: { nodes, pipes: [pipe], totalLengthM: pipe.lengthM },
      pipeDiameterMm: new Map([['AB', 1200]]),
      mainPath: alignment,
      system: 'storm',
      targetPerSheetM: 400,
      marginM: 20,
    })
    expect(sheets.length).toBeGreaterThan(2)
    for (const sheet of sheets) {
      expect(sheet.dxf).toContain('Ø1200')
      expect(sheet.dxf).toContain('L1260.0')
      expect(sheet.dxf.trimEnd().endsWith('EOF')).toBe(true)
    }
  })
})

describe('unified situation geometry', () => {
  it('draws every segment of the saved alignment instead of an endpoint chord', () => {
    const nodes = [
      { id: 'A', kind: 'junction' as const, x: 0, y: 0, groundElevation: 100 },
      { id: 'B', kind: 'source' as const, x: 100, y: 0, groundElevation: 99 },
    ]
    const basePipe = { id: 'AB', kind: 'gravity_collector' as const, fromNode: 'A', toNode: 'B', lengthM: 140 }
    const make = (alignment?: Array<{ x: number; y: number }>) => buildSituationDxf({
      projectName: 'Synthetic collector',
      systemType: 'storm',
      network: { nodes, pipes: [{ ...basePipe, alignment }], totalLengthM: 140 },
      pipeDiameterMm: new Map([['AB', 800]]),
    })
    const chordLines = make().match(/\r?\nLINE\r?\n/g)?.length ?? 0
    const alignmentLines = make([{ x: 0, y: 0 }, { x: 40, y: 30 }, { x: 70, y: -20 }, { x: 100, y: 0 }])
      .match(/\r?\nLINE\r?\n/g)?.length ?? 0
    expect(alignmentLines).toBe(chordLines + 6)
  })
})

describe('general data and specification sheets (update 3, O1)', () => {
  it('builds the general data sheet with drawings list, documents, legend and notes', async () => {
    const input = await demoExportInput()
    const dxf = buildGeneralDataDxf(input)
    expect(dxf).toContain('Общие данные')
    expect(dxf).toContain('Ведомость рабочих чертежей')
    expect(dxf).toContain('Условные обозначения')
    expect(dxf).toContain('Общие указания')
    expect(dxf).toContain('СП РК 4.01-101-2012') // referenced documents
    expect(dxf).toContain('требует проверки') // unverified marked
    expect(dxf).toContain('Основная надпись · реквизиты проекта')
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true)
  }, 60000)

  it('builds the specification sheet per GOST 21.110 form', async () => {
    const input = await demoExportInput()
    const dxf = buildSpecSheetDxf(input)
    expect(dxf).toContain('Спецификация оборудования, изделий и материалов')
    expect(dxf).toContain('ГОСТ 21.110')
    expect(dxf).toContain('Труба напорная')
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true)
  }, 60000)
})

describe('specification', () => {
  it('lists pipes by diameter and fittings by count', async () => {
    const input = await demoExportInput()
    const items = buildSpecification(input)

    const pipeItems = items.filter((i) => i.name.includes('Труба'))
    expect(pipeItems.length).toBeGreaterThan(0)
    expect(pipeItems.every((i) => i.unit === 'м' && i.quantity > 0)).toBe(true)
    // АГСК-3: «Код продукции» filled with the catalogue section (241-2 for ПЭ).
    expect(pipeItems.every((i) => i.code === '241-2')).toBe(true)
    expect(items.find((i) => i.name.includes('Гидрант'))?.code).toBe('244-4')

    const hydrant = items.find((i) => i.name.includes('Гидрант'))
    expect(hydrant?.quantity).toBe(input.fittings.counts.hydrants)

    const wells = items.find((i) => i.name.includes('Колодец'))
    expect(wells?.quantity).toBe(input.fittings.counts.wells)

    const csv = specificationToCsv(items)
    expect(csv.charCodeAt(0)).toBe(0xfeff) // BOM
    // НБ3: header columns per ГОСТ 21.110 form 1.
    expect(csv).toContain('Наименование и техническая характеристика')
    expect(csv).toContain('Код продукции')
    expect(csv.split('\r\n').length).toBeGreaterThan(items.length)
  }, 60000)
})

describe('sewer K1 longitudinal profile DXF (form 2)', () => {
  it('exports the saved design alignment instead of an endpoint chord', () => {
    const network: TracedNetwork = {
      nodes: [
        { id: 'S', kind: 'source', x: 0, y: 0, groundElevation: 100 },
        { id: 'J', kind: 'junction', x: 100, y: 0, groundElevation: 99 },
      ],
      pipes: [{
        id: 'p1',
        kind: 'main',
        fromNode: 'S',
        toNode: 'J',
        lengthM: 128,
        alignment: [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }],
      }],
      totalLengthM: 128,
    }
    const plan = buildSewerPlanDxf({ projectName: 'Тест', network, pipeDiameterMm: new Map([['p1', 800]]) })
    // One LWPOLYLINE with all three saved alignment vertices. A two-point
    // chord would contain group 90 = 2 instead.
    expect(plan).toMatch(/90\r?\n3\r?\n/)
    expect(plan).toMatch(/10\r?\n50\r?\n20\r?\n40\r?\n/)
  })

  it('draws the GOST 21.704 form 2 side table from the computed profile', () => {
    const network: TracedNetwork = {
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
    const gravity = solveGravityNetwork({
      network,
      buildingFlowLps: new Map([['b1', 6]]),
      system: 'sewer',
      freezingDepthM: 1.5,
    })
    const dxf = buildSewerProfileDxf({ projectName: 'Тест К1', profile: gravity.profile! })
    // Full GOST 21.704 form 2 side table (aligned to professional practice).
    expect(dxf).toContain('Проектная отметка лотка, м')
    expect(dxf).toContain('Натурная отметка земли, м')
    expect(dxf).toContain('Обозначение трубы')
    expect(dxf).toContain('Основание и тип изоляции')
    expect(dxf).toContain('Уклон, ‰; длина, м') // slope in permille
    expect(dxf).toContain('безн.') // gravity (безнапорная) designation
    expect(dxf).toContain('ПК') // picket notation
    expect(dxf).toContain('Масштаб: гор. 1:500, верт. 1:100')
    expect(dxf).toContain('Вып.')
    expect(dxf).toContain('SECTION')

    const plan = buildSewerPlanDxf({
      projectName: 'Тест К1',
      network,
      pipeDiameterMm: new Map(gravity.pipes.map((p) => [p.id, p.diameterMm])),
      buildingLabels: new Map([['b1', 'Д1']]),
    })
    expect(plan).toContain('Сеть К1. План')
    expect(plan).toContain('ВК-1')
    expect(plan).toContain('Вып.')
    expect(plan).toContain('SECTION')

    const situation = buildSituationDxf({
      projectName: 'Тест К1',
      systemType: 'sewer',
      network,
      buildings: [{ x: 200, y: 0, label: 'Д1' }],
      pipeDiameterMm: new Map(gravity.pipes.map((p) => [p.id, p.diameterMm])),
    })
    expect(situation).toContain('Ситуационная схема')
    expect(situation).toContain('Без масштаба')
    expect(situation).toContain('Выпуск')
    // Генплановская manner: legend block on the sheet.
    expect(situation).toContain('Условные обозначения')
    expect(situation).toContain('коридор сетей (проектируемая трасса)')
    expect(situation).toContain('SECTION')

    // The К1 general data sheet mirrors the album's sheet 2: drawing list,
    // network indicators and the supervision acts list per СП РК 4.01-103.
    const general = buildSewerGeneralDataDxf({
      projectName: 'Тест К1',
      schedule: buildSewerSchedule(gravity),
      outletFlowLps: gravity.outletFlowLps,
      maxDepthM: gravity.profile!.maxDepthM,
    })
    expect(general).toContain('Общие данные (К1)')
    expect(general).toContain('Ведомость рабочих чертежей')
    expect(general).toContain('Основные показатели сети К1')
    expect(general).toContain('актов освидетельствования')
    expect(general).toContain('гидравлического испытания безнапорного трубопровода')
    expect(general).toContain('СН РК 4.01-03-2013')
  })
})

describe('parameter-driven manhole DXF sheets', () => {
  it('uses selected catalog components and never inserts an unspecified typical design', () => {
    const sheets = buildManholeMaterialSheetsDxf('Synthetic project', {
      manholes: [{ label: 'К-1', picket: 'ПК1', depthMm: 2400, pipeDiameterMm: 500 }],
      pipes: [],
      totalPipeLengthM: 0,
    }, [{
      manholeLabel: 'К-1',
      typeCode: 'TEST-WELL',
      chamberDiameterMm: 1500,
      source: 'Synthetic catalog sheet',
      components: [{ name: 'Кольцо', unit: 'шт', baseQuantity: 1, quantity: 3, catalogCode: 'RING' }],
    }])
    expect(sheets).toHaveLength(1)
    expect(sheets[0].dxf).toContain('TEST-WELL')
    expect(sheets[0].dxf).toContain('Кольцо 3 шт')
    expect(sheets[0].dxf).not.toContain('уточняется')
  })

  it('draws a protective grid only from the confirmed product dimensions', () => {
    const dxf = buildProtectiveGridDetailDxf('Synthetic project', {
      quantity: 2,
      overallWidthMm: 900,
      overallHeightMm: 700,
      barSpacingMm: 100,
      frameProfile: 'angle profile 50x5',
      barProfile: 'round bar 12',
      material: 'structural steel',
      coating: 'approved coating system',
      fixing: 'four anchored hinges',
      source: 'approved product card PG-01',
      verified: true,
    })
    expect(dxf).toContain('900×700')
    expect(dxf).toContain('шаг стержней: 100')
    expect(dxf).toContain('angle profile 50x5')
    expect(dxf).toContain('approved product card PG-01')
    expect(dxf).not.toContain('Размеры по месту')
  })

  it('rejects an unverified protective-grid product card', () => {
    expect(() => buildProtectiveGridDetailDxf('Synthetic project', {
      quantity: 1,
      overallWidthMm: 900,
      overallHeightMm: 700,
      barSpacingMm: 100,
      frameProfile: 'frame',
      barProfile: 'bar',
      material: 'steel',
      coating: 'coating',
      fixing: 'fixing',
      source: 'draft card',
      verified: false,
    })).toThrow('не подтверждена')
  })
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
    // НБ3: water-protection / sanitary / ecology section from the RK codes.
    expect(json).toContain('9. Водоохранные, санитарные и экологические требования')
    expect(json).toContain('Водоохранные зоны')
    expect(json).toContain('10. Перечень использованных нормативных документов')
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
