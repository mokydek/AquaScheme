import { describe, expect, it } from 'vitest'
import { extractConditionsFromText } from './conditions-text'

/** Фрагменты в том виде, в каком они стоят в техническом обследовании. */
const REPORT = `
Обследуемая канализационная сеть проходит жилой застройке. Глубина залегания
канализационных труб составляет от 3,7 до 5,2 метров. Общая протяженность
канализационной сети составляет 458,94 метра. Материал канализационной сети –
керамическая труба.
На трассе расположены железобетонные смотровые колодцы диаметром 1,5 метра.
1. Керамическая труба Ø450 мм, протяженностью 458,94 метров, без учета врезок.
2. Канализационные колодцы из сборных ж/б элементов:
колодцы Ø1,5м – 14 шт.
`

describe('чтение величин из технического обследования', () => {
  const result = extractConditionsFromText(REPORT)

  it('берёт диаметр трубы вместе с фрагментом, откуда он взят', () => {
    expect(result.diameterMm?.value).toBe(450)
    expect(result.diameterMm?.quote).toContain('Ø450 мм')
  })

  it('не путает диаметр колодца с диаметром трубы', () => {
    // «колодцы Ø1,5м» в том же документе: шаблон без единицы «мм» вернул бы 1,5.
    expect(result.diameterMm?.value).not.toBe(1.5)
    expect(result.chambers?.value).toBe(14)
  })

  it('читает протяжённость, хотя между словом и числом стоит «составляет»', () => {
    expect(result.lengthM?.value).toBe(458.94)
  })

  it('читает материал', () => {
    expect(result.material?.value).toBe('керамическая')
  })

  it('глубина залегания за длину не принимается', () => {
    // «от 3,7 до 5,2 метров» стоит в том же абзаце и оканчивается на «метров».
    expect(result.lengthM?.value).not.toBe(3.7)
    expect(result.lengthM?.value).not.toBe(5.2)
  })

  it('ничего не найдено — величин нет, а не подставлены умолчания', () => {
    const empty = extractConditionsFromText('Договор подряда на выполнение работ.')
    expect(empty.diameterMm).toBeNull()
    expect(empty.lengthM).toBeNull()
    expect(empty.chambers).toBeNull()
    expect(empty.missing).toHaveLength(4)
  })

  it('пустой ввод не роняет разбор', () => {
    expect(extractConditionsFromText('').missing).toHaveLength(4)
    expect(extractConditionsFromText(undefined as unknown as string).diameterMm).toBeNull()
  })

  it('противоречие в документе называется, а не разрешается молча', () => {
    const conflicting = extractConditionsFromText(
      'Труба Ø450 мм на участке 1. Труба Ø300 мм на участке 2.')
    expect(conflicting.diameterMm?.value).toBe(450)
    expect(conflicting.ambiguous.join(' ')).toContain('300')
  })

  it('кириллица в окончаниях не мешает: «протяженностью» ловится', () => {
    // `\\w` в JavaScript покрывает только латиницу, и шаблон с ним промахивался.
    const short = extractConditionsFromText('Труба протяженностью 120,5 метров.')
    expect(short.lengthM?.value).toBe(120.5)
  })

  it('длинное тире в строке колодцев работает так же, как короткое', () => {
    for (const dash of ['-', '–', '—']) {
      const text = `колодцы Ø1,5м ${dash} 14 шт`
      expect(extractConditionsFromText(text).chambers?.value, dash).toBe(14)
    }
  })
})
