import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PARSER_VERSIONS, extractionAge, storedParserVersion } from './parser-versions'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const BASELINE = JSON.parse(readFileSync(new URL('../../docs/parser-baseline.json', import.meta.url), 'utf8')) as {
  parsers: Record<string, { source: string; sha256: string }>
}

/**
 * Содержимое без переводов строк, зависящих от платформы.
 *
 * ОТПЕЧАТОК СЛОМАЛСЯ ИМЕННО ЗДЕСЬ. На выкладке Windows файлы приходят с CRLF,
 * на выкладке с `core.autocrlf=input` — с LF, и sha256 одного и того же исходника
 * получается разный: 86869dc1… против cc47368b…. Проверка, красная на одной машине
 * и зелёная на другой, ловит не правку разбора, а способ выгрузки — и первым же
 * делом обвинила невиновный файл.
 *
 * Перевод строки результата разбора не меняет, поэтому его здесь и не должно быть
 * видно. Всё остальное — пробелы, комментарии, порядок строк — отпечаток меняет:
 * сторож обязан спросить, а не догадываться.
 */
function normalized(source: string): string {
  return source.replace(/\r\n/g, '\n')
}

describe('версия разбора не забывается', () => {
  /**
   * ЗАЩИТА ОТ ЗАБЫВЧИВОСТИ, А НЕ ОТ ОШИБКИ.
   *
   * Номер версии поднимают руками, и это ровно та дисциплина, на которой уже
   * трижды сгорели: правка есть, а сохранённые записи о ней не знают. Тест не
   * умеет отличить смысловую правку от косметической и не пытается — он
   * заставляет автора решить это ВСЛУХ: либо поднять версию, либо переписать
   * отпечаток. Молча пройти мимо нельзя.
   *
   * Плата названа честно: отпечаток снимается с ФАЙЛА целиком, поэтому правка
   * соседней функции того же модуля тоже потребует решения. Дешевле лишний раз
   * подтвердить, чем один раз не заметить.
   */
  it('исходник каждого разбора совпадает с записанным отпечатком', () => {
    for (const [itemId, pinned] of Object.entries(BASELINE.parsers)) {
      const source = readFileSync(new URL(pinned.source, `file://${ROOT.replace(/\\/g, '/')}`), 'utf8')
      const actual = createHash('sha256').update(normalized(source), 'utf8').digest('hex')
      expect(actual, [
        `${pinned.source} изменился, а отпечаток в docs/parser-baseline.json прежний.`,
        `Правка меняет РЕЗУЛЬТАТ разбора — поднимите PARSER_VERSIONS.${itemId}`,
        `и перепишите отпечаток. Правка косметическая — перепишите только отпечаток.`,
        `Новый: ${actual}`,
      ].join(' ')).toBe(pinned.sha256)
    }
  })

  it('отпечаток не зависит от переводов строк выкладки', () => {
    /*
      Сторож обвинил невиновный файл: на выкладке Windows отпечаток совпадал, на
      выкладке с LF — нет, и `main` был красным при пустом diff. Проверка, которая
      зависит от способа выгрузки, ловит не то, ради чего заведена.
    */
    const withCrlf = 'const a = 1\r\nconst b = 2\r\n'
    const withLf = 'const a = 1\nconst b = 2\n'
    const digest = (source: string) => createHash('sha256').update(normalized(source), 'utf8').digest('hex')
    expect(digest(withCrlf)).toBe(digest(withLf))
    // А содержательная правка отпечаток по-прежнему меняет.
    expect(digest(withLf)).not.toBe(digest('const a = 2\nconst b = 2\n'))
  })

  it('у каждой объявленной версии есть отпечаток, и наоборот', () => {
    // Разбор без отпечатка проверкой не прикрыт, отпечаток без версии
    // прикрывает несуществующее. И то и другое — тихая дыра.
    expect(Object.keys(BASELINE.parsers).sort()).toEqual(Object.keys(PARSER_VERSIONS).sort())
  })
})

describe('возраст сохранённого разбора', () => {
  it('запись без версии — «неизвестно», а не «свежая»', () => {
    // Случай владельца: в базе лежат `geology` и `survey_act`, сделанные до
    // появления версии. Подставить им текущий номер значило бы соврать, что
    // они получены сегодняшним разбором.
    const age = extractionAge('geology', { freezingDepthCandidates: [] })
    expect(age).toEqual({ kind: 'unknown', currentVersion: PARSER_VERSIONS.geology })
    expect(storedParserVersion({ freezingDepthCandidates: [] })).toBeNull()
  })

  it('устаревший разбор называет обе версии', () => {
    expect(extractionAge('geology', { parserVersion: 1 }))
      .toEqual({ kind: 'outdated', storedVersion: 1, currentVersion: 2 })
  })

  it('действующий разбор не поднимает тревогу', () => {
    expect(extractionAge('geology', { parserVersion: PARSER_VERSIONS.geology }))
      .toEqual({ kind: 'current', currentVersion: PARSER_VERSIONS.geology })
  })

  it('разбор новее кода тоже назван, а не принят за свой', () => {
    // Вкладка со старой сборкой рядом с сеансом, где разбор уже перезапущен.
    expect(extractionAge('survey_act', { parserVersion: 99 }))
      .toEqual({ kind: 'ahead', storedVersion: 99, currentVersion: 1 })
  })

  it('правка одного разбора не старит остальные', () => {
    /*
      Общая версия объявила бы устаревшим всё сразу, и предупреждению
      перестали бы верить — в третий раз. Здесь: у акта своя версия, и правка
      геологии её не трогает.
    */
    const act = { parserVersion: PARSER_VERSIONS.survey_act, diameterMm: [] }
    expect(extractionAge('survey_act', act)).toEqual({ kind: 'current', currentVersion: 1 })
    expect(extractionAge('geology', { parserVersion: 1 })).toMatchObject({ kind: 'outdated' })
  })

  it('разбора нет вовсе — говорить не о чем', () => {
    // Отличается от «разбор есть, версии нет»: во втором случае величины на
    // экране есть и про них нужно сказать.
    expect(extractionAge('geology', undefined)).toBeNull()
    expect(extractionAge('geology', null)).toBeNull()
    expect(extractionAge('geology', [1, 2])).toBeNull()
  })
})
