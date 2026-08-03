import { describe, expect, it } from 'vitest'
import { titleBlockContentFrom } from './titleBlockContent'

const ROLES = ['Разраб.', 'Пров.', 'Н.контр.', 'ГИП']

describe('графы 9–13 основной надписи', () => {
  it('пустая карточка не создаёт ни организации, ни подписантов', () => {
    // Пустая графа честнее выдуманной: приложение не назначает ответственного.
    expect(titleBlockContentFrom('', ROLES, {}, {})).toEqual({})
    expect(titleBlockContentFrom('   ', ROLES, { 'ГИП': '  ' }, { 'ГИП': ' ' })).toEqual({})
  })

  it('роль без фамилии и даты в штамп не идёт', () => {
    const content = titleBlockContentFrom('ТОО «Проектировщик»', ROLES,
      { 'Разраб.': 'Иванов', 'ГИП': 'Петров' },
      { 'Разраб.': '08.26' })
    expect(content.organisation).toBe('ТОО «Проектировщик»')
    expect(content.signatories).toEqual([
      { role: 'Разраб.', name: 'Иванов', date: '08.26' },
      { role: 'ГИП', name: 'Петров' },
    ])
  })

  it('дата без фамилии сохраняется: человек ещё не назначен, срок уже есть', () => {
    const content = titleBlockContentFrom('', ROLES, {}, { 'Н.контр.': '09.26' })
    expect(content.signatories).toEqual([{ role: 'Н.контр.', date: '09.26' }])
    expect(content.organisation).toBeUndefined()
  })

  it('пробелы по краям снимаются, порядок ролей сохраняется', () => {
    const content = titleBlockContentFrom('  ТОО  ', ROLES,
      { 'ГИП': ' Петров ', 'Разраб.': 'Иванов' }, {})
    expect(content.organisation).toBe('ТОО')
    expect(content.signatories?.map((item) => item.role)).toEqual(['Разраб.', 'ГИП'])
    expect(content.signatories?.[1].name).toBe('Петров')
  })
})
