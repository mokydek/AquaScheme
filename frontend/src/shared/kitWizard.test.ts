import { describe, expect, it } from 'vitest'
import {
  STANKEVICHA_KIT_SLOTS,
  emptyKitState,
  kitProgress,
  runKit,
  type KitSlotState,
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
    // Разбираются полная топооснова, съёмка (для совместимости), ТУ и акт
    // технического обследования; остальные объявлены basis, и у каждого назван
    // этап разбора.
    const parsed = STANKEVICHA_KIT_SLOTS.filter((slot) => slot.handling === 'parsed')
    expect(parsed.map((slot) => slot.id))
      .toEqual(['topobaseFull', 'surveyStankevicha', 'technicalConditions', 'surveyReport'])
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
    expect(kitProgress(state)).toEqual({ filled: 0, total: 8, failed: 0, covered: 0 })
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
    expect(kitProgress(state)).toEqual({ filled: 2, total: 8, failed: 1, covered: 0 })
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
