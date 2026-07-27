import type { SewerScheduleManhole } from './norms/gravity'

export interface ManholeComponentRule {
  name: string
  unit: string
  baseQuantity: number
  perMeterQuantity?: number
  catalogCode?: string
}

export interface ManholeCatalogEntry {
  typeCode: string
  minPipeDiameterMm: number
  maxPipeDiameterMm: number
  minDepthM: number
  maxDepthM: number
  chamberDiameterMm: number
  components: ManholeComponentRule[]
  source: string
  verified: boolean
}

export interface SelectedManholeConstruction {
  manholeLabel: string
  typeCode: string
  chamberDiameterMm: number
  components: Array<ManholeComponentRule & { quantity: number }>
  source: string
}

export interface ManholeCatalogParseIssue {
  row: number
  code: 'required' | 'badNumber' | 'badComponents'
}

export const MANHOLE_CATALOG_HEADERS = [
  'Тип конструкции',
  'Мин. Ø трубы, мм',
  'Макс. Ø трубы, мм',
  'Мин. глубина, м',
  'Макс. глубина, м',
  'Ø камеры, мм',
  'Состав (JSON)',
  'Источник',
  'Подтверждено',
] as const

export const MANHOLE_CATALOG_EXAMPLE: Record<string, string | number> = {
  'Тип конструкции': 'DEMO-K-1',
  'Мин. Ø трубы, мм': 100,
  'Макс. Ø трубы, мм': 400,
  'Мин. глубина, м': 1,
  'Макс. глубина, м': 3,
  'Ø камеры, мм': 1000,
  'Состав (JSON)': '[{"name":"Демо-компонент","unit":"шт","baseQuantity":1}]',
  'Источник': 'Замените на каталог/типовой проект и лист',
  'Подтверждено': 'нет',
}

function numberValue(value: unknown): number | null {
  const parsed = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function confirmed(value: unknown): boolean {
  return ['да', 'yes', 'true', '1'].includes(String(value ?? '').trim().toLowerCase())
}

function componentRules(value: unknown): ManholeComponentRule[] | null {
  try {
    const parsed = JSON.parse(String(value ?? '')) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const rules = parsed.map((item) => item as Partial<ManholeComponentRule>)
    if (rules.some((item) => !item.name || !item.unit || !Number.isFinite(item.baseQuantity))) return null
    return rules.map((item) => ({
      name: item.name!,
      unit: item.unit!,
      baseQuantity: item.baseQuantity!,
      ...(Number.isFinite(item.perMeterQuantity) ? { perMeterQuantity: item.perMeterQuantity } : {}),
      ...(item.catalogCode ? { catalogCode: item.catalogCode } : {}),
    }))
  } catch {
    return null
  }
}

export function parseManholeCatalogRows(rows: Array<Record<string, unknown>>): {
  entries: ManholeCatalogEntry[]
  issues: ManholeCatalogParseIssue[]
} {
  const entries: ManholeCatalogEntry[] = []
  const issues: ManholeCatalogParseIssue[] = []
  rows.forEach((row, index) => {
    const rowNumber = index + 2
    const typeCode = String(row['Тип конструкции'] ?? '').trim()
    if (!typeCode) return
    const numbers = [
      numberValue(row['Мин. Ø трубы, мм']),
      numberValue(row['Макс. Ø трубы, мм']),
      numberValue(row['Мин. глубина, м']),
      numberValue(row['Макс. глубина, м']),
      numberValue(row['Ø камеры, мм']),
    ]
    const source = String(row['Источник'] ?? '').trim()
    if (!source) {
      issues.push({ row: rowNumber, code: 'required' })
      return
    }
    if (numbers.some((value) => value === null || value! < 0)) {
      issues.push({ row: rowNumber, code: 'badNumber' })
      return
    }
    const components = componentRules(row['Состав (JSON)'])
    if (!components) {
      issues.push({ row: rowNumber, code: 'badComponents' })
      return
    }
    const [minPipeDiameterMm, maxPipeDiameterMm, minDepthM, maxDepthM, chamberDiameterMm] = numbers as number[]
    if (minPipeDiameterMm > maxPipeDiameterMm || minDepthM > maxDepthM || chamberDiameterMm <= 0) {
      issues.push({ row: rowNumber, code: 'badNumber' })
      return
    }
    entries.push({
      typeCode,
      minPipeDiameterMm,
      maxPipeDiameterMm,
      minDepthM,
      maxDepthM,
      chamberDiameterMm,
      components,
      source,
      verified: confirmed(row['Подтверждено']),
    })
  })
  return { entries, issues }
}

export function selectManholeConstructions(
  manholes: SewerScheduleManhole[],
  entries: ManholeCatalogEntry[],
): { selected: SelectedManholeConstruction[]; unmatched: string[] } {
  const selected: SelectedManholeConstruction[] = []
  const unmatched: string[] = []
  for (const manhole of manholes) {
    const depthM = manhole.depthMm / 1000
    const entry = entries.find((candidate) => candidate.verified
      && manhole.pipeDiameterMm >= candidate.minPipeDiameterMm
      && manhole.pipeDiameterMm <= candidate.maxPipeDiameterMm
      && depthM >= candidate.minDepthM
      && depthM <= candidate.maxDepthM)
    if (!entry) {
      unmatched.push(manhole.label)
      continue
    }
    selected.push({
      manholeLabel: manhole.label,
      typeCode: entry.typeCode,
      chamberDiameterMm: entry.chamberDiameterMm,
      source: entry.source,
      components: entry.components.map((component) => ({
        ...component,
        quantity: Math.round((component.baseQuantity + (component.perMeterQuantity ?? 0) * depthM) * 1000) / 1000,
      })),
    })
  }
  return { selected, unmatched }
}
