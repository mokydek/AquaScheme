import { describe, expect, it } from 'vitest'
import { extractConditionsFromBrief } from './conditions-tu'

const page = (text: string) => [{ page: 1, text }]

describe('категория надёжности и характер стоков из задания', () => {
  it('читает римские, арабские и словесные формы категории', () => {
    for (const [text, expected] of [
      ['Насосная станция I категории надёжности действия.', 'first'],
      ['Категория надёжности действия — II.', 'second'],
      ['Принять третью категорию надёжности.', 'third'],
      ['Категория надёжности: 1', 'first'],
    ] as const) {
      const found = extractConditionsFromBrief(page(text))
      expect(found.category.map((item) => item.value), text).toContain(expected)
    }
  })

  it('категория без слова «надёжность» не считается: это другая величина', () => {
    // «II категория сложности изысканий» и «грунт II категории» — не про насосы.
    const found = extractConditionsFromBrief(page('Грунты II категории по трудности разработки.'))
    expect(found.category).toEqual([])
    expect(found.missing).toContain('категория надёжности насосной станции')
  })

  it('читает три вида стоков по норме', () => {
    for (const [text, expected] of [
      ['Отвод хозяйственно-бытовых сточных вод.', 'domestic'],
      ['Перекачка производственных сточных вод.', 'aggressive'],
      ['Отвод дождевых сточных вод с территории.', 'storm'],
    ] as const) {
      const found = extractConditionsFromBrief(page(text))
      expect(found.effluent.map((item) => item.value), text).toContain(expected)
    }
  })

  it('находка несёт цитату и страницу', () => {
    const found = extractConditionsFromBrief([
      { page: 1, text: 'Общие сведения.' },
      { page: 6, text: 'п. 12. Насосная станция II категории надёжности действия.' },
    ])
    expect(found.category[0].page).toBe(6)
    expect(found.category[0].quote).toContain('п. 12')
  })

  it('несколько кандидатов возвращаются все', () => {
    const found = extractConditionsFromBrief([
      { page: 2, text: 'ЛНС-1 — I категории надёжности.' },
      { page: 3, text: 'ЛНС-2 — II категории надёжности.' },
    ])
    expect(found.category.map((item) => item.value).sort()).toEqual(['first', 'second'])
  })

  it('пустой документ называет обе недостающие величины', () => {
    const found = extractConditionsFromBrief(page('Задание на проектирование. Общие положения.'))
    expect(found.missing).toHaveLength(2)
  })
})
