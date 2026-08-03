import { describe, expect, it } from 'vitest'
import { auditProjectProvenance } from './project-provenance'

const ready = {
  surveyPointCount: 177,
  surveyPointSource: 'elevation_labels' as const,
  georeference: { kind: 'survey_grid', source: 'подписанная координатная сетка' },
  freezingDepth: { valueM: 1.6, status: 'verified', source: 'Отчёт изысканий, п. 2.5' },
  geologyCoverage: { maxOffsetM: 100, status: 'verified', source: 'Отчёт изысканий, п. 2.3' },
  spatialBoreholeCount: 3,
  designDiameterMm: 400,
  requiredClearanceM: 0.2,
  deliverables: { source: 'Задание на проектирование, п. 4.2', verified: true },
  catalogReady: true,
  manholeCatalogReady: true,
  normsVerified: true,
}

describe('происхождение ключевых величин проекта', () => {
  it('на полных исходных всё пригодно к выпуску', () => {
    const audit = auditProjectProvenance(ready)
    expect(audit.blockers).toHaveLength(0)
    expect(audit.verifiedShare).toBe(1)
    expect(audit.total).toBe(11)
  })

  it('величины из ТУ не считаются принятыми по умолчанию', () => {
    // До появления разряда «заявлено заданием» проектный диаметр пришлось бы
    // помечать принятым, и он навсегда оставался бы стоп-фактором.
    const audit = auditProjectProvenance(ready)
    expect(audit.fields['Проектный диаметр'].provenance.kind).toBe('stated')
    expect(audit.fields['Проектный диаметр'].provenance.verified).toBe(true)
    expect(audit.byKind.stated).toBe(3)
  })

  it('неподтверждённый источник делает величину непригодной, но не отсутствующей', () => {
    const audit = auditProjectProvenance({
      ...ready,
      freezingDepth: { valueM: 1.6, status: 'unverified', source: '' },
    })
    const frost = audit.fields['Глубина промерзания']
    expect(frost.provenance.kind).toBe('assumed')
    expect(frost.provenance.verified).toBe(false)
    expect(frost.value).toBe(1.6)
    expect(audit.blockers.map((item) => item.field)).toContain('Глубина промерзания')
  })

  it('отсутствие исходных данных названо поимённо', () => {
    const audit = auditProjectProvenance({})
    expect(audit.verifiedShare).toBe(0)
    const named = audit.blockers.map((item) => item.field)
    expect(named).toContain('Отметки съёмки')
    expect(named).toContain('Геопривязка')
    expect(named).toContain('Проектный диаметр')
    expect(named).toContain('Скважины с координатами')
  })

  it('дождевой сток учитывается только когда он к проекту относится', () => {
    expect(auditProjectProvenance(ready).total).toBe(11)
    expect(auditProjectProvenance({ ...ready, stormRunoff: null }).total).toBe(12)
  })

  it('состав комплекта без подписи ответственного не подтверждён', () => {
    const audit = auditProjectProvenance({
      ...ready,
      deliverables: { source: 'Задание, п. 4.2', verified: false },
    })
    const item = audit.fields['Состав проектного комплекта']
    expect(item.provenance.kind).toBe('stated')
    expect(item.provenance.verified).toBe(false)
    expect(item.provenance.note).toContain('не подтверждён')
  })
})
