import { describe, expect, it } from 'vitest'
import { buildWorkingDrawingSet, workingDrawingSpecificationItemCount } from '@aquascheme/engine'
import type { GravityProfile, SelectedManholeConstruction, SewerSchedule, TracedNetwork } from '@aquascheme/engine'
import { generateProjectAlbumPdf, generateWorkingDrawingSetDxfs, generateWorkingDrawingSheetDxf } from './exporters'
import { buildProjectAlbumDoc } from './projectAlbum'

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
  manholes: [{ label: 'К-1', picket: 'ПК0', depthMm: 3000, pipeDiameterMm: 800 }],
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
  it('uses the dynamic register without embedding reference-album content', () => {
    const set = drawingSet()
    const doc = buildProjectAlbumDoc({
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
    }) as { content: unknown[]; info: { subject: string } }
    expect(doc.content).toHaveLength(set.sheets.length + 3)
    expect(doc.info.subject).toContain(`${set.sheets.length + 3} листов`)
    const serialized = JSON.stringify(doc.content)
    expect(serialized).not.toContain('R01')
    expect(serialized).not.toContain('фиктив')
    expect(serialized).toContain('2.99‰ / 670.00 м')
    expect(serialized).toContain('X-1')
    expect(serialized).toContain('BH-1')
    expect(serialized).toContain('ИГЭ-G1')
    expect(serialized).toContain('Общие данные')
    expect(serialized).toContain('Точки топографической съёмки')
    expect(serialized).toContain('Хэш расчётных исходных данных')
    expect(serialized).toContain('Начало трассы')
  })

  it('refuses to issue an album when any required source is blocked', () => {
    const set = drawingSet('blocked')
    expect(() => buildProjectAlbumDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    })).toThrow(/Финальный выпуск запрещён/)
  })

  it('renders and reopens the vector PDF with the registered page count and A3 landscape size', async () => {
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
      expect(viewport.width).toBeCloseTo(1190.55, 0)
      expect(viewport.height).toBeCloseTo(841.89, 0)
      albumText += (await page.getTextContent()).items.map((item) => 'str' in item ? item.str : '').join(' ')
    }
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
