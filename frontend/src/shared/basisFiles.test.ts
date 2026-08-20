import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
  saveDataset: vi.fn(),
  loadDatasetContent: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('./supabase', () => ({
  SUPABASE_REST_URL: 'https://project.supabase.co/rest/v1/',
  SUPABASE_ANON_KEY: 'public-anon-key',
  supabase: {
    rpc: mocks.rpc,
    auth: { getSession: mocks.getSession },
  },
}))

vi.mock('./datasets', () => ({
  saveDataset: mocks.saveDataset,
  loadDatasetContent: mocks.loadDatasetContent,
}))

let saveBasisFile: typeof import('./basisFiles')['saveBasisFile']

describe('saveBasisFile', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.rpc.mockReset()
    mocks.getSession.mockReset()
    mocks.saveDataset.mockReset()
    mocks.loadDatasetContent.mockReset()
    mocks.loadDatasetContent.mockResolvedValue({})
    mocks.fetch.mockReset()
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'current-user-jwt' } },
      error: null,
    })
    mocks.saveDataset.mockResolvedValue(undefined)
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ paths: { '/rpc/save_basis_file': {} } }),
    })
    vi.stubGlobal('fetch', mocks.fetch)
    ;({ saveBasisFile } = await import('./basisFiles'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('probes OpenAPI once and uses the RPC only when its path is present', async () => {
    mocks.rpc.mockResolvedValue({ data: { files: { apz: 'АПЗ.pdf' } }, error: null })
    const base = { files: { assignment: 'ТЗ.pdf' }, note: 'keep me' }

    await saveBasisFile('project-1', 'apz', 'АПЗ.pdf', base)
    await saveBasisFile('project-1', 'tu', 'ТУ.pdf', base)

    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.fetch).toHaveBeenCalledWith('https://project.supabase.co/rest/v1/', {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/openapi+json',
        apikey: 'public-anon-key',
        Authorization: 'Bearer current-user-jwt',
      },
    })
    expect(mocks.rpc).toHaveBeenCalledWith('save_basis_file', {
      p_project_id: 'project-1',
      p_item_id: 'apz',
      p_file_name: 'АПЗ.pdf',
      p_base_content: base,
    })
    expect(mocks.saveDataset).not.toHaveBeenCalled()
  })

  it('uses the legacy merge without calling a missing RPC when OpenAPI omits its path', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ paths: { '/rpc/another_function': {} } }),
    })

    await saveBasisFile('project-2', 'topo', 'survey.dwg', {
      files: { assignment: 'ТЗ.pdf' },
      project: { code: 'NK-1' },
    })

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.saveDataset).toHaveBeenCalledWith('project-2', 'basis', {
      files: { assignment: 'ТЗ.pdf', topo: 'survey.dwg' },
      project: { code: 'NK-1' },
    })
  })

  it('falls back without throwing when the capability probe itself fails', async () => {
    mocks.fetch.mockRejectedValue(new Error('OpenAPI temporarily unavailable'))

    await saveBasisFile('project-3', 'tu', 'TU.pdf', null)

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.saveDataset).toHaveBeenCalledWith('project-3', 'basis', {
      files: { tu: 'TU.pdf' },
    })
  })

  it('still handles a stale OpenAPI document if the advertised RPC disappeared', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.save_basis_file in the schema cache' },
    })

    await saveBasisFile('project-4', 'tu', 'TU.pdf', null)
    await saveBasisFile('project-4', 'apz', 'APZ.pdf', { files: { tu: 'TU.pdf' } })

    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.saveDataset).toHaveBeenNthCalledWith(1, 'project-4', 'basis', {
      files: { tu: 'TU.pdf' },
    })
    expect(mocks.saveDataset).toHaveBeenNthCalledWith(2, 'project-4', 'basis', {
      files: { tu: 'TU.pdf', apz: 'APZ.pdf' },
    })
  })

  it('never hides ownership, validation or runtime errors behind the fallback', async () => {
    const error = { code: '42501', message: 'project access denied' }
    mocks.rpc.mockResolvedValue({ data: null, error })

    await expect(saveBasisFile('project-5', 'apz', 'APZ.pdf', { files: {} })).rejects.toEqual(error)

    expect(mocks.saveDataset).not.toHaveBeenCalled()
  })
})

describe('save_basis_file SQL contract', () => {
  it('locks, deep-merges and retries the canonical basis row under owner scope', () => {
    const sql = readFileSync(
      new URL('../../../backend/migrations/0015_basis_file_atomic.sql', import.meta.url),
      'utf8',
    )

    expect(sql).toMatch(/create or replace function public\.save_basis_file/i)
    expect(sql).toMatch(/public\.is_project_owner\(p_project_id\)/i)
    expect(sql).toMatch(/for update/i)
    expect(sql).toMatch(/jsonb_set\s*\(/i)
    expect(sql).toMatch(/base_files\s*\|\|\s*stored_files\s*\|\|\s*jsonb_build_object/i)
    expect(sql).toMatch(/update public\.datasets[\s\S]*where project_id = p_project_id[\s\S]*kind = 'basis'/i)
    expect(sql).toMatch(/when unique_violation then/i)
    expect(sql).toMatch(/grant execute[\s\S]*to authenticated/i)
  })
})

describe('запасной путь не теряет файлы', () => {
  /**
   * ИЗМЕРЕНО НА ЖИВОЙ БАЗЕ. Владелец загрузил мастером шесть документов, мастер
   * отчитался «Готово 6 из 8; с ошибкой 0», а в наборе `basis` остался ОДИН
   * ключ — последний. Пять документов пропали молча.
   *
   * Причина: запасной путь писал набор целиком из того обрывка содержимого,
   * который передал вызывающий, не читая, что уже лежит в базе. Шесть записей
   * подряд — каждая затирала предыдущую.
   */
  beforeEach(async () => {
    vi.resetModules()
    for (const mock of [mocks.rpc, mocks.getSession, mocks.saveDataset, mocks.loadDatasetContent, mocks.fetch]) {
      mock.mockReset()
    }
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'current-user-jwt' } }, error: null,
    })
    mocks.loadDatasetContent.mockResolvedValue({})
    // RPC в этом сценарии недоступна: старая база, недокатанная миграция.
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ paths: {} }) })
    vi.stubGlobal('fetch', mocks.fetch)
    ;({ saveBasisFile } = await import('./basisFiles'))
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('шесть сохранений подряд дают шесть ключей, а не один', async () => {
    // Подставная база: `saveDataset` пишет, чтение отдаёт записанное.
    let stored: Record<string, unknown> = {}
    mocks.saveDataset.mockImplementation(async (_project: string, _kind: string, content: unknown) => {
      stored = content as Record<string, unknown>
    })
    mocks.loadDatasetContent.mockImplementation(async () => stored)

    const items = ['tu', 'assignment', 'geology', 'topo', 'apz', 'vertical']
    for (const item of items) {
      await saveBasisFile('project-1', item, `${item}.pdf`, { fileName: `${item}.pdf` })
    }
    expect(Object.keys((stored.files ?? {}) as Record<string, string>).sort()).toEqual([...items].sort())
  })

  it('параллельные сохранения тоже не затирают друг друга', async () => {
    let stored: Record<string, unknown> = {}
    mocks.saveDataset.mockImplementation(async (_project: string, _kind: string, content: unknown) => {
      // Задержка расширяет окно гонки: без очереди последний затрёт всех.
      await new Promise((resolve) => setTimeout(resolve, 1))
      stored = content as Record<string, unknown>
    })
    mocks.loadDatasetContent.mockImplementation(async () => stored)

    await Promise.all(['tu', 'assignment', 'geology'].map((item) =>
      saveBasisFile('project-1', item, `${item}.pdf`, { fileName: `${item}.pdf` })))
    expect(Object.keys((stored.files ?? {}) as Record<string, string>).sort())
      .toEqual(['assignment', 'geology', 'tu'])
  })

  it('отказ RPC не по причине её отсутствия не подменяется запасным путём', async () => {
    // 22023 — недопустимый идентификатор. Это ошибка, и она обязана дойти до
    // экрана, а не превратиться в тихую запись мимо проверки.
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ paths: { '/rpc/save_basis_file': {} } }) })
    mocks.rpc.mockResolvedValue({ error: { code: '22023', message: 'invalid basis item: whatever' } })
    await expect(saveBasisFile('project-1', 'whatever', 'x.pdf', {})).rejects.toMatchObject({ code: '22023' })
    expect(mocks.saveDataset).not.toHaveBeenCalled()
  })
})
