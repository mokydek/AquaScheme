import { describe, expect, it } from 'vitest'
import { buildWorkingDrawingSet } from '@aquascheme/engine'
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
    utilityFeatureCount: 0,
    spatialBoreholeCount: 1,
    geologyFingerprint: [{ x: 300, y: 50 }],
    manholeCatalogReady: true,
    normsVerified: true,
  })
}

describe('project working-drawing album', () => {
  it('uses the dynamic register and produces no fixed 61-page/reference content', () => {
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
    }) as { content: unknown[]; info: { subject: string } }
    expect(doc.content).toHaveLength(set.sheets.length + 2)
    expect(doc.info.subject).toContain(`${set.sheets.length + 2} листов`)
    const serialized = JSON.stringify(doc.content)
    expect(serialized).not.toContain('61 лист')
    expect(serialized).not.toContain('фиктив')
    expect(serialized).toContain('2.99‰ / 670.00 м')
    expect(serialized).toContain('X-1')
    expect(serialized).toContain('BH-1')
    expect(serialized).toContain('ИГЭ-G1')
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
    })
    const auditPath = process.env.AQUASCHEME_PDF_AUDIT_PATH
    if (auditPath) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(auditPath, new Uint8Array(await blob.arrayBuffer()))
    }
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
    expect(pdf.numPages).toBe(set.sheets.length + 2)
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
    expect(albumText.replace(/\s+/g, '')).toContain('2.99‰/670.00м')
    const structuresPage = await pdf.getPage(pdf.numPages - 1)
    const structuresText = (await structuresPage.getTextContent()).items
      .map((item) => 'str' in item ? item.str : '')
      .join(' ')
    expect(structuresText).toContain('К-1')
    expect(structuresText).toContain('ПК0')
    expect(structuresText.replace(/\s+/g, '')).toContain('TEST-K-1')
  }, 30_000)

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
