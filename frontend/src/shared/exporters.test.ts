import { describe, expect, it } from 'vitest'
import type { SelectedManholeConstruction, SewerSchedule } from '@aquascheme/engine'
import { generateSewerScheduleXlsx } from './exporters'

const schedule: SewerSchedule = {
  manholes: [{ label: 'К-1', picket: 'ПК1+25', depthMm: 2500, pipeDiameterMm: 500 }],
  pipes: [{ designation: 'Труба тестовая', diameterMm: 500, lengthM: 125, agskCode: 'TEST-PIPE' }],
  totalPipeLengthM: 125,
}

const constructions: SelectedManholeConstruction[] = [{
  manholeLabel: 'К-1',
  typeCode: 'TEST-WELL',
  chamberDiameterMm: 1500,
  source: 'Каталог, лист 7',
  components: [
    { name: 'Кольцо', unit: 'шт', baseQuantity: 1, catalogCode: 'RING', quantity: 3 },
    { name: 'Плита', unit: 'шт', baseQuantity: 1, catalogCode: 'SLAB', quantity: 1 },
  ],
}]

describe('working schedule XLSX', () => {
  it('exports selected construction provenance and calculated component quantities', async () => {
    const XLSX = await import('xlsx')
    const bytes = await generateSewerScheduleXlsx(schedule, constructions)
    const workbook = XLSX.read(bytes)
    expect(workbook.SheetNames).toEqual(['Колодцы', 'Трубы', 'Элементы колодцев', 'Итоги по колодцам'])
    const wells = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Колодцы'])
    expect(wells[0]['Тип конструкции']).toBe('TEST-WELL')
    expect(wells[0]['Источник конструкции']).toBe('Каталог, лист 7')
    const totals = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['Итоги по колодцам'])
    expect(totals).toEqual(expect.arrayContaining([
      expect.objectContaining({ 'Код': 'RING', 'Количество': 3 }),
      expect.objectContaining({ 'Код': 'SLAB', 'Количество': 1 }),
    ]))
  })
})
