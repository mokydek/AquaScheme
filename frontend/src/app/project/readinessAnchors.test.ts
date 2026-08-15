import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { READINESS_SECTIONS } from '@aquascheme/engine'

/**
 * Ссылка-переход обязана вести в существующий раздел.
 *
 * Замечание, называющее раздел словами, оставляет владельца искать его
 * прокруткой; замечание со ссылкой на несуществующий якорь — хуже, оно ведёт
 * в никуда и выглядит при этом рабочим. Соответствие проверяется здесь, а не
 * глазами: карта разделов живёт в движке, якоря — в компонентах, и разойтись
 * они могут молча.
 *
 * Разбор статический — так же, как сам реестр кодов сверяется со шлюзом:
 * поднимать всю страницу проекта ради списка идентификаторов незачем.
 */

const HERE = join(process.cwd(), 'frontend', 'src', 'app', 'project')

const declaredAnchors = (): Set<string> => {
  const found = new Set<string>()
  for (const name of readdirSync(HERE)) {
    if (!name.endsWith('.tsx')) continue
    const source = readFileSync(join(HERE, name), 'utf8')
    for (const match of source.matchAll(/<Panel\s+anchor="([a-z-]+)"/g)) found.add(match[1])
    // Секция с многострочным объявлением свойств.
    for (const match of source.matchAll(/^\s+anchor="([a-z-]+)"$/gm)) found.add(match[1])
  }
  return found
}

describe('переходы из списка готовности', () => {
  it('каждый якорь карты разделов существует на странице проекта', () => {
    const onPage = declaredAnchors()
    const wanted = [...new Set(Object.values(READINESS_SECTIONS).map((target) => target.anchor))].sort()
    expect(wanted.length).toBeGreaterThan(8)
    const missing = wanted.filter((anchor) => !onPage.has(anchor))
    expect(missing, `якоря без раздела на странице: ${missing.join(', ')}`).toEqual([])
  })

  it('у каждой причины названы и раздел, и действие', () => {
    // «Где снимается» без «что сделать» — половина подсказки: владелец
    // доходит до раздела и снова остаётся перед «не решено».
    const incomplete = Object.entries(READINESS_SECTIONS)
      .filter(([, target]) => !target.title.trim() || !target.anchor.trim() || !target.action.trim())
      .map(([code]) => code)
    expect(incomplete, `причины без раздела или действия: ${incomplete.join(', ')}`).toEqual([])
  })

  it('действие сформулировано глаголом, а не «проверьте»', () => {
    // Подсказка обязана называть действие. «Проверьте» и «убедитесь» —
    // не действие: после них владелец знает ровно столько же.
    const vague = Object.entries(READINESS_SECTIONS)
      .filter(([, target]) => /^(?:проверьте|убедитесь|уточните)\b/i.test(target.action))
      .map(([code]) => code)
    expect(vague, `подсказки без действия: ${vague.join(', ')}`).toEqual([])
  })
})
