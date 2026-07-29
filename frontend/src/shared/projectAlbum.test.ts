import { describe, expect, it } from 'vitest'
import { buildWorkingDrawingSet, workingDrawingSpecificationItemCount } from '@aquascheme/engine'
import type { GravityProfile, SelectedManholeConstruction, SewerSchedule, TracedNetwork } from '@aquascheme/engine'
import { generateProjectAlbumPdf, generateWorkingDrawingSetDxfs, generateWorkingDrawingSheetDxf } from './exporters'
import {
  buildProjectAlbumDoc,
  buildProjectSheetDoc,
  crossingBelongsToProfile,
  localAxisCoordinates,
  scaleMillimetresPerMetre,
} from './projectAlbum'

const network: TracedNetwork = {
  nodes: [
    { id: 'A', kind: 'ring', x: 0, y: 0, groundElevation: 100 },
    { id: 'B', kind: 'source', x: 650, y: 100, groundElevation: 98 },
  ],
  pipes: [{
    id: 'AB', kind: 'gravity_collector', fromNode: 'A', toNode: 'B', lengthM: 670,
    alignment: [{ x: 0, y: 0 }, { x: 220, y: 80 }, { x: 470, y: 40 }, { x: 650, y: 100 }],
  }],
  totalLengthM: 670,
}

const profile: GravityProfile = {
  stations: [
    { nodeId: 'A', chainageM: 0, groundElevationM: 100, invertElevationM: 97, depthM: 3, diameterMm: 800 },
    { nodeId: 'B', chainageM: 670, groundElevationM: 98, invertElevationM: 95, depthM: 3, diameterMm: 1000 },
  ],
  maxDepthM: 3,
  outletInvertElevationM: 95,
  totalLengthM: 670,
  pipeIds: ['AB'],
}

const schedule: SewerSchedule = {
  manholes: [
    { nodeId: 'A', label: 'К-1', picket: 'ПК0', depthMm: 3000, pipeDiameterMm: 800 },
    { nodeId: 'B', label: 'К-2', picket: 'ПК6+70', depthMm: 3000, pipeDiameterMm: 1000 },
  ],
  pipes: [{ designation: 'Труба', diameterMm: 800, lengthM: 670, agskCode: 'catalog-item' }],
  totalPipeLengthM: 670,
}

const surveyPoints = [{ x: 0, y: 0, z: 100 }, { x: 325, y: 50, z: 99 }, { x: 650, y: 100, z: 98 }]
const manholeConstructions: SelectedManholeConstruction[] = [{
  manholeLabel: 'К-1',
  typeCode: 'TEST-K-1',
  chamberDiameterMm: 1500,
  source: 'Тестовый катал, лист 1',
  components: [{ name: 'Кольцо', unit: 'шт', baseQuantity: 1, quantity: 3 }],
}]

function drawingSet(routeStatus: 'calculated' | 'blocked' = 'calculated') {
  return buildWorkingDrawingSet({
    system: 'storm', network, profile, schedule, routeStatus,
    georeference: { kind: 'local_anchor', source: 'control points' },
    surveyPoints,
    unresolvedLayerCount: 0,
    catalogReady: true,
    catalogFingerprint: ['800', '1000'],
    hydraulicsReady: true,
    stormRunoff: { available: true, verified: true, source: 'synthetic catchment calculation', detail: '1 catchment' },
    freezingDepth: { valueM: 1.8, status: 'verified', source: 'synthetic verified fixture' },
    utilityFeatureCount: 0,
    deliverableRequirements: {
      crossingDetailSheets: false,
      protectiveGridDetail: false,
      source: 'synthetic approved deliverable register',
      verified: true,
    },
    spatialBoreholeCount: 1,
    geologyCoverage: { maxOffsetM: 100, status: 'verified', source: 'synthetic verified corridor' },
    geologyFingerprint: [{ x: 300, y: 50 }],
    manholeCatalogReady: true,
    specificationItemCount: workingDrawingSpecificationItemCount(schedule, manholeConstructions),
    normsVerified: true,
  })
}

describe('project working-drawing album', () => {
  it('keeps plan/profile model distances at their physical paper scales', () => {
    expect(scaleMillimetresPerMetre(500)).toBe(2)
    expect(scaleMillimetresPerMetre(100)).toBe(10)
    const local = localAxisCoordinates({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 3, y: 4 })
    expect(local.x).toBeCloseTo(5, 9)
    expect(local.y).toBeCloseTo(0, 9)

    const set = drawingSet()
    const input = {
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm' as const, network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    }
    const svgFor = (sheetId: string) => {
      const doc = buildProjectSheetDoc(input, sheetId) as {
        content: Array<{ stack: Array<{ svg?: string }> }>
      }
      const svg = doc.content[0].stack.find((node) => typeof node.svg === 'string')?.svg
      expect(svg).toBeTruthy()
      return svg!
    }
    const parsePoints = (svg: string, marker: string) => {
      const points = svg.match(new RegExp(`${marker}="true" points="([^"]+)"`))?.[1]
      expect(points).toBeTruthy()
      return points!.trim().split(/\s+/).map((pair) => pair.split(',').map(Number))
    }
    const unitsPerMm = (svg: string) => Number(svg.match(/data-svg-units-per-mm="([^"]+)"/)?.[1])

    const planSheet = set.sheets.find((sheet) => sheet.kind === 'plan')!
    const planSvg = svgFor(planSheet.id)
    expect(planSvg).toContain('data-horizontal-scale-denominator="500"')
    const planPoints = parsePoints(planSvg, 'data-plan-route')
    const planPaperDistanceMm = Math.hypot(
      planPoints.at(-1)![0] - planPoints[0][0],
      planPoints.at(-1)![1] - planPoints[0][1],
    ) / unitsPerMm(planSvg)
    expect(planPaperDistanceMm).toBeCloseTo(Math.hypot(650, 100) * 2, 1)

    const profileSheet = set.sheets.find((sheet) => sheet.kind === 'profile')!
    const profileSvg = svgFor(profileSheet.id)
    expect(profileSvg).toContain('data-horizontal-mm-per-meter="2"')
    expect(profileSvg).toContain('data-vertical-mm-per-meter="10"')
    const profilePoints = parsePoints(profileSvg, 'data-profile-invert')
    expect((profilePoints.at(-1)![0] - profilePoints[0][0]) / unitsPerMm(profileSvg)).toBeCloseTo(670 * 2, 1)
    expect((profilePoints.at(-1)![1] - profilePoints[0][1]) / unitsPerMm(profileSvg)).toBeCloseTo((97 - 95) * 10, 1)

    expect(set.manifest.pages.find((page) => page.sheetId === planSheet.id)?.pageFormat.widthMm).toBe(1560)
    expect(set.manifest.pages.find((page) => page.sheetId === profileSheet.id)?.pageFormat.widthMm).toBe(1640)
  })

  it('assigns tagged crossings to only their owning profile', () => {
    const legacy = { id: 'LEGACY', stationM: 10, kind: 'utility' }
    expect(crossingBelongsToProfile(legacy, undefined, ['MAIN'])).toBe(true)
    expect(crossingBelongsToProfile(legacy, 'spur', ['BRANCH'])).toBe(false)
    expect(crossingBelongsToProfile({ ...legacy, profileId: 'spur' }, 'spur', ['BRANCH'])).toBe(true)
    expect(crossingBelongsToProfile({ ...legacy, profileId: 'main' }, undefined, ['MAIN'])).toBe(true)
    expect(crossingBelongsToProfile({ ...legacy, pipeId: 'BRANCH' }, 'spur', ['BRANCH'])).toBe(true)
    expect(crossingBelongsToProfile({ ...legacy, profileId: 'other', pipeId: 'BRANCH' }, 'spur', ['BRANCH'])).toBe(false)
  })

  it('uses the dynamic register without embedding reference-album content', () => {
    const set = drawingSet()
    const doc = buildProjectAlbumDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
      constraints: {
        corridorRings: [],
        cadContextLines: [{ layer: 'GENPLAN', points: [{ x: 50, y: 15 }, { x: 600, y: 85 }] }],
        terrainLines: [{ layer: 'RELIEF', points: [{ x: 80, y: 5 }, { x: 560, y: 75 }] }],
        cadTextEntities: [{ x: 300, y: 50, text: 'CAD-CONTEXT-LABEL', layer: 'TEXT' }],
        cadBlockEntities: [{ x: 400, y: 55, name: 'CAD-BLOCK', layer: 'BLOCKS' }],
        crossings: [{
        id: 'X-1', stationM: 300, kind: 'utility', owner: 'Synthetic owner', size: '100 mm', source: 'Synthetic survey',
        existingElevationM: 98.4, designInvertElevationM: 96.1, clearanceM: 1.8, requiredClearanceM: 1,
        method: 'open cut', approved: true,
      }],
      },
      boreholes: [{
        label: 'BH-1', x: 300, y: 50, mouthElevationM: 99,
        layers: [{ igeCode: 'G1', topDepthM: 0, bottomDepthM: 4 }], water: { depthM: 2.5 },
      }],
      geologyMaxOffsetM: 100,
    }) as { content: unknown[]; info: { subject: string } }
    expect(doc.content).toHaveLength(set.sheets.length + 3)
    expect(doc.info.subject).toContain(`${set.sheets.length + 3} листов`)
    const serialized = JSON.stringify(doc.content)
    expect(serialized).not.toContain('R01')
    expect(serialized).not.toContain('фиктив')
    expect(serialized).toContain('2.99‰ / 670.00 м')
    expect(serialized).toContain('X-1')
    expect(serialized).toContain('BH-1')
    expect(serialized).toContain('CAD-CONTEXT-LABEL')
    expect(serialized).toContain('data-cad-context')
    expect(serialized).toContain('ИГЭ-G1')
    expect(serialized).toContain('Общие данные')
    expect(serialized).toContain('Точки топографической съёмки')
    expect(serialized).toContain('Хэш расчётных исходных данных')
    expect(serialized).toContain('Начало трассы')
  })

  it('keeps every network polyline but deterministically thins coincident labels and preserves diameter changes', () => {
    const set = drawingSet()
    const networkPaths = Array.from({ length: 12 }, (_, index) => ({
      pipeId: `CROWDED-${index}`,
      points: [{ x: 100, y: 25 }, { x: 550, y: 75 }],
      source: 'synthetic crowded label fixture',
    }))
    const pipeDiameterMm = new Map(networkPaths.map((path, index) => [path.pipeId, index < 6 ? 800 : 1000]))
    const doc = buildProjectAlbumDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: { ...set, networkPaths }, surveyPoints, manholeConstructions, pipeDiameterMm, outletFlowLps: 12,
    })
    const serialized = JSON.stringify(doc)
    expect(serialized.match(/data-network-pipe/g)).toHaveLength(12)
    expect(serialized.match(/data-network-label/g)).toHaveLength(2)
    expect(serialized).toContain('CROWDED-0 · Ø800')
    expect(serialized).toContain('CROWDED-6 · Ø1000')
  })

  it('adds an engineering frame and a structured lower title block without changing sheet data', () => {
    const set = drawingSet()
    const input = {
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm' as const, network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    }
    const doc = buildProjectSheetDoc(input, set.sheets[0].id) as {
      footer: unknown
      background: (currentPage: number, pageSize: { width: number; height: number }) => { canvas: Array<Record<string, number | string>> }
    }
    const footer = JSON.stringify(doc.footer)
    expect(footer).toContain('Стадия')
    expect(footer).toContain('Листов')
    expect(footer).toContain('MAIN/3')
    expect(doc.background(1, { width: 1200, height: 842 }).canvas[0]).toMatchObject({
      type: 'rect', x: 14, y: 14, w: 1172, h: 814,
    })
  })

  it('refuses to issue an album when any required source is blocked', () => {
    const set = drawingSet('blocked')
    expect(() => buildProjectAlbumDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    })).toThrow(/Финальный выпуск запрещён/)
  })

  it('renders and reopens the vector PDF with manifest-driven A3 and generated roll-sheet sizes', async () => {
    const set = drawingSet()
    const blob = await generateProjectAlbumPdf({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
      constraints: { corridorRings: [], crossings: [{
        id: 'X-1', stationM: 300, kind: 'utility', owner: 'Synthetic owner', size: '100 mm', source: 'Synthetic survey',
        existingElevationM: 98.4, designInvertElevationM: 96.1, clearanceM: 1.8, requiredClearanceM: 1,
        method: 'open cut', approved: true,
      }] },
      boreholes: [{
        label: 'BH-1', x: 300, y: 50, mouthElevationM: 99,
        layers: [{ igeCode: 'G1', topDepthM: 0, bottomDepthM: 4 }], water: { depthM: 2.5 },
      }],
      geologyMaxOffsetM: 100,
    })
    const auditPath = process.env.AQUASCHEME_PDF_AUDIT_PATH
    if (auditPath) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(auditPath, new Uint8Array(await blob.arrayBuffer()))
    }
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
    expect(pdf.numPages).toBe(set.sheets.length + 3)
    let albumText = ''
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const pageFormat = set.manifest.pages[pageNumber - 1].pageFormat
      expect(viewport.width).toBeCloseTo(pageFormat.widthMm * 72 / 25.4, 0)
      expect(viewport.height).toBeCloseTo(pageFormat.heightMm * 72 / 25.4, 0)
      albumText += (await page.getTextContent()).items.map((item) => 'str' in item ? item.str : '').join(' ')
    }
    expect(set.manifest.pages.some((page) => page.pageFormat.format === 'custom')).toBe(true)
    expect(albumText).toContain('X-1')
    expect(albumText).toContain('BH-1')
    const normalizedAlbumText = albumText.replace(/\s+/g, '')
    expect(normalizedAlbumText).toContain('2.99‰/670.00м')
    expect(normalizedAlbumText).toContain('Общиеданные')
    expect(normalizedAlbumText).toContain('Точкитопографическойсъёмки')
    const structuresPage = await pdf.getPage(pdf.numPages - 1)
    const structuresText = (await structuresPage.getTextContent()).items
      .map((item) => 'str' in item ? item.str : '')
      .join(' ')
    expect(structuresText).toContain('К-1')
    expect(structuresText).toContain('ПК0')
    expect(structuresText.replace(/\s+/g, '')).toContain('TEST-K-1')
  }, 30_000)

  it('includes only layered boreholes inside an explicitly confirmed profile corridor', () => {
    const set = drawingSet()
    const boreholes = [
      {
        label: 'BH-NEAR', x: 300, y: 50, mouthElevationM: 99,
        layers: [{ igeCode: 'NEAR', topDepthM: 0, bottomDepthM: 4 }], water: { depthM: 2.5 },
      },
      {
        label: 'BH-FAR', x: 300, y: 5000, mouthElevationM: 99,
        layers: [{ igeCode: 'FAR', topDepthM: 0, bottomDepthM: 4 }], water: { depthM: 2.5 },
      },
    ]
    const baseInput = {
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm' as const, network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
      boreholes,
    }

    const confirmed = JSON.stringify(buildProjectAlbumDoc({ ...baseInput, geologyMaxOffsetM: 100 }))
    expect(confirmed).toContain('BH-NEAR')
    expect(confirmed).toContain('ИГЭ-NEAR')
    expect(confirmed).not.toContain('BH-FAR')
    expect(confirmed).not.toContain('ИГЭ-FAR')
    expect(confirmed).toContain('"text":"Скважины с координатами"},{"text":"1"')

    const unconfirmed = JSON.stringify(buildProjectAlbumDoc(baseInput))
    expect(unconfirmed).not.toContain('BH-NEAR')
    expect(unconfirmed).not.toContain('BH-FAR')
    expect(unconfirmed).toContain('"text":"Скважины с координатами"},{"text":"0"')
  })

  it('isolates branch-profile geology, crossings and schedule labels in PDF and DXF', async () => {
    const branchNetwork: TracedNetwork = {
      nodes: [
        ...network.nodes,
        { id: 'C', kind: 'source', x: 0, y: 1000, groundElevation: 100 },
      ],
      pipes: [
        ...network.pipes,
        {
          id: 'CB', kind: 'gravity_collector', fromNode: 'C', toNode: 'B', lengthM: 1110,
          alignment: [{ x: 0, y: 1000 }, { x: 300, y: 585 }, { x: 650, y: 100 }],
          dataSource: 'confirmed branch alignment',
        },
      ],
      totalLengthM: 1780,
    }
    const branchProfile: GravityProfile = {
      stations: [
        { nodeId: 'C', chainageM: 0, groundElevationM: 100, invertElevationM: 97, depthM: 3, diameterMm: 600 },
        { nodeId: 'B', chainageM: 1110, groundElevationM: 98, invertElevationM: 95, depthM: 3, diameterMm: 800 },
      ],
      maxDepthM: 3,
      outletInvertElevationM: 95,
      totalLengthM: 1110,
      pipeIds: ['CB'],
    }
    const branchSchedule: SewerSchedule = {
      manholes: [
        { nodeId: 'A', label: 'MAIN-A', picket: 'ПК0', depthMm: 3000, pipeDiameterMm: 800 },
        { nodeId: 'B', label: 'JOINT-B', picket: 'ПК6+70', depthMm: 3000, pipeDiameterMm: 800 },
        { nodeId: 'C', label: 'BRANCH-C', picket: 'ПК0', depthMm: 3000, pipeDiameterMm: 600 },
      ],
      pipes: [
        { designation: 'MAIN', diameterMm: 800, lengthM: 670, agskCode: 'main' },
        { designation: 'BRANCH', diameterMm: 600, lengthM: 1110, agskCode: 'branch' },
      ],
      totalPipeLengthM: 1780,
    }
    const crossings = [
      { id: 'LEGACY-MAIN', stationM: 100, kind: 'utility' },
      { id: 'TAGGED-MAIN', stationM: 120, profileId: 'main', kind: 'utility' },
      { id: 'TAGGED-BRANCH', stationM: 140, profileId: 'spur', kind: 'utility' },
      { id: 'PIPE-BRANCH', stationM: 160, pipeId: 'CB', kind: 'utility' },
      { id: 'WRONG-BRANCH', stationM: 180, profileId: 'other', kind: 'utility' },
    ]
    const set = buildWorkingDrawingSet({
      system: 'storm', network: branchNetwork, profile, schedule: branchSchedule,
      branchProfiles: [{ id: 'spur', title: 'Ветвь C-Б', source: 'confirmed branch model', verified: true, profile: branchProfile }],
      routeStatus: 'calculated',
      georeference: { kind: 'local_anchor', source: 'control points' },
      surveyPoints: [...surveyPoints, { x: 0, y: 1000, z: 100 }, { x: 300, y: 585, z: 99 }],
      unresolvedLayerCount: 0,
      catalogReady: true,
      catalogFingerprint: ['600', '800'],
      hydraulicsReady: true,
      stormRunoff: { available: true, verified: true, source: 'verified runoff', detail: 'branch fixture' },
      freezingDepth: { valueM: 1.8, status: 'verified', source: 'verified fixture' },
      utilityFeatureCount: 0,
      crossings,
      deliverableRequirements: {
        crossingDetailSheets: false,
        protectiveGridDetail: false,
        source: 'approved fixture register',
        verified: true,
      },
      spatialBoreholeCount: 2,
      geologyCoverage: { maxOffsetM: 40, status: 'verified', source: 'verified branch corridors' },
      geologyFingerprint: ['BH-MAIN', 'BH-BRANCH'],
      manholeCatalogReady: true,
      specificationItemCount: workingDrawingSpecificationItemCount(branchSchedule, []),
      normsVerified: true,
    })
    const input = {
      projectName: 'Разветвлённый тест', projectCode: 'К2', system: 'storm' as const,
      network: branchNetwork, profile, schedule: branchSchedule, drawingSet: set,
      surveyPoints: [...surveyPoints, { x: 0, y: 1000, z: 100 }, { x: 300, y: 585, z: 99 }],
      manholeConstructions: [], pipeDiameterMm: new Map([['AB', 800], ['CB', 600]]), outletFlowLps: 12,
      constraints: { corridorRings: [], crossings },
      boreholes: [
        {
          label: 'BH-MAIN', x: 300, y: 50, mouthElevationM: 99,
          layers: [{ igeCode: 'MAIN', topDepthM: 0, bottomDepthM: 3 }], water: {},
        },
        {
          label: 'BH-BRANCH', x: 100, y: 862, mouthElevationM: 99,
          layers: [{ igeCode: 'BRANCH', topDepthM: 0, bottomDepthM: 3 }], water: {},
        },
      ],
      geologyMaxOffsetM: 40,
    }
    const mainSheet = set.sheets.find((sheet) => sheet.kind === 'profile' && sheet.variant === 'main_profile')!
    const branchSheet = set.sheets.find((sheet) => sheet.kind === 'profile' && sheet.profileId === 'spur')!
    expect(mainSheet.status).toBe('VERIFIED')
    expect(branchSheet.status).toBe('VERIFIED')

    const mainPdf = JSON.stringify(buildProjectSheetDoc(input, mainSheet.id))
    const branchPdf = JSON.stringify(buildProjectSheetDoc(input, branchSheet.id))
    expect(mainPdf).toContain('BH-MAIN')
    expect(mainPdf).not.toContain('BH-BRANCH')
    expect(mainPdf).toContain('LEGACY-MAIN')
    expect(mainPdf).toContain('TAGGED-MAIN')
    expect(mainPdf).not.toContain('TAGGED-BRANCH')
    expect(branchPdf).toContain('BH-BRANCH')
    expect(branchPdf).not.toContain('BH-MAIN')
    expect(branchPdf).toContain('TAGGED-BRANCH')
    expect(branchPdf).toContain('PIPE-BRANCH')
    expect(branchPdf).not.toContain('LEGACY-MAIN')
    expect(branchPdf).not.toContain('WRONG-BRANCH')
    expect(branchPdf).toContain('BRANCH-C')
    expect(branchPdf).toContain('JOINT-B')

    const branchDxf = await generateWorkingDrawingSheetDxf(input, branchSheet.id)
    expect(branchDxf).toContain('BH-BRANCH')
    expect(branchDxf).not.toContain('BH-MAIN')
    expect(branchDxf).toContain('TAGGED-BRANCH')
    expect(branchDxf).toContain('PIPE-BRANCH')
    expect(branchDxf).not.toContain('LEGACY-MAIN')
    expect(branchDxf).not.toContain('WRONG-BRANCH')
    expect(branchDxf).toContain('BRANCH-C')
    expect(branchDxf).toContain('JOINT-B')
  })

  it('exports every calculated register sheet as an independent DXF', async () => {
    const set = drawingSet()
    const input = {
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm' as const, network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    }
    for (const sheet of set.sheets) {
      const dxf = await generateWorkingDrawingSheetDxf(input, sheet.id)
      expect(dxf).toContain('SECTION')
      expect(dxf.trimEnd().endsWith('EOF')).toBe(true)
    }
  })

  it('exports a complete DXF set with the exact register ids and sheet numbers', async () => {
    const set = drawingSet()
    const files = await generateWorkingDrawingSetDxfs({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    })
    expect(files.map(({ sheetId, sheetNumber }) => ({ sheetId, sheetNumber }))).toEqual(
      set.sheets.map(({ id: sheetId, sheetNumber }) => ({ sheetId, sheetNumber })),
    )
    for (const file of files) {
      expect(file.dxf).toContain('SECTION')
      expect(file.dxf.trimEnd().endsWith('EOF')).toBe(true)
    }
  })
})
