import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  buildWorkingDrawingSet,
  workingDrawingSpecificationItemCount,
} from '@aquascheme/engine'
import type {
  GravityProfile,
  SelectedManholeConstruction,
  SewerSchedule,
  TracedNetwork,
} from '@aquascheme/engine'
import { WorkingDrawingPreview } from '../app/project/WorkingDrawingPreview'
import {
  generateManholeSheetsDxf,
  generateQuantityBillXlsx,
  generateProjectSheetPdf,
  generateSewerScheduleXlsx,
  generateWorkingDrawingSheetDxf,
} from './exporters'
import type { ProjectAlbumInput } from './projectAlbum'

const schedule: SewerSchedule = {
  manholes: [{ label: 'К-1', picket: 'ПК1+25', depthMm: 2500, pipeDiameterMm: 500 }],
  pipes: [{ designation: 'Труба тестовая', diameterMm: 500, lengthM: 125, agskCode: 'TEST-PIPE' }],
  totalPipeLengthM: 125,
}

const constructions: SelectedManholeConstruction[] = [{
  manholeLabel: 'К-1',
  typeCode: 'TEST-WELL',
  chamberDiameterMm: 1500,
  source: 'Каталог, лист 7',
  components: [
    { name: 'Кольцо', unit: 'шт', baseQuantity: 1, catalogCode: 'RING', quantity: 3 },
    { name: 'Плита', unit: 'шт', baseQuantity: 1, catalogCode: 'SLAB', quantity: 1 },
  ],
}]

describe('ведомость объёмов работ XLSX', () => {
  it('выпускается двумя листами: посчитанное и непосчитанное', async () => {
    // Второй лист не декоративен: сметчик должен видеть, каких величин проекту
    // не хватило, а не считать отсутствие строки нулём.
    const XLSX = await import('xlsx')
    const bytes = await generateQuantityBillXlsx({
      rows: [{ name: 'Укладка трубопровода Ø500 мм', unit: 'м', quantity: 125, derivedFrom: 'ведомость труб проекта' }],
      gaps: [{ name: 'Разработка грунта в траншее', missing: 'зазор от трубы до стенки траншеи' }],
      totalLengthM: 125,
    })
    const book = XLSX.read(bytes)
    expect(book.SheetNames).toEqual(['Объёмы', 'Не посчитано'])
    const volumes = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets['Объёмы'])
    expect(volumes[0]['Кол-во']).toBe(125)
    expect(volumes[0]['Из чего получено']).toBe('ведомость труб проекта')
    const gaps = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets['Не посчитано'])
    expect(gaps[0]['Чего не хватает']).toMatch(/зазор/)
  })
})

describe('листы колодцев', () => {
  it('дают лист решений и ведомость материалов по каждому колодцу', async () => {
    // Функция существовала и не вызывалась ниоткуда: листы строились и в
    // комплект не попадали. Проверяем то, ради чего лист и нужен, — тип
    // конструкции, её источник и посчитанные количества элементов.
    const sheets = await generateManholeSheetsDxf('Тестовый объект', schedule, constructions)
    expect(sheets.detail).toContain('TEST-WELL')
    expect(sheets.detail).toContain('Каталог, лист 7')
    expect(sheets.tables).toHaveLength(1)
    expect(sheets.tables[0].dxf).toContain('Кольцо')
    expect(sheets.tables[0].dxf).toContain('Плита')
  })

  it('лист защитной сетки выпускается только когда сетка есть в конструкции', async () => {
    const without = await generateManholeSheetsDxf('Тестовый объект', schedule, constructions)
    expect(without.grille).toBeUndefined()

    const withGrille = await generateManholeSheetsDxf('Тестовый объект', schedule, [{
      ...constructions[0],
      components: [
        ...constructions[0].components,
        { name: 'Сетка защитная', unit: 'шт', baseQuantity: 1, quantity: 2 },
      ],
    }])
    expect(withGrille.grille).toBeDefined()
    expect(withGrille.grille).toContain('Каталог, лист 7')
  })
})

describe('working schedule XLSX', () => {
  it('exports selected construction provenance and calculated component quantities', async () => {
    const XLSX = await import('xlsx')
    const bytes = await generateSewerScheduleXlsx(schedule, constructions)
    const workbook = XLSX.read(bytes)
    expect(workbook.SheetNames).toEqual(['Колодцы', 'Трубы', 'Элементы колодцев', 'Итоги по колодцам'])
    const wells = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Колодцы'])
    expect(wells[0]['Тип конструкции']).toBe('TEST-WELL')
    expect(wells[0]['Источник конструкции']).toBe('Каталог, лист 7')
    const totals = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Итоги по колодцам'])
    expect(totals).toEqual(expect.arrayContaining([
      expect.objectContaining({ 'Код': 'RING', 'Количество': 3 }),
      expect.objectContaining({ 'Код': 'SLAB', 'Количество': 1 }),
    ]))
  })
})

describe('multi-sheet specification contract', () => {
  it('covers more than 40 rows exactly once in three independent PDF, DXF and preview sheets', async () => {
    const specificationPipes = Array.from({ length: 45 }, (_, index) => ({
      designation: `SPEC-ROW-${String(index + 1).padStart(3, '0')}`,
      diameterMm: 500 + index,
      lengthM: 100 + index,
      agskCode: `SPEC-CODE-${String(index + 1).padStart(3, '0')}`,
    }))
    const specificationSchedule: SewerSchedule = {
      manholes: [
        { nodeId: 'TEST-A', label: 'TEST-MH-1', picket: 'PK0', depthMm: 2500, pipeDiameterMm: 500 },
        { nodeId: 'TEST-OUT', label: 'TEST-OUT', picket: 'PK1', depthMm: 2500, pipeDiameterMm: 500 },
      ],
      pipes: specificationPipes,
      totalPipeLengthM: specificationPipes.reduce((sum, pipe) => sum + pipe.lengthM, 0),
    }
    const specificationNetwork: TracedNetwork = {
      nodes: [
        { id: 'TEST-A', kind: 'ring', x: 0, y: 0, groundElevation: 100 },
        { id: 'TEST-OUT', kind: 'source', x: 100, y: 0, groundElevation: 99 },
      ],
      pipes: [{
        id: 'TEST-PIPE',
        kind: 'gravity_collector',
        fromNode: 'TEST-A',
        toNode: 'TEST-OUT',
        lengthM: 100,
        alignment: [{ x: 0, y: 0 }, { x: 50, y: 8 }, { x: 100, y: 0 }],
        dataSource: 'synthetic:test',
      }],
      totalLengthM: 100,
    }
    const specificationProfile: GravityProfile = {
      stations: [
        { nodeId: 'TEST-A', chainageM: 0, groundElevationM: 100, invertElevationM: 97, depthM: 3, diameterMm: 500 },
        { nodeId: 'TEST-OUT', chainageM: 100, groundElevationM: 99, invertElevationM: 96.5, depthM: 2.5, diameterMm: 500 },
      ],
      maxDepthM: 3,
      outletInvertElevationM: 96.5,
      totalLengthM: 100,
      pipeIds: ['TEST-PIPE'],
    }
    const surveyPoints = [{ x: 0, y: 0, z: 100 }, { x: 100, y: 0, z: 99 }]
    const specificationItemCount = workingDrawingSpecificationItemCount(specificationSchedule, [])
    const drawingSet = buildWorkingDrawingSet({
      system: 'storm',
      network: specificationNetwork,
      profile: specificationProfile,
      schedule: specificationSchedule,
      routeStatus: 'calculated',
      georeference: { kind: 'local_anchor', source: 'synthetic:test' },
      surveyPoints,
      unresolvedLayerCount: 0,
      catalogReady: true,
      hydraulicsReady: true,
      stormRunoff: { available: true, verified: true, source: 'synthetic catchment calculation' },
      utilityFeatureCount: 0,
      crossings: [],
      spatialBoreholeCount: 1,
      manholeCatalogReady: true,
      normsVerified: true,
      specificationItemCount,
      options: { specificationRowsPerSheet: 20 },
    })
    const input: ProjectAlbumInput = {
      projectName: 'Synthetic specification pagination',
      projectCode: 'TEST-SPEC',
      system: 'storm',
      network: specificationNetwork,
      profile: specificationProfile,
      schedule: specificationSchedule,
      drawingSet,
      surveyPoints,
      manholeConstructions: [],
      pipeDiameterMm: new Map([['TEST-PIPE', 500]]),
      outletFlowLps: 1,
    }
    const sheets = drawingSet.sheets.filter((sheet) => sheet.kind === 'specification')
    expect(sheets).toHaveLength(3)
    expect(sheets.map((sheet) => sheet.dataRange)).toEqual([
      { start: 0, end: 20, total: 45 },
      { start: 20, end: 40, total: 45 },
      { start: 40, end: 45, total: 45 },
    ])

    const pdfTexts: string[] = []
    const dxfTexts: string[] = []
    const previewTexts: string[] = []
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    for (const sheet of sheets) {
      const pdfBlob = await generateProjectSheetPdf(input, sheet.id)
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await pdfBlob.arrayBuffer()) }).promise
      expect(pdf.numPages).toBe(1)
      const page = await pdf.getPage(1)
      pdfTexts.push((await page.getTextContent()).items
        .map((item) => 'str' in item ? item.str : '')
        .join(''))
      dxfTexts.push(await generateWorkingDrawingSheetDxf(input, sheet.id))
      previewTexts.push(renderToStaticMarkup(createElement(WorkingDrawingPreview, {
        sheet,
        drawingSet,
        network: specificationNetwork,
        pipeDiameterMm: input.pipeDiameterMm,
        surveyPoints,
        profile: specificationProfile,
        schedule: specificationSchedule,
        manholeConstructions: [],
        showFrame: false,
      })))
    }

    const occurrenceCount = (text: string, marker: string) => text.split(marker).length - 1
    for (let rowIndex = 0; rowIndex < specificationPipes.length; rowIndex++) {
      const marker = specificationPipes[rowIndex].designation
      const owner = sheets.findIndex((sheet) => (
        rowIndex >= (sheet.dataRange?.start ?? 0) && rowIndex < (sheet.dataRange?.end ?? 0)
      ))
      expect(owner).toBeGreaterThanOrEqual(0)
      for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
        const expected = sheetIndex === owner ? 1 : 0
        expect(occurrenceCount(pdfTexts[sheetIndex], marker), `PDF ownership of ${marker}`).toBe(expected)
        expect(occurrenceCount(dxfTexts[sheetIndex], marker), `DXF ownership of ${marker}`).toBe(expected)
        expect(occurrenceCount(previewTexts[sheetIndex], marker), `preview ownership of ${marker}`).toBe(expected)
      }
    }

    const staleInput: ProjectAlbumInput = {
      ...input,
      schedule: {
        ...specificationSchedule,
        pipes: [...specificationSchedule.pipes, {
          designation: 'TEST-PIPE-LATE', diameterMm: 900, lengthM: 10, agskCode: 'TEST-LATE',
        }],
      },
    }
    await expect(generateProjectSheetPdf(staleInput, sheets[0].id)).rejects.toThrow(/устарел/)
    await expect(generateWorkingDrawingSheetDxf(staleInput, sheets[0].id)).rejects.toThrow(/устарел/)
  }, 30_000)
})
