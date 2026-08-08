import { describe, expect, it } from 'vitest'
import type { SelectedManholeConstruction } from './manhole-catalog'
import type { GravityProfile, SewerSchedule } from './norms/gravity'
import type { TracedNetwork } from './trace'
import {
  buildWorkingDrawingSet,
  type WorkingDrawingInput,
  workingDrawingSpecificationItemCount,
} from './working-drawings'

/**
 * Purely synthetic source data used to prove that album size is derived from
 * route length and schedules. It deliberately does not reproduce any real
 * object's geometry or fixed reference-page count.
 */
function generatedLinearProject(segmentCount = 60, segmentLengthM = 250): WorkingDrawingInput {
  const nodes: TracedNetwork['nodes'] = Array.from({ length: segmentCount + 1 }, (_, index) => ({
    id: `N-${index}`,
    kind: index === segmentCount ? 'source' : 'ring',
    x: index * segmentLengthM,
    y: (index % 6) * 18 + (index % 2 === 0 ? 0 : 7),
    groundElevation: 115 - index * 0.08,
  }))
  const pipes: TracedNetwork['pipes'] = Array.from({ length: segmentCount }, (_, index) => {
    const from = nodes[index]
    const to = nodes[index + 1]
    return {
      id: `P-${index}`,
      kind: 'gravity_collector',
      fromNode: from.id,
      toNode: to.id,
      lengthM: segmentLengthM,
      alignment: [
        { x: from.x, y: from.y },
        { x: from.x + segmentLengthM / 2, y: (from.y + to.y) / 2 + (index % 3 - 1) * 4 },
        { x: to.x, y: to.y },
      ],
      dataSource: 'synthetic:generated-album-test',
    }
  })
  const totalLengthM = segmentCount * segmentLengthM
  const network: TracedNetwork = { nodes, pipes, totalLengthM }
  const profile: GravityProfile = {
    stations: nodes.map((node, index) => ({
      nodeId: node.id,
      chainageM: index * segmentLengthM,
      groundElevationM: node.groundElevation ?? 0,
      invertElevationM: 111 - index * 0.11,
      depthM: (node.groundElevation ?? 0) - (111 - index * 0.11),
      diameterMm: 1200 + Math.floor(index / 20) * 200,
    })),
    maxDepthM: 5.8,
    outletInvertElevationM: 111 - segmentCount * 0.11,
    totalLengthM,
    pipeIds: pipes.map((pipe) => pipe.id),
  }
  const schedule: SewerSchedule = {
    manholes: nodes.map((node, index) => ({
      nodeId: node.id,
      label: `MH-${index + 1}`,
      picket: `PK${Math.floor(index * segmentLengthM / 100)}+${index * segmentLengthM % 100}`,
      depthMm: Math.round(profile.stations[index].depthM * 1000),
      pipeDiameterMm: profile.stations[index].diameterMm,
    })),
    pipes: [1200, 1400, 1600].map((diameterMm, index) => ({
      designation: `Synthetic pipe DN${diameterMm}`,
      diameterMm,
      lengthM: totalLengthM / 3,
      agskCode: `SYNTHETIC-${index + 1}`,
    })),
    totalPipeLengthM: totalLengthM,
  }
  const constructions: SelectedManholeConstruction[] = [{
    manholeLabel: schedule.manholes[0].label,
    typeCode: 'SYNTHETIC-WELL',
    chamberDiameterMm: 1800,
    source: 'synthetic component catalogue',
    components: Array.from({ length: 47 }, (_, index) => ({
      name: `Synthetic component ${index + 1}`,
      unit: 'pcs',
      baseQuantity: 1,
      quantity: 1,
      catalogCode: `SYN-COMP-${index + 1}`,
    })),
  }]

  return {
    system: 'storm',
    network,
    profile,
    schedule,
    routeStatus: 'calculated',
    georeference: { kind: 'local_anchor', source: 'synthetic control network' },
    surveyPoints: nodes.map((node) => ({
      x: node.x,
      y: node.y,
      z: node.groundElevation ?? 0,
    })),
    unresolvedLayerCount: 0,
    catalogReady: true,
    hydraulicsReady: true,
    stormRunoff: {
      available: true,
      verified: true,
      source: 'synthetic verified runoff fixture',
      detail: 'generated catchments',
      blockers: [],
    },
    utilityFeatureCount: 0,
    crossings: [],
    spatialBoreholeCount: 4,
    geologyCoverage: {
      maxOffsetM: 75,
      status: 'verified',
      source: 'synthetic coverage rule',
    },
    freezingDepth: {
      valueM: 1.8,
      status: 'verified',
      source: 'synthetic engineering survey',
    },
    manholeCatalogReady: true,
    normsVerified: true,
    deliverableRequirements: {
      crossingDetailSheets: false,
      protectiveGridDetail: false,
      source: 'synthetic approved deliverable register',
      verified: true,
    },
    specificationItemCount: workingDrawingSpecificationItemCount(schedule, constructions),
    options: {
      planLengthM: 550,
      profileLengthM: 850,
      materialRowsPerSheet: 18,
      specificationRowsPerSheet: 15,
    },
  }
}

describe('dynamic full working-drawing album', () => {
  it('scales a long generated route to 40+ physical pages and includes every core sheet family', () => {
    const input = generatedLinearProject()
    const set = buildWorkingDrawingSet(input)
    const kinds = new Set(set.sheets.map((sheet) => sheet.kind))

    expect(set.summary.pdfPages).toBe(set.manifest.pdfPageCount)
    expect(set.manifest.pdfPageCount).toBe(set.manifest.pages.length)
    expect(set.manifest.pdfPageCount).toBe(set.sheets.length + set.manifest.servicePageCount)
    expect(set.manifest.pdfPageCount).toBeGreaterThanOrEqual(40)
    expect(set.manifest.generatedSheetCount).toBe(set.sheets.length)
    expect(set.sheets.filter((sheet) => sheet.kind === 'plan').length).toBeGreaterThan(1)
    expect(set.sheets.filter((sheet) => sheet.kind === 'profile').length).toBeGreaterThan(1)
    expect(kinds.has('plan')).toBe(true)
    expect(kinds.has('network_plan')).toBe(true)
    expect(kinds.has('profile')).toBe(true)
    expect(kinds.has('material_table')).toBe(true)
    expect(kinds.has('specification')).toBe(true)
    expect(set.sheets.filter((sheet) => sheet.kind === 'material_table')).toHaveLength(
      Math.ceil(input.schedule!.manholes.length / input.options!.materialRowsPerSheet!),
    )
    expect(set.sheets.filter((sheet) => sheet.kind === 'specification')).toHaveLength(
      Math.ceil(input.specificationItemCount! / input.options!.specificationRowsPerSheet!),
    )
    expect(set.summary.workingDrawingSheets).toBeGreaterThan(0)
    expect(set.summary.specificationSheets).toBeGreaterThan(0)

    const planPages = set.manifest.pages.filter((page) => page.kind === 'plan')
    const profilePages = set.manifest.pages.filter((page) => page.kind === 'profile')
    // План по высоте не растёт: у него нет вертикального масштаба, растягивать
    // нечего. У профиля высота считается по перепаду отметок в масштабе 1:100,
    // поэтому она не меньше A3 и не обязана ей равняться.
    expect(planPages.every((page) => page.pageFormat.heightMm === 297 && page.pageFormat.format === 'custom')).toBe(true)
    expect(profilePages.every((page) => page.pageFormat.heightMm >= 297 && page.pageFormat.format === 'custom')).toBe(true)
    expect(set.manifest.pages.find((page) => page.kind === 'drawing_register')?.pageFormat.format).toBe('custom')
    expect(set.manifest.pages.filter((page) =>
      page.kind === 'network_plan' || page.kind === 'material_table' || page.kind === 'specification')
      .every((page) => page.pageFormat.format === 'A3')).toBe(true)
  })

  it('keeps physical PDF and document-set numbering explicit and contiguous', () => {
    const set = buildWorkingDrawingSet(generatedLinearProject())
    const [cover, main1, main2, firstGenerated] = set.manifest.pages

    expect(set.manifest.pages.map((page) => page.pdfPageNumber)).toEqual(
      Array.from({ length: set.manifest.pages.length }, (_, index) => index + 1),
    )
    expect(cover).toMatchObject({
      pdfPageNumber: 1,
      kind: 'cover',
      documentSet: null,
      documentSetCode: null,
      sheetNumber: null,
    })
    expect(main1).toMatchObject({
      pdfPageNumber: 2,
      documentSet: 'working_drawings',
      documentSetCode: 'MAIN',
      sheetNumber: 1,
    })
    expect(main2).toMatchObject({
      pdfPageNumber: 3,
      documentSet: 'working_drawings',
      documentSetCode: 'MAIN',
      sheetNumber: 2,
    })
    expect(firstGenerated).toMatchObject({
      pdfPageNumber: 4,
      documentSet: 'working_drawings',
      documentSetCode: 'MAIN',
      sheetNumber: 3,
      sheetId: set.sheets[0].id,
    })

    const firstSpecification = set.manifest.pages.find((page) => page.documentSet === 'specification')
    expect(firstSpecification).toMatchObject({
      documentSetCode: 'SPEC',
      sheetNumber: 1,
    })
  })

  it('covers every sheet family a professional НК set is checked against', () => {
    // The acceptance gate scores composition by matching sheet titles. Keeping
    // it here means a renamed sheet breaks a unit test instead of silently
    // costing a quarter of the benchmark score.
    const input = generatedLinearProject()
    // The protective-grid sheet is issued only when the deliverable register
    // asks for it, so the register has to request it here.
    input.deliverableRequirements = {
      crossingDetailSheets: false,
      protectiveGridDetail: true,
      source: 'synthetic approved deliverable register',
      verified: true,
    }
    const branchStations = input.profile!.stations.slice(0, 6).map((station, index) => ({
      ...station,
      nodeId: `BR-${index}`,
      chainageM: index * 120,
    }))
    input.branchProfiles = [{
      id: 'existing-tie-in',
      // «Ксущ» is the drawing notation for an existing sewer run, not an object name.
      title: 'Продольный профиль на участке Ксущ1 - 111',
      source: 'synthetic existing-network model',
      verified: true,
      profile: {
        stations: branchStations,
        maxDepthM: 4.2,
        outletInvertElevationM: branchStations[branchStations.length - 1].invertElevationM,
        totalLengthM: 600,
        pipeIds: input.profile!.pipeIds.slice(0, 5),
      },
    }]

    const titles = buildWorkingDrawingSet(input).sheets.map((sheet) => sheet.title)
    const families: Array<[string, RegExp]> = [
      ['план по пикетам', /план.*пк/i],
      ['сводный план сетей', /план.*сет/i],
      ['профиль по пикетам', /профиль.*пк/i],
      ['профиль по существующей сети', /ксущ/i],
      ['ведомость колодцев', /колодц/i],
      ['защитная сетка', /сетк|решетк/i],
      ['спецификация', /специфик/i],
    ]
    for (const [family, pattern] of families) {
      expect(titles.some((title) => pattern.test(title)), family).toBe(true)
    }
  })

  it('does not force every project to match one reference album page count', () => {
    const compact = generatedLinearProject(4, 180)
    compact.specificationItemCount = 5
    compact.options = {
      planLengthM: 10_000,
      profileLengthM: 10_000,
      materialRowsPerSheet: 100,
      specificationRowsPerSheet: 100,
    }

    const set = buildWorkingDrawingSet(compact)
    expect(set.manifest.pdfPageCount).toBe(set.sheets.length + 3)
    expect(set.manifest.pdfPageCount).toBeLessThan(40)
    expect(set.manifest.pdfPageCount).not.toBe(61)
  })
})

describe('высота листа профиля считается, а не назначается', () => {
  /** Профиль с заданным перепадом отметок на всю длину. */
  const deepProfile = (spanM: number): GravityProfile => ({
    stations: [
      { nodeId: 'K-1', chainageM: 0, groundElevationM: 100, invertElevationM: 100 - spanM, depthM: spanM, diameterMm: 400 },
      { nodeId: 'K-2', chainageM: 200, groundElevationM: 100, invertElevationM: 100 - spanM, depthM: spanM, diameterMm: 400 },
    ],
    maxDepthM: spanM,
    outletInvertElevationM: 100 - spanM,
    totalLengthM: 200,
    pipeIds: ['P-1'],
  })

  const sheetHeights = (spanM: number) => {
    const set = buildWorkingDrawingSet({
      system: 'sewer',
      network: {
        nodes: [
          { id: 'K-1', kind: 'manhole', x: 0, y: 0, groundElevation: 100 },
          { id: 'K-2', kind: 'outlet', x: 200, y: 0, groundElevation: 100 },
        ],
        pipes: [{ id: 'P-1', kind: 'gravity_collector', fromNode: 'K-1', toNode: 'K-2', lengthM: 200 }],
        totalLengthM: 200,
      },
      profile: deepProfile(spanM),
      schedule: { manholes: [], pipes: [], totalPipeLengthM: 0 },
      routeStatus: 'calculated',
      catalogReady: true,
      hydraulicsReady: true,
    })
    return set.manifest.pages
      .filter((page) => set.sheets.find((sheet) => sheet.id === page.sheetId)?.kind === 'profile')
      .map((page) => page.pageFormat.heightMm)
  }

  it('мелкий профиль остаётся в высоте A3', () => {
    expect(sheetHeights(3).every((height) => height === 297)).toBe(true)
  })

  it('глубокий профиль получает более высокий лист, а не обрушивает альбом', () => {
    // 15 м перепада в масштабе 1:100 — это 150 мм чертежа плюс боковик и штамп.
    const tall = sheetHeights(15)
    expect(tall.length).toBeGreaterThan(0)
    expect(tall.every((height) => height > 297)).toBe(true)
  })

  it('высота растёт вместе с перепадом, а не скачком', () => {
    // Оба перепада выше нижней границы A3, иначе разницу съедает отсечка.
    const [shallow] = sheetHeights(12)
    const [deep] = sheetHeights(24)
    expect(deep).toBeGreaterThan(shallow)
    // Прирост соответствует масштабу 1:100: 12 м перепада — около 120 мм.
    expect(deep - shallow).toBeGreaterThanOrEqual(110)
    expect(deep - shallow).toBeLessThanOrEqual(130)
  })
})
