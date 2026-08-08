import { describe, expect, it } from 'vitest'
import { extractConditionsFromTu } from './conditions-tu'

const page = (text: string, no = 1) => [{ page: no, text }]

describe('величины из технических условий', () => {
  it('читает все встречающиеся формы записи диаметра', () => {
    for (const [text, expected] of [
      ['Проложить трубопровод Д=450 мм по ул. Станкевича.', 450],
      ['Трубопровод DN400 из полиэтилена.', 400],
      ['Предусмотреть коллектор диаметром 400 мм.', 400],
      ['Врезка в существующий коллектор ⌀500.', 500],
      ['Проектный диаметр Ø 500 мм.', 500],
    ] as const) {
      const found = extractConditionsFromTu(page(text))
      expect(found.designDiameterMm.map((item) => item.value), text).toContain(expected)
    }
  })

  it('каждая находка несёт цитату строки и номер страницы', () => {
    const found = extractConditionsFromTu([
      { page: 1, text: 'Общие положения.' },
      { page: 3, text: 'п. 25. Проложить коллектор Д=450 мм.' },
    ])
    expect(found.designDiameterMm).toHaveLength(1)
    expect(found.designDiameterMm[0].page).toBe(3)
    expect(found.designDiameterMm[0].quote).toContain('п. 25')
  })

  it('несколько кандидатов возвращаются все, выбор не делается', () => {
    const found = extractConditionsFromTu([
      { page: 2, text: 'Участок 1 — Д=450 мм.' },
      { page: 4, text: 'Участок 2 — DN600.' },
    ])
    expect(found.designDiameterMm.map((item) => item.value).sort()).toEqual([450, 600])
  })

  it('одна строка не удваивается двумя шаблонами', () => {
    // «Ø450 мм» подходит и шаблону Ø, и шаблону «диаметром» — находка одна.
    const found = extractConditionsFromTu(page('Труба диаметром Ø450 мм.'))
    expect(found.designDiameterMm).toHaveLength(1)
  })

  it('числа вне ряда диаметров не считаются диаметром', () => {
    const found = extractConditionsFromTu(page('Условия действительны до 2027 года. Отметка 685,20 м.'))
    expect(found.designDiameterMm).toEqual([])
    expect(found.missing).toContain('проектный диаметр')
  })

  it('перечень допустимых диаметров читается рядом', () => {
    const found = extractConditionsFromTu(page('Допускаются диаметры: 300, 400, 500 мм.'))
    expect(found.allowedDiametersMm[0].value).toEqual([300, 400, 500])
  })

  it('одиночное число перечнем не считается', () => {
    const found = extractConditionsFromTu(page('Диаметр: 400 мм.'))
    expect(found.allowedDiametersMm).toEqual([])
  })

  it('просвет берётся только рядом со словами о пересечении', () => {
    const near = extractConditionsFromTu(page(
      'При пересечении с существующими сетями обеспечить в свету не менее 0,2 м.'))
    expect(near.requiredClearanceM[0].value).toBeCloseTo(0.2, 6)

    // То же число в другом контексте — это не просвет, а заглубление.
    const far = extractConditionsFromTu(page('Заглубление от планировочной отметки не менее 0,2 м.'))
    expect(far.requiredClearanceM).toEqual([])
    expect(far.missing).toContain('требуемый просвет в пересечении')
  })

  it('число крупнее двух метров просветом не считается', () => {
    const found = extractConditionsFromTu(page(
      'При пересечении с автодорогой длина футляра не менее 10 м.'))
    expect(found.requiredClearanceM).toEqual([])
  })

  it('пустой документ даёт пустой результат и называет недостающее', () => {
    const found = extractConditionsFromTu([])
    expect(found.designDiameterMm).toEqual([])
    expect(found.missing).toHaveLength(2)
  })
})
