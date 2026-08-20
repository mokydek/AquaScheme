import { describe, expect, it } from 'vitest'
import {
  STANKEVICHA_KIT_SLOTS,
  emptyKitState,
  kitProgress,
  runKit,
  verifyKitAgainstStored,
  type KitSlotState,
  type KitState,
} from './kitWizard'

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name)

describe('мастер комплекта', () => {
  it('порядок прогона зафиксирован и начинается с полной топоосновы', () => {
    expect(STANKEVICHA_KIT_SLOTS.map((slot) => slot.id)).toEqual([
      'topobaseFull',
      'surveyStankevicha',
      'technicalConditions',
      'designBrief',
      'surveyReport',
      'geologyReport',
      'geologyAppendices',
      'routeScheme',
    ])
    // Разбираются полная топооснова, съёмка (для совместимости), ТУ, акт
    // технического обследования и геологический отчёт. У геологии разбор был
    // ОБЪЯВЛЕН этапом 3 и не написан: документ ложился в проект и не сдвигал
    // расчёт. Этапов 3, 4 и 5 не существует, поэтому «разбор потом» — это
    // обещание, а не состояние; у оставшихся basis-слотов оно ещё висит.
    const parsed = STANKEVICHA_KIT_SLOTS.filter((slot) => slot.handling === 'parsed')
    expect(parsed.map((slot) => slot.id))
      .toEqual(['topobaseFull', 'surveyStankevicha', 'technicalConditions', 'surveyReport', 'geologyReport'])
    // Полная топооснова стоит ДО технических условий: диаметр ложится на уже
    // разобранную основу, а не наоборот.
    const order = STANKEVICHA_KIT_SLOTS.map((slot) => slot.id)
    expect(order.indexOf('topobaseFull')).toBeLessThan(order.indexOf('technicalConditions'))
    for (const slot of STANKEVICHA_KIT_SLOTS) {
      expect(slot.parsedAtStage === null).toBe(slot.handling === 'parsed')
    }
  })

  it('эталон РП в комплект не входит', () => {
    // «_РП Станкевича — (2).dwg» — мерило, а не исходное данное: попасть в
    // расчёт он не должен даже случайно.
    expect(STANKEVICHA_KIT_SLOTS.some((slot) => /РП|rp_/i.test(slot.hint))).toBe(false)
  })

  it('пустой комплект объявляет каждый слот, а не молчит', () => {
    const state = emptyKitState()
    expect(Object.keys(state)).toHaveLength(STANKEVICHA_KIT_SLOTS.length)
    expect(Object.values(state).every((slot) => slot.kind === 'empty')).toBe(true)
    expect(kitProgress(state)).toEqual({ filled: 0, total: 8, failed: 0, covered: 0, unverified: 0 })
  })

  it('слот с ошибкой не роняет остальные и попадает в состояние ошибкой', async () => {
    const order: string[] = []
    const state = await runKit(
      {
        surveyStankevicha: file('topo.dxf'),
        technicalConditions: file('tu.pdf'),
        designBrief: file('tz.pdf'),
      },
      {
        surveyStankevicha: async (given) => {
          order.push('surveyStankevicha')
          return { kind: 'parsed', fileName: given.name, counters: [{ label: 'слоёв', value: 28 }] }
        },
        technicalConditions: async () => {
          order.push('technicalConditions')
          throw new Error('скан без текстового слоя')
        },
        designBrief: async (given) => {
          order.push('designBrief')
          return { kind: 'stored', fileName: given.name, parsedAtStage: 4 }
        },
      },
    )
    // Порядок обхода — порядок комплекта, а не порядок ключей объекта.
    expect(order).toEqual(['surveyStankevicha', 'technicalConditions', 'designBrief'])
    expect(state.surveyStankevicha).toEqual({
      kind: 'parsed', fileName: 'topo.dxf', counters: [{ label: 'слоёв', value: 28 }],
    })
    expect(state.technicalConditions).toEqual({
      kind: 'failed', fileName: 'tu.pdf', reason: 'скан без текстового слоя',
    })
    // Упавший слот не помешал следующему за ним.
    expect(state.designBrief).toEqual({ kind: 'stored', fileName: 'tz.pdf', parsedAtStage: 4 })
    expect(kitProgress(state)).toEqual({ filled: 2, total: 8, failed: 1, covered: 0, unverified: 0 })
  })

  it('слот без обработчика называет причину, а не тихо пропускается', async () => {
    const state = await runKit({ routeScheme: file('scheme.pdf') }, {})
    const slot = state.routeScheme as Extract<KitSlotState, { kind: 'failed' }>
    expect(slot.kind).toBe('failed')
    expect(slot.reason).toContain('routeScheme')
  })

  it('съёмка Станкевича помечается покрытой только при разобранной полной основе', async () => {
    const covering = await runKit(
      { topobaseFull: file('moldagalieva.dxf') },
      { topobaseFull: async (given) => ({ kind: 'parsed', fileName: given.name, counters: [{ label: 'слоёв', value: 50 }] }) },
    )
    expect(covering.surveyStankevicha).toEqual({ kind: 'covered', byId: 'topobaseFull' })
    // Пока полной основы нет, отсутствие съёмки видно как обычная пустота.
    const без = await runKit({}, {})
    expect(без.surveyStankevicha).toEqual({ kind: 'empty' })
    // Упавшая полная основа тоже не даёт пометки: покрывать нечем.
    const упала = await runKit(
      { topobaseFull: file('moldagalieva.dxf') },
      { topobaseFull: async () => { throw new Error('DXF не разобран') } },
    )
    expect(упала.surveyStankevicha).toEqual({ kind: 'empty' })
  })

  it('свой файл съёмки не затирается пометкой покрытия', async () => {
    const state = await runKit(
      { topobaseFull: file('m.dxf'), surveyStankevicha: file('s.dxf') },
      {
        topobaseFull: async (g) => ({ kind: 'parsed', fileName: g.name, counters: [] }),
        surveyStankevicha: async (g) => ({ kind: 'parsed', fileName: g.name, counters: [] }),
      },
    )
    expect(state.surveyStankevicha).toEqual({ kind: 'parsed', fileName: 's.dxf', counters: [] })
  })

  it('слот без файла остаётся пустым, а прогон идёт дальше', async () => {
    const state = await runKit(
      { technicalConditions: file('tu.pdf') },
      { technicalConditions: async (given) => ({ kind: 'stored', fileName: given.name, parsedAtStage: 3 }) },
    )
    expect(state.surveyStankevicha).toEqual({ kind: 'empty' })
    expect(state.technicalConditions.kind).toBe('stored')
  })
})

describe('причина отказа доходит до слота словами', () => {
  it('отказ базы читается человеком, а не как [object Object]', async () => {
    /*
      Отказ PostgREST — плайн-объект, а не Error. `String(cause)` давал
      «[object Object]», и слот показывал бы это вместо «invalid basis item».
      То есть та самая ошибка, из-за которой мастер терял документы, была бы
      на экране нечитаемой — и владелец опять пошёл бы в базу руками.
    */
    const state = await runKit(
      { technicalConditions: file('tu.pdf') },
      {
        technicalConditions: async () => {
          throw { code: '22023', message: 'invalid basis item: stankevicha_technicalConditions' }
        },
      },
    )
    const slot = state.technicalConditions
    expect(slot.kind).toBe('failed')
    const reason = slot.kind === 'failed' ? slot.reason : ''
    expect(reason).not.toContain('[object Object]')
    expect(reason).toContain('22023')
    expect(reason).toContain('invalid basis item')
  })

  it('обычная ошибка разбора остаётся своим текстом', async () => {
    const state = await runKit(
      { geologyReport: file('g.docx') },
      { geologyReport: async () => { throw new Error('В файле DOCX нет текста') } },
    )
    expect(state.geologyReport).toEqual({
      kind: 'failed', fileName: 'g.docx', reason: 'В файле DOCX нет текста',
    })
  })
})

describe('«Готово N» считается по базе, а не по числу удачных вызовов', () => {
  /**
   * ИЗМЕРЕНО НА ЖИВОМ САЙТЕ. Мастер написал «Готово 6 из 8; с ошибкой 0», а в
   * наборе `basis` этого проекта лежал ОДИН ключ — `stankevicha_routeScheme`.
   * Пять документов пропали, и ни одна из шести записей об этом не сообщила:
   * все шесть вызовов вернулись без исключения, а мастер считал именно их.
   */
  const afterRun = (): KitState => ({
    ...emptyKitState(),
    technicalConditions: { kind: 'parsed', fileName: 'ТУ.pdf', counters: [] },
    designBrief: { kind: 'stored', fileName: 'ТЗ.pdf', parsedAtStage: 4 },
    routeScheme: { kind: 'stored', fileName: 'схема.pdf', parsedAtStage: 5 },
  })

  it('слот, чьего документа в базе нет, становится ошибкой с причиной', () => {
    // В базе только схема трассы — ровно то, что владелец увидел запросом.
    const checked = verifyKitAgainstStored(
      afterRun(),
      { kind: 'read', files: { route_scheme: 'схема.pdf' } },
      'В базе проекта его нет.',
    )
    expect(checked.routeScheme).toEqual({ kind: 'stored', fileName: 'схема.pdf', parsedAtStage: 5 })
    expect(checked.technicalConditions).toEqual({
      kind: 'failed', fileName: 'ТУ.pdf', reason: 'В базе проекта его нет.',
    })
    expect(checked.designBrief).toEqual({
      kind: 'failed', fileName: 'ТЗ.pdf', reason: 'В базе проекта его нет.',
    })

    const progress = kitProgress(checked)
    // Было бы «Готово 3; с ошибкой 0». Стало — по факту в базе.
    expect(progress.filled).toBe(1)
    expect(progress.failed).toBe(2)
    expect(progress.unverified).toBe(0)
  })

  it('все документы на месте — прогон не трогают', () => {
    const checked = verifyKitAgainstStored(
      afterRun(),
      { kind: 'read', files: { tu: 'ТУ.pdf', assignment: 'ТЗ.pdf', route_scheme: 'схема.pdf' } },
      'В базе проекта его нет.',
    )
    expect(checked).toEqual(afterRun())
    expect(kitProgress(checked).filled).toBe(3)
  })

  it('неудачная сверка не выдаётся ни за успех, ни за потерю', () => {
    // Сеть отвалилась на перечитке. Записи, возможно, прошли — обвинить их
    // нельзя; но и засчитать в «Готово» нельзя тем более.
    const checked = verifyKitAgainstStored(
      afterRun(),
      { kind: 'failed', reason: 'Сверить с базой не удалось: сеть недоступна.' },
      'В базе проекта его нет.',
    )
    const progress = kitProgress(checked)
    expect(progress.filled).toBe(0)
    expect(progress.failed).toBe(0)
    expect(progress.unverified).toBe(3)
    expect(checked.technicalConditions).toEqual({
      kind: 'unverified', fileName: 'ТУ.pdf', reason: 'Сверить с базой не удалось: сеть недоступна.',
    })
  })

  it('покрытый и пустой слоты сверкой не задеваются', () => {
    const state: KitState = {
      ...emptyKitState(),
      topobaseFull: { kind: 'parsed', fileName: 'm.dxf', counters: [] },
      surveyStankevicha: { kind: 'covered', byId: 'topobaseFull' },
    }
    const checked = verifyKitAgainstStored(state, { kind: 'read', files: { topo: 'm.dxf' } }, 'нет')
    expect(checked.surveyStankevicha).toEqual({ kind: 'covered', byId: 'topobaseFull' })
    expect(checked.geologyReport).toEqual({ kind: 'empty' })
  })

  it('затёртый файл не засчитывается: сверяется имя, а не наличие ключа', () => {
    /*
      Два слота топоосновы писали ОДИН ключ `topo`: восемь загруженных
      документов давали семь, имя полной топоосновы затиралось съёмкой, а
      сверка отвечала «Готово 8 из 8» — ключ-то на месте. Идентификаторы
      разведены миграцией 0023, но проверка обязана ловить и будущее
      столкновение, а не то одно, которое уже известно.
    */
    const state: KitState = {
      ...emptyKitState(),
      topobaseFull: { kind: 'parsed', fileName: 'Молдагалиева.dxf', counters: [] },
      surveyStankevicha: { kind: 'parsed', fileName: 'станкевича.dxf', counters: [] },
    }
    const checked = verifyKitAgainstStored(
      state,
      // Как выглядит база, если под ключом слота лежит ЧУЖОЕ имя: раньше это
      // засчитывалось за сохранение, потому что спрашивали про ключ.
      { kind: 'read', files: { topo: 'станкевича.dxf', topo_survey: 'станкевича.dxf' } },
      'В базе проекта его нет.',
    )
    expect(checked.topobaseFull).toEqual({
      kind: 'failed', fileName: 'Молдагалиева.dxf', reason: 'В базе проекта его нет.',
    })
    // Свой файл на своём месте — слот остаётся заполненным.
    expect(checked.surveyStankevicha).toEqual({
      kind: 'parsed', fileName: 'станкевича.dxf', counters: [],
    })
    expect(kitProgress(checked).filled).toBe(1)
  })

  it('все восемь слотов пишут восемь разных документов', () => {
    const ids = STANKEVICHA_KIT_SLOTS.map((slot) => slot.basisItemId)
    expect(new Set(ids).size).toBe(STANKEVICHA_KIT_SLOTS.length)
  })
})
