import { describe, expect, it, vi } from 'vitest'
import { STANKEVICHA_CHAMBERS, STANKEVICHA_CONDITIONS, STANKEVICHA_GEOLOGY, stankevichaChainLengthM } from './stankevichaDemo'

// Модуль тянет клиент базы, а он требует переменных окружения, которых в тесте
// нет. Проверяется чистая сборка сети, до базы дело не доходит.
vi.mock('./supabase', () => ({ supabase: {} }))

const { buildStankevichaNetwork, seedStankevichaProject } = await import('./stankevichaSeed')
const { networkFromRows } = await import('./network')
const { solveGravityNetwork, buildSituationSteps } = await import('@aquascheme/engine')

describe('сеть объекта для загрузки в проект', () => {
  const network = buildStankevichaNetwork()

  it('узел на каждую камеру, труба между соседними', () => {
    expect(network.nodes).toHaveLength(STANKEVICHA_CHAMBERS.length)
    expect(network.pipes).toHaveLength(STANKEVICHA_CHAMBERS.length - 1)
  })

  it('низовой конец помечен выпуском: по нему конвейер считает сток', () => {
    expect(network.nodes.filter((node) => node.kind === 'outlet')).toHaveLength(1)
    expect(network.nodes[network.nodes.length - 1].kind).toBe('outlet')
  })

  it('трубы связаны в цепочку без разрывов', () => {
    for (let i = 0; i < network.pipes.length; i++) {
      expect(network.pipes[i].fromNode).toBe(network.nodes[i].id)
      expect(network.pipes[i].toNode).toBe(network.nodes[i + 1].id)
    }
  })

  it('сумма длин труб равна длине цепочки, а не расходится с ней', () => {
    // Иначе ведомость и план показывали бы разные числа на одних данных.
    const total = network.pipes.reduce((sum, pipe) => sum + (pipe.lengthM ?? 0), 0)
    expect(total).toBeCloseTo(stankevichaChainLengthM(), 0)
  })

  it('диаметр везде из технических условий, а не подобран', () => {
    expect([...new Set(network.pipes.map((pipe) => pipe.diameterMm))])
      .toEqual([STANKEVICHA_CONDITIONS.designDiameterMm])
  })
})

/**
 * Посев проверяется ЧЕРЕЗ КРУГ БАЗЫ, а не по объекту в памяти.
 *
 * Сеть уходит в `replace_project_network` как JSON и возвращается строками
 * таблиц. Именно на этом круге терялись отметки: посев клал их в поле `z`, а
 * SQL достаёт `groundElevation`. Проверки выше этого не ловили — объект в
 * памяти был правильным всё это время, поле просто называлось иначе.
 *
 * Круг воспроизводится теми же правилами, что и SQL-функция: имя поля в
 * payload → колонка таблицы. Разойдётся договор — сломается здесь, а не на
 * экране владельца.
 */
const throughDatabase = (built: ReturnType<typeof buildStankevichaNetwork>) => {
  const payload = built as unknown as {
    nodes: Array<Record<string, unknown>>
    pipes: Array<Record<string, unknown>>
  }
  const dbIdByEngineId = new Map(payload.nodes.map((node, index) => [String(node.id), `db-${index}`]))
  const nodeRows = payload.nodes.map((node, index) => ({
    id: `db-${index}`,
    label: (node.label as string | undefined) ?? String(node.id),
    kind: (node.kind as string | undefined) ?? 'junction',
    x: node.x as number,
    y: node.y as number,
    // Ровно как в SQL: nullif(payload ->> 'groundElevation', '')
    ground_elevation: (node.groundElevation as number | undefined) ?? null,
    invert_elevation_m: (node.invertElevationM as number | undefined) ?? null,
    meta: { engineKind: node.kind as string | undefined, engineId: String(node.id) },
  }))
  const pipeRows = payload.pipes.map((pipe, index) => ({
    id: `dbp-${index}`,
    from_node: dbIdByEngineId.get(String(pipe.fromNode)) ?? '',
    to_node: dbIdByEngineId.get(String(pipe.toNode)) ?? '',
    length_m: (pipe.lengthM as number | undefined) ?? null,
    diameter_mm: (pipe.diameterMm as number | undefined) ?? null,
    material: null,
    engineering_kind: (pipe.kind as string | undefined) ?? null,
    meta: { engineId: String(pipe.id), kind: pipe.kind as string | undefined },
  }))
  return networkFromRows(nodeRows as never, pipeRows as never)
}

describe('посев доходит до расчёта через круг базы', () => {
  const restored = throughDatabase(buildStankevichaNetwork())

  it('отметки земли переживают круг базы, а не превращаются в 0.00', () => {
    // «Земля 0.00» в профиле и всё производное — уклон 0,00 ‰, нехватка
    // падения, «самотёк не обеспечен» — росло отсюда: отметки крышек камер
    // 688,22…685,21 м в данных объекта есть, но до расчёта не доезжали.
    expect(restored.nodes.map((node) => node.groundElevation))
      .toEqual(STANKEVICHA_CHAMBERS.map((chamber) => chamber.rimElevationM))
    expect(restored.nodes.some((node) => node.groundElevation === 0)).toBe(false)
    // Признак «отметки нет» не должен стоять там, где отметка есть.
    expect(restored.nodes.some((node) =>
      (node as { groundElevationMissing?: boolean }).groundElevationMissing)).toBe(false)
  })

  it('отметки лотка существующих камер поданы, а не потеряны', () => {
    // Без них существующий профиль строить нечем, а он и есть предмет
    // реконструкции: величины измерены и лежали в данных объекта неподанными.
    expect(restored.nodes.map((node) => node.invertElevationM))
      .toEqual(STANKEVICHA_CHAMBERS.map((chamber) => chamber.invertElevationM))
  })

  it('участки остаются магистральными, а не превращаются в кольцевые', () => {
    expect(restored.pipes.every((pipe) => pipe.kind === 'main')).toBe(true)
  })

  it('рельеф после круга базы не плоский: уклон считается по настоящей земле', () => {
    const result = solveGravityNetwork({
      network: restored,
      buildingFlowLps: new Map(),
      system: 'sewer',
      freezingDepthM: 1.71,
    })
    expect(result.profile).not.toBeNull()
    const grounds = result.profile!.stations.map((station) => station.groundElevationM)
    expect(Math.min(...grounds)).toBeGreaterThan(680)
    expect(new Set(grounds).size).toBeGreaterThan(1)
  })

  it('выпуск найден: схема не докладывает о его отсутствии', () => {
    // Узел выпуска в сети есть с самого посева, но проверка знала только
    // `source`, и схема рапортовала «Выпуск не задан в сети».
    const steps = buildSituationSteps({
      network: restored,
      pipeDiameterMm: new Map(restored.pipes.map((pipe) => [pipe.id, pipe.diameterMm ?? 0])),
      buildingsCount: 0,
    })
    const outlet = steps.find((step) => step.id === 'outlet')
    expect(outlet?.present).toBe(true)
    expect(outlet?.sourceKey).toBe('outlet')
  })
})

describe('отказ базы объясняется миграцией, а не текстом Postgres', () => {
  it('нарушение datasets_kind_check называет файл миграции', async () => {
    // Сырое «new row for relation "datasets" violates check constraint» не
    // говорит пользователю, что делать; нужен не разбор SQL, а имя файла.
    vi.resetModules()
    vi.doMock('./datasets', () => ({
      saveDataset: () => Promise.reject(
        new Error('new row for relation "datasets" violates check constraint "datasets_kind_check"')),
    }))
    vi.doMock('./network', () => ({ replaceNetwork: () => Promise.resolve() }))
    const { seedStankevichaProject: seed } = await import('./stankevichaSeed')
    const result = await seed('p1')
    const titleBlock = result.failures.find((line) => line.startsWith('title block'))
    expect(titleBlock).toContain('0017_title_block.sql')
    expect(result.failures.find((line) => line.startsWith('master plan')))
      .toContain('0018_master_plan.sql')
    // Разделы, которых миграция не касается, объясняются как есть.
    expect(result.failures.find((line) => line.startsWith('geology')))
      .toContain('datasets_kind_check')
    vi.doUnmock('./datasets')
    vi.doUnmock('./network')
  })
})

// Ссылка на сеятель нужна, чтобы импорт не выпал как неиспользуемый.
expect(typeof seedStankevichaProject).toBe('function')

describe('промерзание: посев не выбирает грунт за инженера', () => {
  /**
   * Отчёт по объекту (г. Алматы) даёт глубину по трём грунтам и не говорит,
   * какой лежит на отметке лотка. Посев брал суглинок — наименьший из трёх, —
   * и величина уходила в расчёт с рангом «принято по умолчанию». Это тот же
   * молчаливый выбор, что и прежний `Math.max`, только зеркальный.
   */
  it('кандидаты объявлены списком с грунтом и цитатой отчёта', () => {
    const candidates = STANKEVICHA_GEOLOGY.freezingDepthCandidates
    expect(candidates.map((candidate) => candidate.valueM)).toEqual([0.79, 0.96, 1.03])
    for (const candidate of candidates) {
      expect(candidate.soil.length).toBeGreaterThan(0)
      // Цитата обязана содержать величину: подписать выбор нечем, если строки
      // отчёта под ним нет.
      expect(STANKEVICHA_GEOLOGY.freezingDepthQuote).toContain(
        candidate.valueM.toFixed(2).replace('.', ',').replace(/,?0+$/, ''),
      )
    }
  })

  it('в наборе геологии нет выбранной величины — только кандидаты', async () => {
    const saved: Array<{ kind: string; content: Record<string, unknown> }> = []
    vi.doMock('./datasets', () => ({
      saveDataset: (_project: string, kind: string, content: Record<string, unknown>) => {
        saved.push({ kind, content })
        return Promise.resolve()
      },
    }))
    vi.resetModules()
    const seed = await import('./stankevichaSeed')
    await seed.seedStankevichaProject('project-1').catch(() => undefined)
    const geology = saved.find((row) => row.kind === 'geology')
    if (geology) {
      // Величина не выбрана: выбирает инженер, программа кладёт кандидатов.
      expect(geology.content.freezingDepthM).toBeUndefined()
      expect(Array.isArray(geology.content.freezingDepthCandidates)).toBe(true)
    }
    vi.doUnmock('./datasets')
    vi.resetModules()
  })
})
