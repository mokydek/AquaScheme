import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { READINESS_SECTIONS, summarizeReadiness } from './readiness'
import type { WorkingDrawingSet, WorkingDrawingSheet } from './working-drawings'

const issue = (code: string, message = code) =>
  ({ code, message, requirement: 'route' } as WorkingDrawingSheet['blockers'][number])

const sheet = (
  id: string,
  status: WorkingDrawingSheet['status'],
  blockers: string[] = [],
  warnings: string[] = [],
): WorkingDrawingSheet => ({
  id,
  sequence: 1,
  documentSet: 'main',
  sheetNumber: 1,
  title: id,
  kind: 'plan',
  variant: 'plan',
  status,
  blockers: blockers.map((code) => issue(code)),
  warnings: warnings.map((code) => issue(code)),
  requirements: [],
  sources: [],
  inputHash: '',
} as unknown as WorkingDrawingSheet)

const set = (sheets: WorkingDrawingSheet[]) => ({ sheets } as unknown as WorkingDrawingSet)

describe('готовность проекта', () => {
  it('одинаковая причина на многих листах сводится в одну строку', () => {
    // Десять одинаковых строк на экране скрывают, что причин на самом деле две.
    const readiness = summarizeReadiness(set([
      sheet('1', 'BLOCKED', ['TOPOGRAPHY_MISSING']),
      sheet('2', 'BLOCKED', ['TOPOGRAPHY_MISSING']),
      sheet('3', 'BLOCKED', ['TOPOGRAPHY_MISSING', 'CATALOG_MISSING']),
    ]))
    expect(readiness.issues).toHaveLength(2)
    expect(readiness.issues[0].code).toBe('TOPOGRAPHY_MISSING')
    expect(readiness.issues[0].sheetCount).toBe(3)
    expect(readiness.issues[1].sheetCount).toBe(1)
    expect(readiness.blockingIssueCount).toBe(2)
  })

  it('стоп-факторы идут раньше предупреждений', () => {
    const readiness = summarizeReadiness(set([
      sheet('1', 'PRELIMINARY', [], ['NORMS_REQUIRE_REVIEW']),
      sheet('2', 'PRELIMINARY', [], ['NORMS_REQUIRE_REVIEW']),
      sheet('3', 'BLOCKED', ['CATALOG_MISSING']),
    ]))
    expect(readiness.issues[0].code).toBe('CATALOG_MISSING')
    expect(readiness.issues[0].blocking).toBe(true)
    expect(readiness.issues[1].blocking).toBe(false)
    expect(readiness.blockingIssueCount).toBe(1)
  })

  it('причина, где-то блокирующая, блокирующей и остаётся', () => {
    // На одном листе величина только предупреждение, на другом — стоп-фактор.
    // Свод обязан показать худший случай, иначе он успокаивает зря.
    const readiness = summarizeReadiness(set([
      sheet('1', 'CALCULATED', [], ['FREEZING_DEPTH_UNVERIFIED']),
      sheet('2', 'BLOCKED', ['FREEZING_DEPTH_UNVERIFIED']),
    ]))
    expect(readiness.issues).toHaveLength(1)
    expect(readiness.issues[0].blocking).toBe(true)
    expect(readiness.issues[0].sheetCount).toBe(2)
  })

  it('каждая известная причина называет раздел, где её снимают', () => {
    const readiness = summarizeReadiness(set([
      sheet('1', 'BLOCKED', ['FREEZING_DEPTH_UNVERIFIED', 'DWG_LAYERS_UNRESOLVED', 'CROSSING_CARDS_MISSING']),
    ]))
    for (const item of readiness.issues) {
      expect(item.section, item.code).toBeTruthy()
    }
    expect(readiness.issues.find((item) => item.code === 'DWG_LAYERS_UNRESOLVED')?.section).toMatch(/роли слоёв/)
  })

  it('незнакомый код не выдумывает раздел', () => {
    const readiness = summarizeReadiness(set([sheet('1', 'BLOCKED', ['СОЧИНЁННЫЙ_КОД'])]))
    expect(readiness.issues[0].section).toBeUndefined()
    expect(readiness.issues[0].code).toBe('СОЧИНЁННЫЙ_КОД')
  })

  it('считает доли листов по состояниям', () => {
    const readiness = summarizeReadiness(set([
      sheet('1', 'VERIFIED'), sheet('2', 'VERIFIED'), sheet('3', 'BLOCKED'), sheet('4', 'CALCULATED'),
    ]))
    expect(readiness.sheetCount).toBe(4)
    expect(readiness.byStatus.VERIFIED).toBe(2)
    expect(readiness.byStatus.BLOCKED).toBe(1)
    expect(readiness.verifiedPercent).toBe(50)
    expect(readiness.reason).toMatch(/Стоп-факторов нет/)
  })

  it('пустой набор не выдаётся за готовый', () => {
    const readiness = summarizeReadiness(set([]))
    expect(readiness.verifiedPercent).toBe(0)
    expect(readiness.reason).toMatch(/выпускать нечего/)
    expect(readiness.issues).toEqual([])
  })

  it('называет наибольшую причину: с неё начинают', () => {
    const readiness = summarizeReadiness(set([
      sheet('1', 'BLOCKED', ['CATALOG_MISSING']),
      sheet('2', 'BLOCKED', ['TOPOGRAPHY_MISSING']),
      sheet('3', 'BLOCKED', ['TOPOGRAPHY_MISSING']),
    ]))
    expect(readiness.reason).toMatch(/TOPOGRAPHY_MISSING — 2 листов/)
  })

  it('каждый код шлюза знает свой раздел', () => {
    // Иначе колонка «где снимается» пустеет у настоящей причины, и совет
    // «исправьте это» повисает без адреса. Список кодов берётся из самого
    // шлюза, а не переписывается сюда руками.
    const source = readFileSync(new URL('./working-drawings.ts', import.meta.url), 'utf8')
    // Берутся все прописные литералы, а не только первый довод `issue(...)`:
    // ROUTE_INPUT_BLOCKER пишется через тернарник, и разбор по вызову его
    // пропускал — проверка недосчитывала коды и проходила зря.
    const statuses = new Set(['BLOCKED', 'PRELIMINARY', 'CALCULATED', 'VERIFIED', 'STALE'])
    const codes = [...source.matchAll(/'([A-Z][A-Z_]{4,})'/g)]
      .map((match) => match[1])
      .filter((code) => !statuses.has(code))
    expect(codes.length).toBeGreaterThan(20)
    const unmapped = [...new Set(codes)].filter((code) => !(code in READINESS_SECTIONS))
    expect(unmapped, `коды без раздела: ${unmapped.join(', ')}`).toEqual([])
  })
})

describe('сводка сходится с числом листов', () => {
  /**
   * ИЗМЕРЕНО НА ЖИВОМ САЙТЕ: «Листов 5: к выпуску 0, рассчитано 0,
   * предварительно 0, заблокировано 0». Пять листов, четыре нуля — для
   * читателя это невозможно. Пятый статус, STALE, в строке назван не был, и
   * устаревший лист исчезал из сводки, оставаясь в общем числе.
   */
  const ALL_STATUSES: WorkingDrawingSheet['status'][] = [
    'BLOCKED', 'PRELIMINARY', 'CALCULATED', 'VERIFIED', 'STALE',
  ]

  it('сумма по byStatus равна числу листов для любого набора', () => {
    // Каждый статус берётся разное число раз, включая ноль: набор, где
    // сходится только «удобная» комбинация, инвариантом не является.
    for (let shift = 0; shift < ALL_STATUSES.length; shift++) {
      const sheets: WorkingDrawingSheet[] = []
      ALL_STATUSES.forEach((status, index) => {
        const count = (index + shift) % ALL_STATUSES.length
        for (let n = 0; n < count; n++) sheets.push(sheet(`${status}-${shift}-${n}`, status))
      })
      const readiness = summarizeReadiness({ sheets } as WorkingDrawingSet)
      const sum = ALL_STATUSES.reduce((total, status) => total + readiness.byStatus[status], 0)
      expect(sum, `набор ${shift}: перечисленное не сходится с общим числом`)
        .toBe(readiness.sheetCount)
    }
  })

  it('устаревший лист считается, а не пропадает', () => {
    const readiness = summarizeReadiness({
      sheets: [sheet('s1', 'STALE'), sheet('s2', 'STALE'), sheet('s3', 'VERIFIED')],
    } as WorkingDrawingSet)
    expect(readiness.sheetCount).toBe(3)
    expect(readiness.byStatus.STALE).toBe(2)
    expect(readiness.byStatus.VERIFIED).toBe(1)
  })

  it('статус, которого шлюз не знает, виден недостачей, а не тишиной', () => {
    /*
      Свод типизирован пятью статусами, и шестой, пришедший из данных, в него
      попасть не может: `if (sheet.status in byStatus)` его пропускает. Это
      осознанно — но тогда сумма обязана разойтись с общим числом, чтобы вид
      назвал разницу строкой «прочие статусы», а не показал ещё одну
      невозможную арифметику.
    */
    const readiness = summarizeReadiness({
      sheets: [sheet('s1', 'VERIFIED'), sheet('s2', 'НЕИЗВЕСТНЫЙ' as WorkingDrawingSheet['status'])],
    } as WorkingDrawingSet)
    const sum = ALL_STATUSES.reduce((total, status) => total + readiness.byStatus[status], 0)
    expect(readiness.sheetCount).toBe(2)
    expect(sum).toBe(1)
    expect(readiness.sheetCount - sum).toBe(1)
  })
})
