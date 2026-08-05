import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { solvePressureMain } from '@aquascheme/engine'
import type { GravityProfile, SewerSchedule, WorkingDrawingSet } from '@aquascheme/engine'

/**
 * Отрисовочные проверки ключевых видов.
 *
 * До этого ни один компонент не проверялся в работе: фронтенд держался на
 * `tsc` и статическом разборе разметки. Утверждения вида «пустая графа честнее
 * выдуманной» и «непосчитанная строка не исчезает» проверялись только на
 * уровне чистых функций — а исчезнуть строка может и в разметке.
 *
 * Берётся `renderToStaticMarkup`, а не jsdom с библиотекой тестирования: он уже
 * есть в проекте и уже используется, новых зависимостей не требуется. Взамен
 * не проверяется взаимодействие — только то, что видит инженер при заданных
 * данных. Для утверждений о содержимом этого достаточно.
 *
 * `react-i18next` подменяется: словари инициализируются через `localStorage`,
 * которого в Node нет. Подмена возвращает сам ключ, поэтому проверки опираются
 * на данные и на ключи, а не на конкретный перевод.
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      (values ? `${key} ${JSON.stringify(values)}` : key),
  }),
}))

vi.mock('../../shared/supabase', () => ({ supabase: {} }))

const { ReadinessView } = await import('./ReadinessView')
const { PressureMainView } = await import('./PressureMainView')
const { QuantityBillView } = await import('./QuantityBillView')
const { GeologySectionView } = await import('./GeologySectionView')
const { BlockStructuresTable } = await import('./BlockStructuresTable')
const { LinetypeRolesTable } = await import('./LinetypeRolesTable')
const { DxfLayerRoleTable } = await import('./DxfLayerRoleTable')
const { MasterPlanView } = await import('./MasterPlanView')
const { SourceBundleRunSection } = await import('./SourceBundleRunSection')

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element)

const profile: GravityProfile = {
  stations: [
    { nodeId: 'К-1', chainageM: 0, groundElevationM: 100, invertElevationM: 98, depthM: 2, diameterMm: 500 },
    { nodeId: 'К-2', chainageM: 100, groundElevationM: 100, invertElevationM: 97.7, depthM: 2.3, diameterMm: 500 },
  ],
  maxDepthM: 2.3,
  outletInvertElevationM: 97.7,
  totalLengthM: 100,
  pipeIds: ['У-1'],
} as GravityProfile

const schedule: SewerSchedule = {
  manholes: [{ label: 'К-1', picket: 'ПК0', depthMm: 2000, pipeDiameterMm: 500 }],
  pipes: [{ designation: 'Труба 500', diameterMm: 500, lengthM: 100, agskCode: 'X' }],
  totalPipeLengthM: 100,
}

describe('готовность к выпуску на экране', () => {
  const set = {
    sheets: [
      {
        id: '1', status: 'BLOCKED', blockers: [
          { code: 'FREEZING_DEPTH_UNVERIFIED', message: 'Не подтверждена глубина промерзания.', requirement: 'route' },
        ], warnings: [],
      },
      {
        id: '2', status: 'BLOCKED', blockers: [
          { code: 'FREEZING_DEPTH_UNVERIFIED', message: 'Не подтверждена глубина промерзания.', requirement: 'route' },
        ], warnings: [],
      },
    ],
  } as unknown as WorkingDrawingSet

  it('показывает причину, число листов и раздел, где она снимается', () => {
    const markup = html(createElement(ReadinessView, { drawingSet: set }))
    expect(markup).toContain('Не подтверждена глубина промерзания.')
    expect(markup).toContain('FREEZING_DEPTH_UNVERIFIED')
    expect(markup).toContain('Геология: глубина промерзания')
    // Одна причина на двух листах — одна строка таблицы, а не две. Считаются
    // ячейки кода, а не вхождения в текст: код есть ещё и в сводной фразе
    // «Наибольшая: …», и подсчёт по всей разметке ловил бы её тоже.
    expect(markup.split('<td class="mono">FREEZING_DEPTH_UNVERIFIED</td>').length - 1).toBe(1)
  })

  it('пустой набор не выдаётся за готовый', () => {
    const markup = html(createElement(ReadinessView, { drawingSet: { sheets: [] } as unknown as WorkingDrawingSet }))
    expect(markup).toContain('выпускать нечего')
  })
})

describe('напорный участок на экране', () => {
  const pressure = solvePressureMain({
    pipes: [{ id: 'НВ-1', lengthM: 1200, diameterMm: 400, flowLps: 69 }],
    inletElevationM: 100,
    outletElevationM: 112,
    availablePumpHeadM: 25,
  })

  it('без каталога и условий называет, чего не хватает, и марку не показывает', () => {
    const markup = html(createElement(PressureMainView, { pressure, designFlowLps: 69, catalog: {} }))
    expect(markup).toContain('каталог насосов не загружен')
    expect(markup).toContain('не выбрана категория надёжности ЛНС')
    expect(markup).not.toContain('project.pressureMain.designation')
  })

  it('при полном вводе показывает марку и её источник', () => {
    const markup = html(createElement(PressureMainView, {
      pressure,
      designFlowLps: 69,
      catalog: {
        category: 'first',
        effluent: 'domestic',
        entries: [{ designation: 'СД 250/22.5', flowLps: 70, headM: 30, source: 'каталог, лист 12' }],
      },
    }))
    expect(markup).toContain('СД 250/22.5')
    expect(markup).toContain('каталог, лист 12')
  })
})

describe('ведомость объёмов на экране', () => {
  it('непосчитанные строки не исчезают, а показываются с причиной', () => {
    // Главное утверждение ведомости: пробел должен быть виден, иначе сметчик
    // сочтёт отсутствие строки нулём.
    const markup = html(createElement(QuantityBillView, {
      profile, schedule, constructions: [], dropWells: [],
      settings: {}, onSettingsChange: () => {}, onExport: () => {},
      fieldPrefix: 'q',
    }))
    expect(markup).toContain('Разработка грунта в траншее')
    expect(markup).toContain('норматива на ширину траншеи в реестре проекта нет')
    // Объём при этом не напечатан: величин для него не задано.
    expect(markup).not.toMatch(/Разработка грунта в траншее<\/td><td>м³/)
  })

  it('при заданных величинах объём появляется', () => {
    const markup = html(createElement(QuantityBillView, {
      profile, schedule, constructions: [], dropWells: [],
      settings: { trenchAllowanceM: 0.3, sideSlopeRatio: 0 },
      onSettingsChange: () => {}, onExport: () => {}, fieldPrefix: 'q',
    }))
    expect(markup).toContain('м³')
    expect(markup).toContain('зазор 0.3 м')
  })
})

describe('геологический разрез на экране', () => {
  it('без предельного удаления разрез не строится и говорит почему', () => {
    const markup = html(createElement(GeologySectionView, {
      boreholes: [], path: [{ x: 0, y: 0, chainageM: 0 }, { x: 100, y: 0, chainageM: 100 }],
      routeLengthM: 100,
    }))
    expect(markup).toContain('Не задано предельное удаление')
  })

  it('точки помечены источником: скважина или интерполяция', () => {
    const layers = [{ igeCode: 'ИГЭ-1', topDepthM: 0, bottomDepthM: 2 }]
    const markup = html(createElement(GeologySectionView, {
      boreholes: [
        { label: 'С-1', x: 0, y: 0, mouthElevationM: 100, layers, water: {} as never },
        { label: 'С-2', x: 100, y: 0, mouthElevationM: 100, layers, water: {} as never },
      ],
      path: [{ x: 0, y: 0, chainageM: 0 }, { x: 100, y: 0, chainageM: 100 }],
      maxOffsetM: 25,
      routeLengthM: 100,
    }))
    expect(markup).toContain('project.geologySection.measured')
    expect(markup).toContain('project.geologySection.interpolated')
  })
})

describe('признаки из чертежа на экране', () => {
  it('без вставок блоков таблица не рисуется вовсе', () => {
    expect(html(createElement(BlockStructuresTable, { blocks: [] }))).toBe('')
  })

  it('нераспознанные имена блоков показываются, а не отбрасываются', () => {
    const markup = html(createElement(BlockStructuresTable, {
      blocks: [
        { name: 'кол.Кан', x: 1, y: 2, layer: '0' },
        { name: 'BL_2009', x: 3, y: 4, layer: '0' },
      ] as never,
    }))
    expect(markup).toContain('колодец канализации')
    expect(markup).toContain('BL_2009')
  })

  it('стандартный тип линии в список «решает инженер» не попадает', () => {
    // Continuous стоит у тысяч сегментов и похоронил бы настоящие неизвестные.
    const markup = html(createElement(LinetypeRolesTable, {
      segments: [
        { layer: '0', lineType: 'KANALIZ_NAP' },
        ...Array.from({ length: 50 }, () => ({ layer: '0', lineType: 'Continuous' })),
        { layer: '0', lineType: 'СВОЙ_ТИП' },
      ],
      roles: { 0: 'unknown' },
    }))
    expect(markup).toContain('KANALIZ_NAP')
    expect(markup).toContain('СВОЙ_ТИП')
    expect(markup).not.toContain('Continuous')
  })
})

describe('набросок слоя в таблице ролей', () => {
  const layers = [
    { name: 'СЕТЬ', segments: 1, points: 0 },
    { name: 'ДОМ', segments: 4, points: 0 },
    { name: 'ПОДПИСИ', segments: 0, points: 12 },
  ]
  const segments = [
    { layer: 'СЕТЬ', points: [{ x: 0, y: 0 }, { x: 1000, y: 800 }] },
    { layer: 'ДОМ', points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }] },
  ]
  const props = { idPrefix: 't', layers, roles: {}, onChange: () => {} }

  it('без линий чертежа графы наброска нет вовсе', () => {
    // Пустая рамка в каждой строке читалась бы как «слой пуст».
    const markup = html(createElement(DxfLayerRoleTable, props as never))
    expect(markup).not.toContain('project.dxfLayers.thSketch')
    expect(markup).not.toContain('<svg')
  })

  it('слой без линий говорит об этом, а не рисует пустую рамку', () => {
    const markup = html(createElement(DxfLayerRoleTable, { ...props, segments } as never))
    expect(markup).toContain('project.dxfLayers.thSketch')
    expect(markup).toContain('project.dxfLayers.sketchNoLines')
  })

  it('кадр общий: дом остаётся мелким рядом с сетью через всю площадку', () => {
    // Это и есть смысл наброска. При кадре по габариту слоя дом и сеть
    // выглядели бы одинаково — оба во всю картинку.
    const markup = html(createElement(DxfLayerRoleTable, { ...props, segments } as never))
    const widths = [...markup.matchAll(/<rect[^>]*?width="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(Math.max(...widths)).toBeGreaterThan(50)
    expect(Math.min(...widths)).toBeLessThan(10)
  })

  it('слой, ставший в общем кадре точкой, показан ещё и вблизи', () => {
    // Иначе о форме мелкого слоя набросок не говорит ничего, а форма — это
    // половина ответа на вопрос «что это за слой».
    const markup = html(createElement(DxfLayerRoleTable, { ...props, segments } as never))
    const rows = markup.split('<tr>')
    const house = rows.find((row) => row.includes('ДОМ'))!
    const network = rows.find((row) => row.includes('СЕТЬ'))!
    expect(house).toContain('project.dxfLayers.sketchClose')
    expect(house).toContain('project.dxfLayers.sketchCloseNote')
    // Крупный слой второго наброска не получает: он и так читается.
    expect(network).not.toContain('project.dxfLayers.sketchClose')
  })

  it('названия ролей и заголовки идут через словарь', () => {
    // Храповик считает литералы в разметке, а названия ролей лежат в массиве —
    // мимо него. Проверка держит их в словаре. Имена слоёв при этом остаются
    // как есть: это данные чертежа, а не текст интерфейса.
    const markup = html(createElement(DxfLayerRoleTable, { ...props, segments } as never))
    const interfaceText = [
      ...markup.matchAll(/<option[^>]*>([^<]*)</g),
      ...markup.matchAll(/<th[^>]*>([^<]*)</g),
      ...markup.matchAll(/class="hint"[^>]*>([^<]*)</g),
    ].map((match) => match[1])
    expect(interfaceText.length).toBeGreaterThan(20)
    expect(interfaceText.filter((text) => /[А-Яа-я]/.test(text))).toEqual([])
    expect(markup).toContain('project.dxfLayers.roleUtility')
    expect(markup).toContain('project.dxfLayers.roleIgnore')
  })
})

describe('сверка со схемой генплана на экране', () => {
  const pipes = [
    { id: 'У-1', diameterMm: 300, flowLps: 20 },
    { id: 'У-2', diameterMm: 400, flowLps: 40 },
  ]
  const render = (content: unknown) => html(createElement(MasterPlanView, {
    pipes, content, onChange: () => {}, fieldPrefix: 'mp',
  } as never))

  it('без введённых диаметров генплана расхождений не заявляет', () => {
    // Пустой ввод — это «не сверялись», а не «совпадает».
    const markup = render({})
    expect(markup).toContain('project.masterPlan.titleEmpty')
    expect(markup).not.toContain('project.masterPlan.summaryAgrees')
    expect(markup).not.toContain('project.masterPlan.summaryDiffers')
  })

  it('участок без строки генплана расхождением не считается', () => {
    // Иначе половина сети попала бы в отклонения только потому, что схема о
    // ней молчит, и настоящие расхождения утонули бы в этом списке.
    const markup = render({ segments: [{ id: 'У-1', planDiameterMm: 300 }] })
    const rows = markup.split('<tr>')
    expect(rows.find((row) => row.includes('У-2'))).toContain('project.masterPlan.verdict.noPlanRow')
    expect(markup).toContain('project.masterPlan.summaryAgrees')
  })

  it('расхождение показывается с разницей в шагах ряда', () => {
    const markup = render({ segments: [{ id: 'У-2', planDiameterMm: 300 }] })
    const row = markup.split('<tr>').find((item) => item.includes('У-2'))!
    expect(row).toContain('project.masterPlan.verdict.stepDiffers')
    expect(row).toContain('project.masterPlan.stepDelta')
    expect(markup).toContain('project.masterPlan.summaryDiffers')
  })

  it('участок схемы, которого в проекте нет, назван отдельно', () => {
    // Такая строка остаётся от удалённой трубы: в таблицу ввода она не
    // попадает, и без отдельной строки исчезла бы молча.
    const markup = render({ segments: [{ id: 'У-9', planDiameterMm: 500 }] })
    expect(markup).toContain('project.masterPlan.missing')
    expect(markup).toContain('У-9')
  })
})

describe('прогон комплекта исходных данных', () => {
  const markup = () => html(createElement(SourceBundleRunSection, { projectId: 'p1' }))

  it('без диаметра файл не принимается: он берётся из ТУ, а не из съёмки', () => {
    expect(markup()).toContain('project.bundleRun.needDiameter')
    expect(markup()).toMatch(/type="file"[^>]*disabled/)
  })

  it('порог глубины врезок есть на экране и пуст по умолчанию', () => {
    // Без поля на экране порог остаётся только в движке, и проверить его
    // на сайте нельзя. Пустым он и должен быть: умолчания у него нет.
    const m = markup()
    expect(m).toContain('project.bundleRun.minMainDepth')
    expect(m).toContain('project.bundleRun.minMainDepthHint')
    expect(m).toMatch(/id="bundle-depth-p1"[^>]*value=""/)
  })

  it('границы объекта задаются номерами концевых колодцев и тоже пусты', () => {
    // Съёмка покрывает больше, чем объект: границы заданы техническими
    // условиями и в чертеже ничем не отмечены, вывести их нельзя.
    const m = markup()
    expect(m).toContain('project.bundleRun.firstChamber')
    expect(m).toContain('project.bundleRun.lastChamber')
    expect(m).toMatch(/id="bundle-first-p1"[^>]*value=""/)
    expect(m).toMatch(/id="bundle-last-p1"[^>]*value=""/)
  })
})
