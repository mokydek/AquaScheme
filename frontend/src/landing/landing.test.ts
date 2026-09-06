import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ru } from '../i18n/locales/ru'
import { en } from '../i18n/locales/en'

/**
 * Главная страница не обещает того, чего в приложении нет.
 *
 * Ветка водоснабжения закрыта флагом `VITE_WATER_SUPPLY`, а лендинг продолжал
 * говорить про кольцевую сеть, EPANET, свободные напоры и гидранты — и рисовал
 * кольцо В1 с водозабором. Посетитель видит это раньше всего остального, то
 * есть первое, что программа о себе сообщала, было неправдой.
 *
 * Проверка держит СЛОВАРЬ и РИСУНОК вместе: текст правился уже дважды, а
 * картинка оставалась, потому что живёт в разметке и в поиске по словарям не
 * находится.
 */
const WATER_SUPPLY_WORDS = [
  'EPANET',
  'кольцев', 'гидрант', 'водопотреблен', 'свободн', 'водозабор',
  'ring network', 'hydrant', 'free head', 'water demand',
]

const landingText = (dictionary: unknown): string =>
  JSON.stringify((dictionary as { translation: { landing: unknown } }).translation.landing)

describe('лендинг обещает то, что приложение делает', () => {
  it('в словарях нет словаря водоснабжения', () => {
    for (const [locale, dictionary] of [['ru', ru], ['en', en]] as const) {
      const text = landingText(dictionary).toLowerCase()
      for (const word of WATER_SUPPLY_WORDS) {
        expect(text, `${locale}: лендинг обещает «${word}», а ветка В1 закрыта флагом`)
          .not.toContain(word.toLowerCase())
      }
    }
  })

  it('нормативная база названа теми документами, которые применяет движок', () => {
    // Раньше первой строкой стояло «Водоснабжение. Наружные сети и сооружения»:
    // норма не про то, что программа считает.
    const items = (ru as { translation: { landing: { norms: { items: Record<string, { code: string }> } } } })
      .translation.landing.norms.items
    const codes = Object.values(items).map((item) => item.code)
    expect(codes).toContain('СН РК 4.01-03-2013*')
    expect(codes.join(' ')).not.toContain('4.01-101-2012')
  })

  it('иллюстрация показывает профиль, а не кольцо с гидрантами', () => {
    const figure = readFileSync(new URL('./NetworkFigure.tsx', import.meta.url), 'utf8')
    const code = figure.split(/\r?\n/).filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//')
    }).join(' ')
    // Состав профиля: земля, лоток, колодцы, пикетаж.
    expect(code).toContain('invertPath')
    expect(code).toContain('groundPath')
    expect(code).toContain('ПК0+00')
    // И ничего из кольцевой схемы.
    expect(code).not.toContain('ring')
    expect(code).not.toContain('ПГ')
  })
})
