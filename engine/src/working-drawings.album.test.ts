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
    expect(planPages.every((page) => page.pageFormat.heightMm === 297 && page.pageFormat.format === 'custom')).toBe(true)
    expect(profilePages.every((page) => page.pageFormat.heightMm === 297 && page.pageFormat.format === 'custom')).toBe(true)
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
