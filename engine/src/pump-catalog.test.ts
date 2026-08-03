import { describe, expect, it } from 'vitest'
import { PUMP_CATALOG_EXAMPLE, PUMP_CATALOG_HEADERS, parsePumpCatalogRows } from './pump-catalog'
import { selectPumps } from './norms/pumps'

const row = (over: Record<string, unknown> = {}) => ({
  'Марка': 'СД 250/22.5',
  'Подача, л/с': 69,
  'Напор, м': 22.5,
  'Мощность, кВт': 30,
  'Погружной': 'нет',
  'Источник': 'Каталог завода, лист 12',
  ...over,
})

describe('каталог насосов проекта', () => {
  it('разбирает строку целиком', () => {
    const { entries, issues } = parsePumpCatalogRows([row()])
    expect(issues).toEqual([])
    expect(entries).toEqual([{
      designation: 'СД 250/22.5',
      flowLps: 69,
      headM: 22.5,
      powerKw: 30,
      source: 'Каталог завода, лист 12',
    }])
  })

  it('без источника строку не принимает', () => {
    // Марка без источника попала бы в спецификацию как факт, которого никто не
    // подтверждал. То же правило, что и в каталоге колодцев.
    const { entries, issues } = parsePumpCatalogRows([row({ 'Источник': '  ' })])
    expect(entries).toEqual([])
    expect(issues).toEqual([{ row: 2, code: 'required' }])
  })

  it('нулевые и нечисловые подачу и напор отбраковывает с указанием строки', () => {
    const { entries, issues } = parsePumpCatalogRows([
      row({ 'Подача, л/с': 0 }),
      row({ 'Напор, м': 'высокий' }),
      row({ 'Мощность, кВт': -5 }),
    ])
    expect(entries).toEqual([])
    expect(issues.map((issue) => issue.row)).toEqual([2, 3, 4])
    expect(issues.every((issue) => issue.code === 'badNumber')).toBe(true)
  })

  it('запятая как разделитель дробной части читается', () => {
    const { entries } = parsePumpCatalogRows([row({ 'Напор, м': '22,5' })])
    expect(entries[0].headM).toBe(22.5)
  })

  it('мощность необязательна, погружной агрегат отмечается', () => {
    const { entries } = parsePumpCatalogRows([row({ 'Мощность, кВт': '', 'Погружной': 'да' })])
    expect(entries[0].powerKw).toBeUndefined()
    expect(entries[0].submersible).toBe(true)
  })

  it('пустая строка без марки пропускается молча, а не считается ошибкой', () => {
    // Лист из Excel почти всегда несёт хвост пустых строк.
    const { entries, issues } = parsePumpCatalogRows([{}, { 'Марка': '' }, row()])
    expect(entries).toHaveLength(1)
    expect(issues).toEqual([])
  })

  it('шаблон разбирается сам собой и остаётся неподтверждённым по источнику', () => {
    const { entries, issues } = parsePumpCatalogRows([{ ...PUMP_CATALOG_EXAMPLE }])
    expect(issues).toEqual([])
    expect(entries[0].designation).toBe('DEMO-СД-1')
    expect(entries[0].source).toMatch(/Замените/)
    for (const header of PUMP_CATALOG_HEADERS) {
      expect(Object.keys(PUMP_CATALOG_EXAMPLE)).toContain(header)
    }
  })

  it('разобранный каталог годится для подбора без переделки', () => {
    const { entries } = parsePumpCatalogRows([
      row({ 'Марка': 'мал', 'Подача, л/с': 20, 'Напор, м': 30 }),
      row({ 'Марка': 'впору', 'Подача, л/с': 70, 'Напор, м': 24 }),
      row({ 'Марка': 'избыточный', 'Подача, л/с': 70, 'Напор, м': 60 }),
    ])
    const selection = selectPumps({
      designFlowLps: 69,
      requiredHeadM: 22.5,
      category: 'first',
      effluent: 'domestic',
      catalogue: entries,
    })
    expect(selection.ok).toBe(true)
    expect(selection.pump?.designation).toBe('впору')
  })
})
