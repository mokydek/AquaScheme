import type { ExportInput } from './exportdata'
import { MATERIAL_LABELS } from './exportdata'

/** A bill of materials line. */
export interface SpecItem {
  pos: number
  name: string
  spec: string
  unit: string
  quantity: number
}

/**
 * Bill of materials: pipes grouped by diameter and material (total length,
 * rounded up to whole meters), plus fittings, hydrants and wells by count.
 */
export function buildSpecification(input: ExportInput): SpecItem[] {
  const material = MATERIAL_LABELS[input.material.primary] ?? input.material.primary
  const pn = `PN${input.material.pnBar}`

  const lengthByDiameter = new Map<number, number>()
  for (const pipe of input.sizing.pipes) {
    lengthByDiameter.set(
      pipe.nominalMm,
      (lengthByDiameter.get(pipe.nominalMm) ?? 0) + pipe.lengthM,
    )
  }

  const items: SpecItem[] = []
  let pos = 0
  const diameters = [...lengthByDiameter.keys()].sort((a, b) => a - b)
  for (const d of diameters) {
    pos++
    items.push({
      pos,
      name: `Труба напорная ${material}`,
      spec: `Ø${d} ${pn}`,
      unit: 'м',
      quantity: Math.ceil(lengthByDiameter.get(d) ?? 0),
    })
  }

  const counts: Array<[string, string, number]> = [
    ['Гидрант пожарный подземный', 'ГОСТ 8220', input.fittings.counts.hydrants],
    ['Задвижка запорная', 'фланцевая', input.fittings.counts.valves],
    ['Вантуз автоматический', '', input.fittings.counts.airValves],
    ['Выпуск (сброс)', '', input.fittings.counts.washouts],
    ['Колодец водопроводный', 'сборный ж/б', input.fittings.counts.wells],
  ]
  for (const [name, spec, quantity] of counts) {
    if (quantity <= 0) continue
    pos++
    items.push({ pos, name, spec, unit: 'шт', quantity })
  }

  if (input.material.needsCompensators) {
    pos++
    items.push({
      pos,
      name: 'Компенсационная вставка',
      spec: 'у колодцев и вводов',
      unit: 'шт',
      quantity: input.fittings.counts.wells + input.buildings.length,
    })
  }

  return items
}

/** Serialize the specification to a semicolon CSV with a UTF-8 BOM (Excel). */
export function specificationToCsv(items: SpecItem[]): string {
  const escape = (value: string | number): string => {
    const s = String(value)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = ['Поз.', 'Наименование', 'Тип, марка', 'Ед. изм.', 'Кол-во']
  const rows = items.map((i) => [i.pos, i.name, i.spec, i.unit, i.quantity])
  const body = [header, ...rows].map((row) => row.map(escape).join(';')).join('\r\n')
  return `﻿${body}\r\n`
}
