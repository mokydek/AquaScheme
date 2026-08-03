import { describe, expect, it, vi } from 'vitest'
import { NORMATIVE_DEFAULTS } from '@aquascheme/engine'

vi.mock('./supabase', () => ({ supabase: {} }))
vi.mock('./network', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./network')>()),
  replaceNetwork: async () => {
    throw new Error('Требуется применить миграцию backend/migrations/0012_engineering_route.sql в Supabase.')
  },
}))

import { runFullPipeline } from './pipeline'

const params = {
  projectId: 'p-1',
  systemType: 'water' as const,
  buildings: [
    { id: 'b-1', x: 0, y: 0, floors: 5, residents: 100 },
    { id: 'b-2', x: 120, y: 40, floors: 5, residents: 80 },
  ],
  source: { x: -80, y: -30, availableHead: 45 },
  surveyPoints: [
    { x: -80, y: -30, z: 100 },
    { x: 0, y: 0, z: 101 },
    { x: 120, y: 40, z: 102 },
  ],
  norms: NORMATIVE_DEFAULTS,
  geology: {} as never,
  seismicity: {} as never,
  isoTimestamp: '2026-01-01T00:00:00.000Z',
  activeCatalogId: null,
}

describe('runFullPipeline', () => {
  it('доносит текст ошибки, а не только слово «ошибка»', async () => {
    // Конвейер ловил исключение и отдавал голое `error`. Вместе с ним пропадали
    // единственные сообщения, по которым видно, что делать; место под них в
    // разметке страницы было, но заполнить его было нечем.
    const result = await runFullPipeline(params)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('error')
    expect(result.detail).toContain('0012_engineering_route.sql')
  })

  it('самотёчный проект в EPANET не отправляется', async () => {
    const result = await runFullPipeline({ ...params, systemType: 'sewer' })
    expect(result).toEqual({ ok: false, reason: 'wrongSystem' })
  })
})
