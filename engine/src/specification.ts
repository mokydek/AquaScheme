import type { ExportInput } from './exportdata'
import { MATERIAL_LABELS } from './exportdata'
import { agskSectionForFitting, agskSectionForPipe } from './norms/agsk'

/** A bill of materials line. */
export interface SpecItem {
  pos: number
  name: string
  spec: string
  unit: string
  quantity: number
  /** External position code (from the active catalog or VGSK), if any. */
  code?: string
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

  // «Код продукции» (ГОСТ 21.110) references the АГСК-3 catalogue section for
  // the material category; the exact per-size position is selected from that
  // section by the engineer (we do not invent 7-digit position codes).
  const pipeAgsk = agskSectionForPipe(input.material.primary).code

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
      code: pipeAgsk,
    })
  }

  const counts: Array<[string, string, number, string]> = [
    ['Гидрант пожарный подземный', 'ГОСТ 8220', input.fittings.counts.hydrants, agskSectionForFitting('hydrant').code],
    ['Задвижка запорная', 'фланцевая', input.fittings.counts.valves, agskSectionForFitting('valve').code],
    ['Вантуз автоматический', '', input.fittings.counts.airValves, agskSectionForFitting('airValve').code],
    ['Выпуск (сброс)', '', input.fittings.counts.washouts, agskSectionForFitting('washout').code],
    ['Колодец водопроводный', 'сборный ж/б', input.fittings.counts.wells, agskSectionForFitting('well').code],
  ]
  for (const [name, spec, quantity, code] of counts) {
    if (quantity <= 0) continue
    pos++
    items.push({ pos, name, spec, unit: 'шт', quantity, code })
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

/**
 * Column titles of the specification per ГОСТ 21.110-2013, форма 1 (НБ3,
 * verified against docs/norms/gost-21-110-2013-specifikaciya.pdf).
 */
export const SPEC_COLUMNS = [
  'Поз.',
  'Наименование и техническая характеристика',
  'Тип, марка, обозначение документа, опросного листа',
  'Код продукции',
  'Ед. измерения',
  'Кол.',
] as const

/** Serialize the specification to a semicolon CSV with a UTF-8 BOM (Excel). */
export function specificationToCsv(items: SpecItem[]): string {
  const escape = (value: string | number): string => {
    const s = String(value)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = items.map((i) => [i.pos, i.name, i.spec, i.code ?? '', i.unit, i.quantity])
  const body = [SPEC_COLUMNS as unknown as string[], ...rows]
    .map((row) => row.map(escape).join(';'))
    .join('\r\n')
  return `﻿${body}\r\n`
}
