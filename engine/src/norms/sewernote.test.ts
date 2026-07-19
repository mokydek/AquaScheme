import { describe, expect, it } from 'vitest'
import { buildSewerNoteDoc } from './sewernote'
import type { GravityNetworkResult } from './gravity'

const RESULT: GravityNetworkResult = {
  kind: 'gravity',
  systemType: 'storm',
  pipes: [
    { id: 'P1', fromNode: 'A', toNode: 'B', lengthM: 100, diameterMm: 2000, slope: 0.0008, fillRatio: 0.9, velocityMs: 0.8, flowLps: 2300, issues: [] },
  ],
  outletFlowLps: 2300,
  profile: null,
}

describe('buildSewerNoteDoc', () => {
  it('carries all sections including the ASUTP and landscaping frameworks', () => {
    const doc = buildSewerNoteDoc({
      projectName: 'Тест',
      dateIso: '2026-07-20T00:00:00Z',
      system: 'storm',
      result: RESULT,
      spec: [
        { pos: 1, name: 'Труба железобетонная безнапорная', spec: 'Ду2000', unit: 'м', quantity: 100 },
        { pos: 2, name: 'Решётка защитная с антикоррозийным покрытием', spec: '', unit: 'шт', quantity: 3 },
      ],
      ige: [{ code: '2', name: 'суглинок', openedFromM: 0, thicknessM: 5.6 }],
      water: { minDepthM: 0.5, maxDepthM: 5.6 },
      basisDocuments: ['Задание на проектирование, утв. заказчиком'],
      designStrategyNote: 'Критерий подбора: минимизация заглубления (проектное решение).',
    })
    const json = JSON.stringify(doc)
    for (const section of [
      '1. Основания для проектирования',
      '2. Инженерно-геологические условия',
      '3. Расчётные расходы',
      '4. Гидравлический расчёт сети К2',
      '5. Сооружения на сети',
      '6. Охрана окружающей среды',
      '7. Автоматизация и АСУТП',
      '8. Восстановление благоустройства и пересадка насаждений',
      '9. Перечень использованных нормативных документов',
    ]) {
      expect(json).toContain(section)
    }
    expect(json).toContain('ИГЭ 2 — суглинок')
    expect(json).toContain('0.5-5.6 м')
    expect(json).toContain('ТЗ п. 6.2')
    expect(json).toContain('дендроплану')
    expect(json).toContain('Решётка защитная')
    expect(json).not.toContain('"Труба железобетонная безнапорная — ') // pipes stay in the table, not structures
  })
})
