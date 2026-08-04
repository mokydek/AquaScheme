import { describe, expect, it } from 'vitest'
import { linetypeRole, summarizeLinetypeRoles } from './linetype-roles'

const seg = (lineType: string, layer = '0') => ({ layer, lineType })

describe('роль по типу линии', () => {
  it('узнаёт обозначения реального чертежа', () => {
    // Имена с топоосновы Талдыколя: слой «0» несёт напорную канализацию.
    expect(linetypeRole('KANALIZ_NAP').role).toBe('utility')
    expect(linetypeRole('VOD_LINE').role).toBe('utility')
    expect(linetypeRole('VODOPROVOD').role).toBe('utility')
  })

  it('забор и растительность названы не инженерными, а не нераспознанными', () => {
    // Это не пробел в данных, а известный ответ.
    for (const name of ['ZABOR_MET', 'ograzhdenie', 'KUSTARNIK']) {
      expect(linetypeRole(name), name).toEqual({ role: null, nonEngineering: true, standard: false })
    }
  })

  it('стандартные типы AutoCAD роли не несут и решения не требуют', () => {
    // Ими рисуют что угодно; вывести из них роль значило бы угадать. Но и в
    // список «решает инженер» они не идут: на Талдыколе Continuous стоит у
    // 4243 сегментов и хоронил под собой 19 настоящих неизвестных имён.
    for (const name of ['Continuous', 'ByLayer', 'HIDDEN', 'DASHED', 'DOT', 'CENTER', '']) {
      expect(linetypeRole(name), name).toEqual({ role: null, nonEngineering: false, standard: true })
    }
  })

  it('труба и откос узнаются', () => {
    expect(linetypeRole('TRUB_LINE').role).toBe('utility')
    expect(linetypeRole('OTKOS').role).toBe('terrain')
  })

  it('регистр и разделители значения не имеют', () => {
    for (const name of ['kanaliz_nap', 'KANALIZ_NAP', ' Kanaliz_Nap ']) {
      expect(linetypeRole(name).role, name).toBe('utility')
    }
  })

  it('незнакомое имя не угадывается', () => {
    for (const name of ['71315000', 'STRIH_1']) {
      expect(linetypeRole(name), name).toEqual({ role: null, nonEngineering: false, standard: false })
    }
  })

  it('слой с назначенной ролью не перебивается типом линии', () => {
    // Имя слоя — прямое утверждение съёмщика; косвенный признак важнее быть
    // не может, иначе назначение роли в таблице перестало бы что-то значить.
    const summary = summarizeLinetypeRoles(
      [seg('KANALIZ_NAP', 'РЕЛЬЕФ'), seg('KANALIZ_NAP', '0')],
      { 'РЕЛЬЕФ': 'terrain', '0': 'unknown' },
    )
    expect(summary.byRole).toEqual([{ role: 'utility', lineTypes: ['KANALIZ_NAP'], segments: 1 }])
  })

  it('слой без записи в таблице ролей считается неизвестным', () => {
    const summary = summarizeLinetypeRoles([seg('VOD_LINE', 'новый слой')], {})
    expect(summary.byRole[0].segments).toBe(1)
  })

  it('считает сегменты по ролям и по типам', () => {
    const summary = summarizeLinetypeRoles([
      seg('KANALIZ_NAP'), seg('KANALIZ_NAP'), seg('VOD_LINE'),
      seg('ZABOR_MET'), seg('71315000'), seg('71315000'),
    ], { '0': 'unknown' })
    expect(summary.byRole).toEqual([
      { role: 'utility', lineTypes: ['KANALIZ_NAP', 'VOD_LINE'], segments: 3 },
    ])
    expect(summary.nonEngineering).toEqual([{ lineType: 'ZABOR_MET', segments: 1 }])
    expect(summary.unrecognized).toEqual([{ lineType: '71315000', segments: 2, layers: ['0'] }])
    expect(summary.reason).toMatch(/utility — 3/)
  })

  it('нераспознанный тип называет слои, где встретился', () => {
    const summary = summarizeLinetypeRoles(
      [seg('STRIH_1', '0'), seg('STRIH_1', 'прочее')],
      { '0': 'unknown', 'прочее': 'unknown' },
    )
    expect(summary.unrecognized[0].layers).toEqual(['0', 'прочее'])
  })

  it('стандартный и пустой тип в нераспознанные не идут', () => {
    const summary = summarizeLinetypeRoles(
      [seg(''), seg('  '), seg('Continuous'), seg('HIDDEN')], { '0': 'unknown' })
    expect(summary.unrecognized).toEqual([])
    expect(summary.reason).toMatch(/роль не выведена ни для одного сегмента/)
  })
})

describe('короткие корни не совпадают внутри слова', () => {
  it('ЛЭП и телефон узнаются по началу имени', () => {
    expect(linetypeRole('LAP10').role).toBe('utility')
    expect(linetypeRole('LEP_10KV').role).toBe('utility')
    expect(linetypeRole('TELEFON').role).toBe('utility')
  })

  it('слово, случайно содержащее корень, ролью не наделяется', () => {
    // Иначе «OVERLAP» стал бы линией электропередачи.
    expect(linetypeRole('OVERLAP').role).toBeNull()
    expect(linetypeRole('HOTEL').role).toBeNull()
  })
})
