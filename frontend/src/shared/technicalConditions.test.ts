import { describe, expect, it, vi } from 'vitest'

const saved: Array<{ kind: string; content: unknown }> = []
vi.mock('./datasets', () => ({
  saveDataset: async (_projectId: string, kind: string, content: unknown) => {
    saved.push({ kind, content })
  },
}))

const { readTechnicalConditions, saveTechnicalCondition, valueOf, TECHNICAL_CONDITIONS_KIND } =
  await import('./technicalConditions')

const row = (content: unknown) => ({
  id: 'd1', project_id: 'p1', kind: TECHNICAL_CONDITIONS_KIND,
  file_name: null, content, meta: null, created_at: '',
} as never)

describe('контрактные величины проекта', () => {
  it('пустой набор читается как пустой, а не падает', () => {
    expect(readTechnicalConditions(undefined)).toEqual({})
  })

  it('запись одной величины не стирает соседние', async () => {
    saved.length = 0
    await saveTechnicalCondition('p1', row({
      requiredClearanceM: { value: 0.4, origin: 'stated', source: 'ТУ, с. 3' },
    }), 'designDiameterMm', { value: 450, origin: 'stated', source: 'ТУ, с. 2' })
    const content = saved[0].content as Record<string, { value: number }>
    // Набор перезаписывается целиком — та же ошибка уже стирала соседние
    // ключи в наборе drainage, поэтому проверяется именно сохранность.
    expect(content.requiredClearanceM.value).toBe(0.4)
    expect(content.designDiameterMm.value).toBe(450)
  })

  it('сброс величины удаляет её, а не пишет ноль', async () => {
    saved.length = 0
    await saveTechnicalCondition('p1', row({
      designDiameterMm: { value: 450, origin: 'manual', source: 'вручную' },
    }), 'designDiameterMm', null)
    expect(saved[0].content).toEqual({})
  })

  it('происхождение сохраняется вместе со значением', async () => {
    saved.length = 0
    await saveTechnicalCondition('p1', undefined, 'roadWidthM',
      { value: 7.2, origin: 'measured', source: 'слой SIT_LДОРОГИ' })
    const content = saved[0].content as Record<string, { origin: string; source: string }>
    expect(content.roadWidthM.origin).toBe('measured')
    expect(content.roadWidthM.source).toContain('SIT_L')
  })

  it('в расчёт идёт только положительное подтверждённое значение', () => {
    expect(valueOf({ value: 450, origin: 'stated', source: 'ТУ' })).toBe(450)
    expect(valueOf({ value: 0, origin: 'manual', source: '' })).toBeNull()
    expect(valueOf(undefined)).toBeNull()
  })
})
