import { describe, expect, it } from 'vitest'
import { justified } from './normregistry'
import {
  absent,
  assumed,
  auditProvenance,
  derived,
  fromCatalogue,
  fromJustified,
  measured,
  provenanceLabel,
  traced,
  weakest,
} from './provenance'

describe('происхождение значения', () => {
  it('измеренное и выведенное подтверждены, принятое — нет', () => {
    expect(measured(345.58, 'топосъёмка, слой РЕЛЬЕФ').provenance.verified).toBe(true)
    expect(derived(0.0007, 'уклон', ['лоток КК-1', 'лоток КК-2']).provenance.verified).toBe(true)
    expect(fromCatalogue('241-702-0903', 'АГСК-3').provenance.verified).toBe(true)
    expect(assumed(1.8, 'типовое значение').provenance.verified).toBe(false)
  })

  it('принятое нельзя объявить подтверждённым в обход', () => {
    // Даже если вызывающий передал verified: true.
    const sneaky = traced(1.8, { kind: 'assumed', source: 'по опыту', verified: true })
    expect(sneaky.provenance.verified).toBe(false)
    const missing = traced(null, { kind: 'absent', source: 'нет данных', verified: true })
    expect(missing.provenance.verified).toBe(false)
  })

  it('отсутствующее значение равно null и несёт причину', () => {
    const gap = absent<number>('расход в ТУ не заполнен')
    expect(gap.value).toBeNull()
    expect(gap.provenance.kind).toBe('absent')
    expect(gap.provenance.source).toContain('ТУ')
  })

  it('выведенное хранит, из чего получено', () => {
    const slope = derived(0.0007, 'расчёт уклона', ['КК-1 лоток 685.87', 'КК-2 лоток 685.72'])
    expect(slope.provenance.derivedFrom).toHaveLength(2)
  })
})

describe('перенос нормативной величины', () => {
  it('нормативное основание даёт подтверждённое значение', () => {
    const item = fromJustified(justified(1.5, ['sewer.velocity.min'], 'normative', 'таблица 5.19'))
    expect(item.provenance.kind).toBe('normative')
    expect(item.provenance.verified).toBe(true)
    expect(item.provenance.note).toContain('5.19')
  })

  it('инженерное или экономическое решение остаётся принятым', () => {
    const engineering = fromJustified(justified(550, ['sewer.design.minBurial'], 'engineering'))
    expect(engineering.provenance.kind).toBe('assumed')
    expect(engineering.provenance.verified).toBe(false)
    expect(engineering.provenance.note).toContain('engineering')

    expect(fromJustified(justified(1, ['x'], 'economic')).provenance.verified).toBe(false)
  })
})

describe('слабейшее звено', () => {
  it('результат ограничен наименее достоверным входом', () => {
    const worst = weakest([
      measured(1, 'съёмка').provenance,
      fromCatalogue('X', 'каталог').provenance,
      assumed(2, 'по умолчанию').provenance,
    ])
    expect(worst?.kind).toBe('assumed')
  })

  it('на пустом наборе возвращает null, а не выдумывает разряд', () => {
    expect(weakest([])).toBeNull()
  })
})

describe('аудит набора значений', () => {
  const fields = {
    'отметка земли': measured(345.58, 'топосъёмка'),
    'лоток': measured(342.2, 'разметка колодца'),
    'уклон': derived(0.0007, 'расчёт', ['лоток 1', 'лоток 2']),
    'код продукции': fromCatalogue('241-702-0903', 'АГСК-3 стр. 1705'),
    'мин. скорость': fromJustified(justified(1.5, ['sewer.velocity.min'], 'normative')),
    'глубина промерзания': assumed(1.8, 'региональная таблица без подтверждения'),
    'расход стоков': absent<number>('в ТУ не заполнен'),
  }

  it('считает по разрядам и даёт долю пригодных к выпуску', () => {
    const audit = auditProvenance(fields)
    expect(audit.total).toBe(7)
    expect(audit.byKind.measured).toBe(2)
    expect(audit.byKind.assumed).toBe(1)
    expect(audit.byKind.absent).toBe(1)
    expect(audit.verifiedShare).toBeCloseTo(5 / 7, 3)
  })

  it('перечисляет поимённо то, что не даёт выпустить лист', () => {
    const audit = auditProvenance(fields)
    expect(audit.blockers.map((item) => item.field).sort())
      .toEqual(['глубина промерзания', 'расход стоков'])
    expect(audit.blockers.find((item) => item.field === 'расход стоков')?.source).toContain('ТУ')
  })

  it('полностью подтверждённый набор блокеров не даёт', () => {
    const audit = auditProvenance({ a: measured(1, 'съёмка') })
    expect(audit.blockers).toEqual([])
    expect(audit.verifiedShare).toBe(1)
  })

  it('пустой набор не выдаёт себя за подтверждённый', () => {
    expect(auditProvenance({}).verifiedShare).toBe(0)
  })
})

describe('подписи разрядов', () => {
  it('читаются человеком', () => {
    expect(provenanceLabel('measured')).toBe('измерено')
    expect(provenanceLabel('assumed')).toBe('принято по умолчанию')
  })
})
