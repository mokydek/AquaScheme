import { describe, expect, it } from 'vitest'
import { extractConditionsFromTu, unparsedNumericLines } from './conditions-tu'

const pages = (text: string, page = 1) => [{ page, text }]

describe('строки с числами, которые шаблоны не разобрали', () => {
  it('строка с разрушенным якорем попадает в список: буква потеряна, число нет', () => {
    // Вид строки, на которой шаблон «Д=» не срабатывает, а число прочитано.
    const text = '0=450 00'
    const found = extractConditionsFromTu(pages(text))
    expect(found.designDiameterMm).toEqual([])

    const lines = unparsedNumericLines(pages(text), found)
    expect(lines).toHaveLength(1)
    expect(lines[0].numbers).toContain(450)
    expect(lines[0].trace).toContain('перед числом')
  })

  it('цифровой текст списка не даёт: величина уже прочитана шаблоном', () => {
    const text = 'Проложить коллектор Д=450 мм.'
    const found = extractConditionsFromTu(pages(text))
    expect(found.designDiameterMm[0].value).toBe(450)
    expect(unparsedNumericLines(pages(text), found)).toEqual([])
  })

  it('строка без следа якоря не показывается: это не потерянная находка', () => {
    const text = 'Срок действия условий 730 дней.'
    const lines = unparsedNumericLines(pages(text), extractConditionsFromTu(pages(text)))
    expect(lines).toEqual([])
  })

  it('число вне диаметрового ряда строку не поднимает', () => {
    const text = '0=45 00'
    const lines = unparsedNumericLines(pages(text), extractConditionsFromTu(pages(text)))
    expect(lines).toEqual([])
  })

  it('искажённое «мм» после числа тоже след', () => {
    for (const text of ['Труба 500 00', 'Труба 500 MM', 'Труба 500 мн']) {
      const lines = unparsedNumericLines(pages(text), extractConditionsFromTu(pages(text)))
      expect(lines.length, text).toBe(1)
      expect(lines[0].trace, text).toContain('после числа')
    }
  })

  it('находка несёт страницу и цитату как распозналась', () => {
    const lines = unparsedNumericLines([
      { page: 1, text: 'Общие положения.' },
      { page: 4, text: 'п. 25. 0=450 00' },
    ], extractConditionsFromTu([{ page: 4, text: 'п. 25. 0=450 00' }]))
    expect(lines[0].page).toBe(4)
    expect(lines[0].quote).toContain('п. 25')
  })

  it('несколько чисел в строке показываются все: выбирает инженер', () => {
    const text = '0=450 00, врезка 0=300 00'
    const lines = unparsedNumericLines(pages(text), extractConditionsFromTu(pages(text)))
    expect(lines[0].numbers.sort()).toEqual([300, 450])
  })
})

describe('оговорка документа делает величину предварительной', () => {
  it('«уточнить при проектировании» помечает диаметр', () => {
    // Оборот из настоящего задания на проектирование: документ сам называет
    // величину приближением и требует уточнить её расчётом.
    const text = 'Выполнить проектирование коллектора диаметром 800 мм\n'
      + 'ориентировочной протяжённостью 12 км (диаметр и протяжённость\n'
      + 'уточнить при проектировании).'
    const found = extractConditionsFromTu(pages(text))
    expect(found.designDiameterMm[0].value).toBe(800)
    expect(found.designDiameterMm[0].preliminary).toBeDefined()
  })

  it('оговорка видна и через строку: ищется окном, а не по одной строке', () => {
    const text = 'Коллектор диаметром 800 мм.\nПротяжённость 12 км.\n'
      + 'Диаметр подлежит уточнению.'
    const found = extractConditionsFromTu(pages(text))
    expect(found.designDiameterMm[0].preliminary).toContain('уточнени')
  })

  it('величина без оговорок предварительной не становится', () => {
    const text = 'Проложить коллектор Д=450 мм согласно техническим условиям.'
    const found = extractConditionsFromTu(pages(text))
    expect(found.designDiameterMm[0].value).toBe(450)
    expect(found.designDiameterMm[0].preliminary).toBeUndefined()
  })

  it('просвет с оговоркой тоже помечается', () => {
    const text = 'При пересечении с водопроводом в свету не менее 0,2 м\n(предварительно, уточнить при проектировании).'
    const found = extractConditionsFromTu(pages(text))
    expect(found.requiredClearanceM[0].value).toBe(0.2)
    expect(found.requiredClearanceM[0].preliminary).toBeDefined()
  })

  it('неразобранная строка несёт оговорку так же', () => {
    const text = '0=800 00 ориентировочной протяженность - 12'
    const lines = unparsedNumericLines(pages(text), extractConditionsFromTu(pages(text)))
    expect(lines[0].preliminary).toContain('риентировочн')
  })

  it('«согласовать» и «принять» предварительности не означают', () => {
    const text = 'Принять коллектор Д=450 мм и согласовать с владельцем сети.'
    const found = extractConditionsFromTu(pages(text))
    expect(found.designDiameterMm[0].preliminary).toBeUndefined()
  })
})
