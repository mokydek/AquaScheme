import { describe, expect, it } from 'vitest'
import { parseUtilityMark, UTILITY_MARK_REGISTRY } from './utility-marks'

/**
 * Марки взяты из настоящей топосъёмки объекта — из подписей DXF, а не
 * придуманы. Проверки закрепляют именно те начертания, которые встретились.
 */

describe('вид сети из марки', () => {
  it('ППУ — теплосеть, и видно, по чему это решено', () => {
    const mark = parseUtilityMark('ППУ1020/1200')
    expect(mark.kind).toBe('heat')
    expect(mark.kindEvidence).toBe('ППУ')
  })

  it('пара «рабочий/наружный» читается как труба и оболочка', () => {
    expect(parseUtilityMark('ППУ1020/1200')).toMatchObject({ sizeMm: 1020, outerMm: 1200 })
    expect(parseUtilityMark('ППУ426/630')).toMatchObject({ sizeMm: 426, outerMm: 630 })
    expect(parseUtilityMark('ППУ273/400')).toMatchObject({ sizeMm: 273, outerMm: 400 })
  })

  it('ПВХ — трубопровод, но вид сети маркой не назван', () => {
    const mark = parseUtilityMark('пвх600')
    expect(mark.kind).toBe('pipe')
    expect(mark.sizeMm).toBe(600)
  })

  it('ведущий счётчик не становится габаритом', () => {
    expect(parseUtilityMark('2тр.пвх100')).toMatchObject({ kind: 'pipe', count: 2, sizeMm: 100 })
    expect(parseUtilityMark('2тр.пвх110')).toMatchObject({ count: 2, sizeMm: 110 })
  })

  it('кабель: напряжение читается, габарит — нет, его в марке нет', () => {
    const mark = parseUtilityMark('1каб.10кВ-0.7')
    expect(mark.kind).toBe('cable')
    expect(mark.count).toBe(1)
    expect(mark.voltageKv).toBe(10)
    expect(mark.sizeMm).toBeUndefined()
  })

  it('хвост за напряжением не истолковывается, а показывается', () => {
    // «-0.7» очень похоже на глубину заложения. Похоже — не основание.
    expect(parseUtilityMark('1каб.10кВ-0.7').unparsedTail).toBe('-0.7')
    expect(parseUtilityMark('1каб.10кв-0,8').unparsedTail).toBe('-0,8')
  })

  it('пучок кабелей 110 кВ', () => {
    expect(parseUtilityMark('6каб.110кВ')).toMatchObject({ kind: 'cable', count: 6, voltageKv: 110 })
  })

  it('дробное напряжение через запятую', () => {
    expect(parseUtilityMark('1каб.0,4кВ').voltageKv).toBe(0.4)
  })

  it('ВОЛС — связь, а не силовой кабель, хотя в марке есть «каб»', () => {
    expect(parseUtilityMark('1кабВОЛС').kind).toBe('communication')
  })

  it('гильза — футляр, а не стальная труба, хотя в марке есть «ст»', () => {
    expect(parseUtilityMark('гильза ст1420')).toMatchObject({ kind: 'casing', sizeMm: 1420 })
  })

  it('кабельная канализация — короб, а не линия', () => {
    expect(parseUtilityMark('каб.канал').kind).toBe('cableDuct')
    expect(parseUtilityMark('стр.каб.канал').kind).toBe('cableDuct')
  })

  it('колодцы называют вид сети словом', () => {
    expect(parseUtilityMark('кол.Лив').kind).toBe('storm')
    expect(parseUtilityMark('кол.Кан').kind).toBe('sewer')
    expect(parseUtilityMark('кол.вод.').kind).toBe('water')
  })

  it('«кан» в «канале» канализацией не делает', () => {
    expect(parseUtilityMark('каб.канал').kind).not.toBe('sewer')
  })

  it('железобетонная труба — самая частая марка этой съёмки, 59 подписей', () => {
    expect(parseUtilityMark('ж/б1600')).toMatchObject({ kind: 'pipe', sizeMm: 1600 })
  })

  it('«ж/б канал» остаётся нераспознанным: кабельный он или тепловой — марка не говорит', () => {
    expect(parseUtilityMark('ж/б канал').kind).toBeNull()
  })

  it('материал берётся у существующего разбора, а не заводится заново', () => {
    // Таблицу материалов знает `parsePipeLabel`; здесь она не повторяется.
    expect(parseUtilityMark('пвх600').material).toBe('поливинилхлорид')
    expect(parseUtilityMark('ж/б1600').material).toBe('железобетон')
    expect(parseUtilityMark('2тр.пвх100').material).toBe('поливинилхлорид')
  })

  it('газопровод', () => {
    expect(parseUtilityMark('Газопровод подземный').kind).toBe('gas')
  })
})

describe('чего в марке нет, того и не появляется', () => {
  it('номер камеры трубой не становится', () => {
    // «камера 119» — подпись сооружения. Ø119 из неё вывести нельзя.
    const mark = parseUtilityMark('камера 119')
    expect(mark.kind).toBeNull()
    expect(mark.sizeMm).toBeUndefined()
  })

  it('число вне ряда габаритов не берётся', () => {
    expect(parseUtilityMark('пвх9999').sizeMm).toBeUndefined()
    expect(parseUtilityMark('пвх5').sizeMm).toBeUndefined()
  })

  it('габарит берётся только там, где вид его несёт', () => {
    // Опознанный вид — и есть основание считать число рядом с материалом
    // диаметром. Без вида число остаётся числом.
    expect(parseUtilityMark('камера 119').sizeMm).toBeUndefined()
    expect(parseUtilityMark('котлован -5.0').sizeMm).toBeUndefined()
    expect(parseUtilityMark('пвх600').sizeMm).toBe(600)
  })

  it('нераспознанная марка возвращается с kind: null, а не молча пустой', () => {
    // Список таких марок для инженера ещё не сделан — см. отчёт захода 7.
    expect(parseUtilityMark('зам.')).toMatchObject({ raw: 'зам.', kind: null })
    expect(parseUtilityMark('ковер').kind).toBeNull()
  })

  it('владелец сети из марки не выводится вовсе', () => {
    const mark = parseUtilityMark('ППУ1020/1200')
    expect(Object.keys(mark)).not.toContain('owner')
  })
})

describe('реестр соответствий', () => {
  it('каждая запись несёт смысл и марку, на которой наблюдалась', () => {
    for (const entry of UTILITY_MARK_REGISTRY) {
      expect(entry.meaning.length).toBeGreaterThan(5)
      expect(entry.seen.length).toBeGreaterThan(0)
      // Признак обязан срабатывать на своей же марке — иначе запись мертва.
      expect(entry.pattern.test(entry.seen)).toBe(true)
    }
  })

  it('узкие признаки стоят раньше общих', () => {
    const index = (kind: string) => UTILITY_MARK_REGISTRY.findIndex((entry) => entry.kind === kind)
    expect(index('communication')).toBeLessThan(index('cable'))
    expect(index('casing')).toBeLessThan(index('pipe'))
    expect(index('cableDuct')).toBeLessThan(index('cable'))
  })
})
