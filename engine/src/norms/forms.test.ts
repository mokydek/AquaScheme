import { describe, expect, it } from 'vitest'
import {
  ACT_FORMS,
  buildActFormsDoc,
  buildProjectDocsDoc,
  DESIGN_TASK_POINTS,
  TEP_ROWS,
} from './forms'
import { getClause } from '../normregistry'
import type { ExportInput } from '../exportdata'

// A minimal but valid ExportInput for the document generators.
function makeInput(): ExportInput {
  return {
    projectName: 'Тестовый район',
    dateIso: '2026-07-14T00:00:00.000Z',
    source: { x: 0, y: 0, groundElevation: 100, availableHead: 45 },
    buildings: [{ id: 'b1', label: 'Д1', x: 10, y: 10, floors: 2, residents: 50 }],
    network: { nodes: [], pipes: [], source: { x: 0, y: 0 } } as unknown as ExportInput['network'],
    sizing: {
      nodes: [],
      pipes: [
        { id: 'p1', fromNode: 's', toNode: 'r1', kind: 'supply', nominalMm: 160, lengthM: 120, flowLps: 12, velocityMs: 1, unitHeadlossMPerKm: 5, headlossM: 0.6 },
        { id: 'p2', fromNode: 'r1', toNode: 'r2', kind: 'ring', nominalMm: 110, lengthM: 200, flowLps: 6, velocityMs: 0.9, unitHeadlossMPerKm: 4, headlossM: 0.8 },
      ],
    } as unknown as ExportInput['sizing'],
    demand: { maxDailyM3: 480, avgDailyM3: 400 } as unknown as ExportInput['demand'],
    material: { primary: 'PE100_SDR17', pnBar: 10, jointType: 'welded', burialDepthM: 1.8, needsCompensators: false, reasons: [] } as unknown as ExportInput['material'],
    fittings: { counts: { hydrants: 0, valves: 0, airValves: 0, washouts: 0, wells: 0 } } as unknown as ExportInput['fittings'],
    norms: {} as unknown as ExportInput['norms'],
    geology: {} as unknown as ExportInput['geology'],
    seismicity: {} as unknown as ExportInput['seismicity'],
    workType: 'reconstruction',
    systemType: 'sewer',
  }
}

describe('project document forms (НБ2)', () => {
  it('all five СП РК 4.01-103 act forms are present with source pages', () => {
    expect(ACT_FORMS.map((f) => f.appendix)).toEqual(['А', 'В', 'Г', 'Е', 'Ж'])
    for (const form of ACT_FORMS) {
      expect(form.mandatory).toBe(true)
      expect(form.pdfPage).toBeGreaterThan(0)
      // Проверяется запись о переписывании, а не статус: статус зависит от
      // наличия PDF в репозитории, и текст формы им не подтверждается.
      expect(getClause(form.clauseId)?.sourcePage, form.clauseId).toBeGreaterThan(0)
    }
  })

  it('act clauses cite СП РК 4.01-103-2013 with a PDF page', () => {
    expect(getClause('act.pressureTest')?.documentCode).toBe('СП РК 4.01-103-2013')
    expect(getClause('act.pressureTest')?.sourcePage).toBe(111)
    expect(getClause('act.disinfection')?.sourcePage).toBe(122)
    expect(getClause('act.inputControl')?.sourcePage).toBe(124)
  })

  it('design task keeps the СН РК 1.02-03 point list verbatim (19 points)', () => {
    expect(DESIGN_TASK_POINTS).toHaveLength(19)
    expect(DESIGN_TASK_POINTS[0]).toBe('Основание для проектирования.')
    expect(DESIGN_TASK_POINTS[1]).toBe('Вид строительства.')
    expect(getClause('psd.designTask')?.sourcePage).toBeGreaterThan(0)
    expect(getClause('psd.tep')?.sourcePage).toBe(111)
    expect(getClause('psd.passport')?.sourcePage).toBe(119)
  })

  it('TEP rows for engineering structures include route length and diameters', () => {
    const keys = TEP_ROWS.map((r) => r.key).filter(Boolean)
    expect(keys).toContain('productivity')
    expect(keys).toContain('routeLength')
    expect(keys).toContain('diameters')
  })

  it('buildActFormsDoc produces a pdfmake doc filled from the project', () => {
    const doc = buildActFormsDoc(makeInput())
    const content = doc.content as Array<Record<string, unknown>>
    expect(Array.isArray(content)).toBe(true)
    const flat = JSON.stringify(content)
    expect(flat).toContain('ПНЕВМАТИЧЕСКОГО')
    expect(flat).toContain('ДЕЗИНФЕКЦИИ')
    expect(flat).toContain('ВХОДНОГО КОНТРОЛЯ')
    // segment table reflects the network (total length 320 m, diameters 110/160)
    expect(flat).toContain('320')
    expect(flat).toContain('110, 160')
  })

  it('buildProjectDocsDoc auto-fills work type, productivity and route length', () => {
    const doc = buildProjectDocsDoc(makeInput())
    const flat = JSON.stringify(doc.content)
    expect(flat).toContain('реконструкция')
    expect(flat).toContain('сети водоотведения')
    expect(flat).toContain('480.0') // productivity м3/сут
    expect(flat).toContain('320') // route length m
    expect(flat).toContain('Ф-2')
  })
})
