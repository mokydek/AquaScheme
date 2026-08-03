import type { PumpCatalogueItem } from './norms/pumps'

/**
 * Каталог насосов проекта.
 *
 * Марки в движок не встроены — как и конструкции колодцев. Подача, напор и
 * мощность агрегата зависят от завода и года выпуска, и подставленная по
 * умолчанию марка попала бы в спецификацию проектной документации как факт.
 * Поэтому каталог загружает проектировщик, и каждая строка несёт источник.
 *
 * Разбор повторяет каталог колодцев: строка без источника не принимается,
 * непригодная строка попадает в список замечаний, а не молча отбрасывается.
 */

export interface PumpCatalogParseIssue {
  row: number
  code: 'required' | 'badNumber'
}

export const PUMP_CATALOG_HEADERS = [
  'Марка',
  'Подача, л/с',
  'Напор, м',
  'Мощность, кВт',
  'Погружной',
  'Источник',
] as const

export const PUMP_CATALOG_EXAMPLE: Record<string, string | number> = {
  'Марка': 'DEMO-СД-1',
  'Подача, л/с': 50,
  'Напор, м': 20,
  'Мощность, кВт': 15,
  'Погружной': 'нет',
  'Источник': 'Замените на каталог завода: марка, лист, год',
}

function numberValue(value: unknown): number | null {
  const parsed = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function confirmed(value: unknown): boolean {
  return ['да', 'yes', 'true', '1'].includes(String(value ?? '').trim().toLowerCase())
}

export function parsePumpCatalogRows(rows: Array<Record<string, unknown>>): {
  entries: PumpCatalogueItem[]
  issues: PumpCatalogParseIssue[]
} {
  const entries: PumpCatalogueItem[] = []
  const issues: PumpCatalogParseIssue[] = []
  rows.forEach((row, index) => {
    // Первая строка листа — заголовок, поэтому нумерация с двух: замечание
    // должно указывать на ту строку, которую проектировщик видит в файле.
    const rowNumber = index + 2
    const designation = String(row['Марка'] ?? '').trim()
    if (!designation) return

    const source = String(row['Источник'] ?? '').trim()
    if (!source) {
      issues.push({ row: rowNumber, code: 'required' })
      return
    }

    const flowLps = numberValue(row['Подача, л/с'])
    const headM = numberValue(row['Напор, м'])
    if (flowLps === null || headM === null || flowLps <= 0 || headM <= 0) {
      issues.push({ row: rowNumber, code: 'badNumber' })
      return
    }

    // Мощность необязательна: она нужна графе «установленная мощность», но без
    // неё агрегат всё равно подбирается. Отрицательная — ошибка, а не пропуск.
    const powerKw = numberValue(row['Мощность, кВт'])
    if (powerKw !== null && powerKw < 0) {
      issues.push({ row: rowNumber, code: 'badNumber' })
      return
    }

    entries.push({
      designation,
      flowLps,
      headM,
      ...(powerKw !== null && powerKw > 0 ? { powerKw } : {}),
      ...(confirmed(row['Погружной']) ? { submersible: true } : {}),
      source,
    })
  })
  return { entries, issues }
}
