import { readFileSync, readdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BASIS_ITEM_IDS } from './basisFiles'
import type { BasisItemId } from './basisFiles'
import { STANKEVICHA_KIT_SLOTS } from './kitWizard'

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
      // Сохранение без разбора передаёт null, а не пустой объект: в базе
      // это разные вещи — «разбора нет» против «разбор пуст».
      p_extracted: null,
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

/**
 * Белый список из последней миграции, которая его объявляет.
 *
 * Разбор, а не копия: копия — это второй список, а расхождение двух списков и
 * было причиной того, что мастер терял документы.
 */
function latestWhitelist(): string[] {
  const dir = new URL('../../../backend/migrations/', import.meta.url)
  const names = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
  let latest: string[] = []
  for (const name of names) {
    const sql = readFileSync(new URL(name, dir), 'utf8')
    const declaration = /array\[([\s\S]*?)\]::text\[\]/.exec(sql)
    if (!declaration) continue
    latest = [...declaration[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
  }
  return latest
}

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

  /**
   * СПИСОК В БАЗЕ И СПИСОК В КОДЕ — ОДИН СПИСОК.
   *
   * Мастер писал под ключами, которых нет в белом списке `save_basis_file`.
   * База отвечала 22023, клиент считал это несовместимостью установки, уходил
   * на запасной путь — и файлы терялись без единого сообщения. Ни один тест
   * этого не видел: код и SQL проверялись порознь.
   *
   * Массив читается из миграции разбором, а не переписывается сюда руками:
   * переписанный список разошёлся бы ровно так же, как разошлись первые два.
   */
  it('белый список базы совпадает с BASIS_ITEM_IDS и покрывает каждый слот', () => {
    // Читается ПОСЛЕДНЯЯ миграция, объявляющая список: он переезжал уже
    // дважды (0015 → 0022 → 0023), и проверка, прибитая к номеру файла,
    // молча осталась бы сверять позавчерашний перечень.
    const fromSql = latestWhitelist()

    expect([...fromSql].sort()).toEqual([...BASIS_ITEM_IDS].sort())

    // И каждый слот мастера объявлен под именем, которое база принимает.
    for (const slot of STANKEVICHA_KIT_SLOTS) {
      expect(fromSql, `слот ${slot.id} пишет под ключом, которого нет в базе`)
        .toContain(slot.basisItemId)
    }
  })

  it('уже загруженные документы переезжают на канонические ключи', () => {
    /*
      Раздел ИРД показывал файлы мастера через таблицу соответствия, которую
      этот заход убирает. Убрать таблицу и не перенести данные — та же потеря,
      только с другого конца: файл владельца остался бы в базе и пропал бы с
      экрана. Перенос обязан быть в миграции, а не в замысле.
    */
    const sql = readFileSync(
      new URL('../../../backend/migrations/0022_basis_kit_documents.sql', import.meta.url),
      'utf8',
    )
    for (const [oldKey, newKey] of [
      ['stankevicha_topobaseFull', 'topo'],
      ['stankevicha_surveyStankevicha', 'topo'],
      ['stankevicha_technicalConditions', 'tu'],
      ['stankevicha_designBrief', 'assignment'],
      ['stankevicha_surveyReport', 'survey_act'],
      ['stankevicha_geologyReport', 'geology'],
      ['stankevicha_geologyAppendices', 'geology_appendices'],
      ['stankevicha_routeScheme', 'route_scheme'],
    ]) {
      expect(sql, `перенос ${oldKey} не объявлен`).toContain(`'${oldKey}', '${newKey}'`)
    }
    // Разбор переезжает вместе с файлами: исходник лежит на диске инженера,
    // и разобрать заново удастся не всегда.
    expect(sql).toContain("'stankevicha_geologyReport', 'geologyReport', 'geology'")
    expect(sql).toContain("'stankevicha_surveyReport', 'surveyAct', 'survey_act'")
    // Загруженное самим разделом ИРД главнее копии мастера — как и на экране
    // до переноса. Порядок операндов `||` и есть это правило.
    expect(sql).toMatch(/moved\.files \|\| \(dataset\.content -> 'files'\)/)
  })

  it('пятый аргумент кладёт разбор в свой ключ и не трогает чужие', () => {
    const sql = readFileSync(
      new URL('../../../backend/migrations/0022_basis_kit_documents.sql', import.meta.url),
      'utf8',
    )
    // Старая четырёхаргументная форма снята: две перегрузки — PGRST203.
    expect(sql).toMatch(/drop function if exists public\.save_basis_file\(uuid, text, text, jsonb\)/i)
    expect(sql).toMatch(/p_extracted jsonb default null/i)
    // Разбор соседних документов объединяется, а не заменяется целиком.
    expect(sql).toMatch(/merged_extracted := base_extracted \|\| stored_extracted/i)
    // Вызов без разбора не стирает прежний: запись только под своим ключом.
    expect(sql).toMatch(/if jsonb_typeof\(p_extracted\) = 'object' then/i)
    expect(sql).toMatch(/merged_extracted \|\| jsonb_build_object\(p_item_id, p_extracted\)/i)
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

    const items: BasisItemId[] = ['tu', 'assignment', 'geology', 'topo', 'apz', 'vertical']
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

    await Promise.all((['tu', 'assignment', 'geology'] as BasisItemId[]).map((item) =>
      saveBasisFile('project-1', item, `${item}.pdf`, { fileName: `${item}.pdf` })))
    expect(Object.keys((stored.files ?? {}) as Record<string, string>).sort())
      .toEqual(['assignment', 'geology', 'tu'])
  })

  it('разбор одного документа не стирает разбор другого и не пропадает сам', async () => {
    /*
      Вторая половина той же потери. Разбор геологии и разбор акта лежали
      верхними ключами набора, и атомарный путь отдаёт верхние ключи
      СОХРАНЁННОМУ: первая загрузка величины записывала, повторная молча
      оставляла старые. Здесь проверяется запасной путь — у атомарного то же
      правило записано в SQL и проверено отдельно.
    */
    let stored: Record<string, unknown> = {}
    mocks.saveDataset.mockImplementation(async (_project: string, _kind: string, content: unknown) => {
      stored = content as Record<string, unknown>
    })
    mocks.loadDatasetContent.mockImplementation(async () => stored)

    await saveBasisFile('project-6', 'geology', 'Отчет.docx', {}, { freezingDepthCandidates: [{ valueM: 0.79 }] })
    await saveBasisFile('project-6', 'survey_act', 'ТО.pdf', {}, { diameterMm: [{ value: 450 }] })
    // Загрузка без разбора: имя файла меняется, чужие величины остаются.
    await saveBasisFile('project-6', 'tu', 'ТУ.pdf', {})
    // Повторная загрузка того же документа ЗАМЕЩАЕТ его разбор, а не хранит оба.
    await saveBasisFile('project-6', 'geology', 'Отчет-2.docx', {}, { freezingDepthCandidates: [{ valueM: 1.03 }] })

    expect(stored.extracted).toEqual({
      geology: { freezingDepthCandidates: [{ valueM: 1.03 }] },
      survey_act: { diameterMm: [{ value: 450 }] },
    })
    expect(stored.files).toEqual({
      geology: 'Отчет-2.docx', survey_act: 'ТО.pdf', tu: 'ТУ.pdf',
    })
  })

  it('отказ RPC не по причине её отсутствия не подменяется запасным путём', async () => {
    // 22023 — недопустимый идентификатор. Это ошибка, и она обязана дойти до
    // экрана, а не превратиться в тихую запись мимо проверки.
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ paths: { '/rpc/save_basis_file': {} } }) })
    mocks.rpc.mockResolvedValue({ error: { code: '22023', message: 'invalid basis item: whatever' } })
    // Приведение здесь намеренное: компилятор такой ключ уже не пропускает —
    // проверяется поведение при ключе, которого база не знает, а не подбор
    // ключа. Обе двери заперты, и запирают их разные проверки.
    const unknownItem = 'whatever' as BasisItemId
    await expect(saveBasisFile('project-1', unknownItem, 'x.pdf', {})).rejects.toMatchObject({ code: '22023' })
    expect(mocks.saveDataset).not.toHaveBeenCalled()
  })
})
