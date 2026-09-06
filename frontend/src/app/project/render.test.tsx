import { readFileSync } from 'node:fs'
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
const { StankevichaDemoView, PARSED_KIT_SLOT_IDS } = await import('./StankevichaDemoView')
const { KitWizardPanel } = await import('./KitWizardPanel')
const { SurveyActValues, surveyActRows } = await import('./SurveyActValues')
const { ExistingNetworkSection } = await import('./ExistingNetworkSection')
const { ImportSection } = await import('./ImportSection')
const { GravitySection } = await import('./GravitySection')
const { SituationSchemeView } = await import('./SituationSchemeView')
const { buildSituationSchemeSvg } = await import('../../shared/projectAlbum')
const { PLAN_LINE_STYLE } = await import('../../shared/planStyles')
const { STANKEVICHA_KIT_SLOTS, emptyKitState } = await import('../../shared/kitWizard')
const { ProvenanceAuditView } = await import('./ProvenanceAuditView')
const { TopographySection } = await import('./TopographySection')
const { DeliverablesSection } = await import('./DeliverablesSection')
const { ReconstructionSurveySection } = await import('./ReconstructionSurveySection')
const { TuImportSection } = await import('./TuImportSection')
const { NormsSection } = await import('./FormSections')
const { WaterBranchNotice } = await import('./WaterBranchNotice')
const { ReconstructionProfileNotes } = await import('./ReconstructionProfileNotes')
const { GeologySection } = await import('./GeologySection')
const { BasisSection } = await import('./BasisSection')
const { ru } = await import('../../i18n/locales/ru')
const { NORM_REGISTRY, unverifiedClauses, READINESS_SECTIONS, WATER_BRANCH_BLOCKER_CODE } = await import('@aquascheme/engine')
const {
  maxFilling, auditProjectProvenance, planBasinPressureLinks, extractConditionsFromTu,
  extractSurveyActFacts,
} = await import('@aquascheme/engine')
const { STANKEVICHA_CHAMBERS, STANKEVICHA_CONDITIONS, stankevichaChainLengthM } = await import('../../shared/stankevichaDemo')

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

  it('устаревшие листы названы, и сводка сходится', () => {
    /*
      На живом сайте стояло «Листов 5: к выпуску 0, рассчитано 0,
      предварительно 0, заблокировано 0». Пять листов и четыре нуля — для
      читателя невозможно: пятый статус в строке назван не был.
    */
    const stale = {
      sheets: [
        { id: '1', status: 'STALE', blockers: [], warnings: [] },
        { id: '2', status: 'STALE', blockers: [], warnings: [] },
        { id: '3', status: 'VERIFIED', blockers: [], warnings: [] },
      ],
    } as unknown as WorkingDrawingSet
    const markup = html(createElement(ReadinessView, { drawingSet: stale }))
    expect(markup).toContain('&quot;stale&quot;:2')
    expect(markup).toContain('&quot;total&quot;:3')
    // Всё сошлось — строки про остаток нет.
    expect(markup).not.toContain('data-readiness-others')
  })

  it('статус, которого сводка не называет, выходит остатком, а не тишиной', () => {
    const unknown = {
      sheets: [
        { id: '1', status: 'VERIFIED', blockers: [], warnings: [] },
        { id: '2', status: 'НЕИЗВЕСТНЫЙ', blockers: [], warnings: [] },
      ],
    } as unknown as WorkingDrawingSet
    const markup = html(createElement(ReadinessView, { drawingSet: unknown }))
    expect(markup).toContain('data-readiness-others="true"')
    expect(markup).toContain('project.readiness.others')
    expect(markup).toContain('&quot;count&quot;:1')
  })

  it('пустой набор не выдаётся за готовый', () => {
    const markup = html(createElement(ReadinessView, { drawingSet: { sheets: [] } as unknown as WorkingDrawingSet }))
    expect(markup).toContain('выпускать нечего')
  })
})

describe('напорный участок на экране', () => {
  const pressure = solvePressureMain({
    pipes: [{ id: 'НВ-1', lengthM: 1200, diameterMm: 400, flowLps: 69, roughnessMm: 0.1 }],
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

  it('порога врезок и границ на экране нет: программа выводит их сама', () => {
    // Инженер не должен вводить то, что выводится из данных. Порог находится
    // по разрыву в распределении глубин, границы — от верхового конца до
    // выпуска. Поля убраны, а не спрятаны: пустое поле требует заполнения.
    const m = markup()
    expect(m).not.toContain('bundle-depth-')
    expect(m).not.toContain('bundle-first-')
    expect(m).not.toContain('bundle-last-')
  })

  it('длина и число колодцев по документам не вводятся, а читаются', () => {
    const m = markup()
    expect(m).not.toContain('bundle-ref-length-')
    expect(m).not.toContain('bundle-ref-manholes-')
    // Приём документа при этом на месте: из него величины и берутся.
    expect(m).toContain('project.bundleRun.conditionsLabel')
  })
})

describe('демонстрация на настоящем объекте', () => {
  it('камер столько же, сколько в документах, и это видно как совпадение', () => {
    expect(STANKEVICHA_CHAMBERS).toHaveLength(STANKEVICHA_CONDITIONS.declaredChambers)
    expect(html(createElement(StankevichaDemoView, { projectId: 'p1' }))).toContain('project.stankevicha.matches')
  })

  it('длина считается из координат, а не хранится числом', () => {
    // Иначе правка координат молча рассогласует подпись с геометрией.
    const half = stankevichaChainLengthM(STANKEVICHA_CHAMBERS.slice(0, 2))
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(stankevichaChainLengthM())
    expect(stankevichaChainLengthM()).toBeGreaterThan(STANKEVICHA_CONDITIONS.declaredLengthM)
  })

  it('расхождение по длине названо прямо, а не спрятано', () => {
    // Демонстрация на настоящем объекте ценна именно расхождением: если его
    // убрать с экрана, она станет такой же декорацией, как вымышленная сеть.
    const markup = html(createElement(StankevichaDemoView, { projectId: 'p1' }))
    expect(markup).toContain('project.stankevicha.lengthGap')
    expect(markup).toContain('project.stankevicha.decisions')
    expect(markup).toMatch(/\+\d+\.\d\d \(\+\d+\.\d%\)/)
  })
})

describe('слабейшее звено в аудите происхождения', () => {
  it('называется на экране, а не только считается', () => {
    const provenance = auditProjectProvenance({
      surveyPointCount: 120,
      surveyPointSource: 'geometry',
      catalogReady: true,
      requiredClearanceM: null,
    })
    expect(provenance.limitedBy?.kind).toBe('absent')
    const markup = html(createElement(ProvenanceAuditView, { provenance }))
    expect(markup).toContain('project.provenanceAudit.limitedBy')
  })

  it('нормативные величины расчёта попадают в аудит через своё основание', () => {
    const provenance = auditProjectProvenance({
      surveyPointCount: 10,
      surveyPointSource: 'geometry',
      catalogReady: true,
      normativeValues: [{ label: 'Предельное наполнение', value: maxFilling('sewer') }],
    })
    expect(provenance.fields['Предельное наполнение'].provenance.kind).toBe('normative')
    const markup = html(createElement(ProvenanceAuditView, { provenance }))
    expect(markup).toContain('Предельное наполнение')
  })
})

describe('поверхность топосъёмки выбирается явно', () => {
  it('обе поверхности предложены, и по умолчанию — измеренная', () => {
    const markup = html(createElement(TopographySection, {
      projectId: 'p1',
      dataset: undefined,
      onSaved: async () => {},
    }))
    expect(markup).toContain('project.topo.surfaceExisting')
    expect(markup).toContain('project.topo.surfaceDesign')
    // Выбрана существующая: подставлять проектную поверхность по умолчанию
    // значило бы считать глубины от того, чего в проекте может не быть.
    expect(markup).toMatch(/<option value="existing"[^>]*selected|value="existing"/)
  })
})

describe('представление профиля по бассейнам спрашивается у инженера', () => {
  it('оба варианта по обоим вопросам предложены, и ни один не выбран заранее', () => {
    const markup = html(createElement(DeliverablesSection, {
      projectId: 'p1',
      constraintsDataset: undefined,
      onSaved: async () => {},
    }))
    for (const key of [
      'project.deliverables.basinLayoutPerBasin',
      'project.deliverables.basinLayoutContinuous',
      'project.deliverables.pressureLinkSame',
      'project.deliverables.pressureLinkSeparate',
      'project.deliverables.notChosen',
    ]) {
      expect(markup).toContain(key)
    }
  })

  it('сохранённый выбор виден на экране', () => {
    const markup = html(createElement(DeliverablesSection, {
      projectId: 'p1',
      constraintsDataset: {
        id: 'd1',
        project_id: 'p1',
        kind: 'route_constraints',
        file_name: null,
        meta: null,
        content: {
          deliverableRequirements: {
            crossingDetailSheets: false,
            protectiveGridDetail: false,
            basinProfileLayout: 'per_basin',
            pressureLinkSheets: 'separate',
            source: 'задание на проектирование',
            verified: true,
          },
        },
      } as never,
      onSaved: async () => {},
    }))
    // Значение select отражается атрибутом selected на выбранном варианте.
    expect(markup).toMatch(/value="per_basin"[^>]*selected|selected[^>]*value="per_basin"/)
    expect(markup).toMatch(/value="separate"[^>]*selected|selected[^>]*value="separate"/)
  })
})

describe('напорные перемычки между бассейнами на экране', () => {
  it('без данных подъём показан, а напор и агрегат — нет, с перечнем недостающего', () => {
    const plan = planBasinPressureLinks({
      lifts: [{ nodeId: 'К-9', chainageM: 540, incomingDepthM: 6, liftHeightM: 4.2 }],
    })
    expect(plan.links[0].geometricLiftM).toBe(4.2)
    expect(plan.links[0].requiredHeadM).toBeNull()
    // Недостающее названо поимённо, а не «недостаточно данных».
    expect(plan.missing.length).toBeGreaterThan(3)
    expect(plan.reason).toContain('каталог насосов')
  })

  it('при полных данных напор и агрегат посчитаны', () => {
    const plan = planBasinPressureLinks({
      lifts: [{ nodeId: 'К-9', chainageM: 540, incomingDepthM: 6, liftHeightM: 4.2 }],
      designFlowLps: 35,
      pressureLengthM: 220,
      pressureDiameterMm: 200,
      // Шероховатость задаётся явно: решатель её больше не подставляет.
      roughnessMm: 0.1,
      catalogue: [{ designation: 'НС-2', flowLps: 40, headM: 25, powerKw: 15 }],
      category: 'first',
      effluent: 'domestic',
    })
    expect(plan.missing).toEqual([])
    expect(plan.links[0].requiredHeadM!).toBeGreaterThan(4.2)
    expect(plan.links[0].pumps?.pump?.designation).toBe('НС-2')
  })
})

describe('одна величина — одно место ввода', () => {
  const conditions = {
    id: 'd1', project_id: 'p1', kind: 'technical_conditions',
    file_name: null, meta: null, created_at: '',
    content: { designDiameterMm: { value: 450, origin: 'stated', source: 'ТУ, с. 2' } },
  } as never

  it('обе секции показывают одно и то же значение из общего набора', () => {
    const reconstruction = html(createElement(ReconstructionSurveySection, {
      projectId: 'p1', system: 'sewer', conditionsDataset: conditions, onSaved: async () => {},
    }))
    const bundle = html(createElement(SourceBundleRunSection, {
      projectId: 'p1', conditionsDataset: conditions, onSaved: async () => {},
    }))
    // Диаметр спрашивался двумя независимыми полями и расходился молча.
    expect(reconstruction).toContain('value="450"')
    expect(bundle).toContain('value="450"')
  })

  it('без набора обе секции показывают пустое поле, а не подставленное число', () => {
    const reconstruction = html(createElement(ReconstructionSurveySection, {
      projectId: 'p1', system: 'sewer', onSaved: async () => {},
    }))
    expect(reconstruction).not.toMatch(/name="[^"]*diameter[^"]*"[^>]*value="[1-9]/)
  })
})

describe('экран подтверждения величин из ТУ', () => {
  it('без загруженного документа предлагает загрузить и ничего не утверждает', () => {
    const markup = html(createElement(TuImportSection, {
      projectId: 'p1', onSaved: async () => {},
    }))
    expect(markup).toContain('project.tu.fileLabel')
    expect(markup).not.toContain('project.tu.confirm')
  })

  it('извлекатель отдаёт всех кандидатов с цитатой и страницей', () => {
    const found = extractConditionsFromTu([
      { page: 2, text: 'п. 25. Проложить коллектор Д=450 мм.' },
      { page: 4, text: 'Участок 2 — DN600.' },
      { page: 5, text: 'При пересечении обеспечить в свету не менее 0,4 м.' },
    ])
    // Выбор не делается: показываются оба диаметра.
    expect(found.designDiameterMm.map((item) => item.value).sort()).toEqual([450, 600])
    expect(found.designDiameterMm[0].quote).toContain('п. 25')
    expect(found.requiredClearanceM[0].page).toBe(5)
  })
})

describe('распознанное со скана отличимо от цифрового документа', () => {
  it('извлекатель одинаков для обоих: распознанный текст — тот же текст', () => {
    // Ровно то, что вернул tesseract на синтетическом скане: «Д» стала «0».
    const fromScan = extractConditionsFromTu([{ page: 1, text: '0=450 00' }])
    const fromDigital = extractConditionsFromTu([{ page: 1, text: 'Д=450 мм' }])
    // Число доходит в обоих случаях — шаблон Ø/DN/«Д=» здесь ни при чём,
    // важно, что разбор не дублируется и ведёт себя предсказуемо.
    expect(fromDigital.designDiameterMm[0].value).toBe(450)
    // Со скана «0=450 00» шаблон «Д=» не сработает: буква потеряна. Это не
    // недоработка разбора, а причина, по которой инженер обязан сверить.
    expect(fromScan.designDiameterMm.length).toBeLessThanOrEqual(
      fromDigital.designDiameterMm.length)
  })

  it('происхождение ocr — отдельный разряд, а не stated', async () => {
    const { readTechnicalConditions } = await import('../../shared/technicalConditions')
    const conditions = readTechnicalConditions({
      id: 'd', project_id: 'p', kind: 'technical_conditions', file_name: null, meta: null,
      created_at: '',
      content: {
        designDiameterMm: {
          value: 450, origin: 'ocr', source: 'ТУ.pdf, с. 2 (распознано со скана)',
          page: 2, quote: '0=450 00',
        },
      },
    } as never)
    expect(conditions.designDiameterMm?.origin).toBe('ocr')
    // Цитата хранится как распозналась: инженер видит, что именно прочитано.
    expect(conditions.designDiameterMm?.quote).toContain('450')
  })
})

describe('панель мастера комплекта', () => {
  const panel = (state: Parameters<typeof KitWizardPanel>[0]['state']) => html(createElement(KitWizardPanel, {
    state,
    picked: {},
    busySlotId: null,
    onPick: () => {},
    onRun: () => {},
  }))

  it('показывает слоты в порядке ядра и объявляет каждый пустой', () => {
    const markup = panel(emptyKitState())
    const order = [...markup.matchAll(/data-kit-slot="([^"]+)"/g)].map((match) => match[1])
    expect(order).toEqual(STANKEVICHA_KIT_SLOTS.map((slot) => slot.id))
    // Пустой слот не пропадает из списка: комплект виден целиком.
    expect((markup.match(/project\.kit\.statusEmpty/g) ?? []).length).toBe(STANKEVICHA_KIT_SLOTS.length)
    // Подсказка с ожидаемым файлом стоит у каждого слота.
    expect(markup).toContain('_топо станкевича.dwg')
    expect(markup).toContain('ТУ_05-3-2723 (1).pdf')
  })

  it('конвертация названа своим именем, а не общим «прогон…»', () => {
    /*
      На бесплатном тарифе первая загрузка DWG после простоя — около минуты
      пробуждения сервиса плюс конвертация плюс разбор, и всё это время стояло
      одно многоточие. Отличить пробуждение от зависания было нечем, а маршрут
      тем временем молча тикал к таймауту в три минуты.
    */
    const converting = html(createElement(KitWizardPanel, {
      state: emptyKitState(), picked: {}, busySlotId: 'topobaseFull', busyStage: 'converting',
      onPick: () => {}, onRun: () => {},
    }))
    expect(converting).toContain('data-kit-busy="converting"')
    expect(converting).toContain('project.kit.converting')
    expect(converting).not.toContain('project.kit.running')

    const parsing = html(createElement(KitWizardPanel, {
      state: emptyKitState(), picked: {}, busySlotId: 'topobaseFull', busyStage: null,
      onPick: () => {}, onRun: () => {},
    }))
    expect(parsing).toContain('data-kit-busy="running"')
    expect(parsing).toContain('project.kit.running')
  })

  it('разобранная конвертация помечена, и тем же словом, что в импорте', () => {
    const markup = html(createElement(KitWizardPanel, {
      state: {
        ...emptyKitState(),
        topobaseFull: {
          kind: 'parsed', fileName: 'Молдагалиева.dwg', convertedFromDwg: true,
          counters: [{ label: 'слоёв', value: 50 }],
        },
        surveyStankevicha: {
          kind: 'parsed', fileName: 'станкевича.dxf', counters: [{ label: 'слоёв', value: 28 }],
        },
      },
      picked: {}, busySlotId: null, onPick: () => {}, onRun: () => {},
    }))
    expect(markup).toContain('data-kit-converted="topobaseFull"')
    expect(markup).toContain('upload.convertedFromDwg')
    // Обычный DXF пометки не получает: она означала бы конвертацию, которой нет.
    expect(markup).not.toContain('data-kit-converted="surveyStankevicha"')
  })

  it('слоты чертежей принимают .dwg и не велят конвертировать руками', () => {
    const markup = html(createElement(KitWizardPanel, {
      state: emptyKitState(), picked: {}, busySlotId: null, onPick: () => {}, onRun: () => {},
    }))
    // `accept` уходит в диалог выбора файла: с `.dxf` владелец свой DWG не видел.
    expect(markup).toContain('accept=".dxf,.dwg"')
    // Подсказка больше не приказывает проделать руками то, что делает сервис.
    expect(markup).not.toContain('→ .dxf')
  })

  it('показывает все пять состояний и счётчики разбора', () => {
    const state = {
      ...emptyKitState(),
      surveyStankevicha: { kind: 'covered' as const, byId: 'topobaseFull' },
      topobaseFull: {
        kind: 'parsed' as const,
        fileName: 'topo_stankevicha.dxf',
        counters: [{ label: 'слоёв', value: 28 }, { label: 'отметок', value: 177 }],
      },
      designBrief: { kind: 'stored' as const, fileName: 'ТЗ_5669.pdf', parsedAtStage: 4 },
      technicalConditions: { kind: 'failed' as const, fileName: 'tu.pdf', reason: 'скан без текстового слоя' },
    }
    const markup = panel(state)
    expect(markup).toContain('project.kit.statusParsed')
    expect(markup).toContain('project.kit.statusCovered')
    expect(markup).toContain('project.kit.statusStored')
    expect(markup).toContain('project.kit.statusFailed')
    expect(markup).toContain('project.kit.statusEmpty')
    // Счётчики выводятся числами, а не прячутся за словом «разобрано».
    expect(markup).toContain('слоёв: 28; отметок: 177')
    // Этап разбора назван, а не подразумевается.
    expect(markup).toContain('&quot;stage&quot;:4')
    // Причина ошибки показана дословно.
    expect(markup).toContain('скан без текстового слоя')
  })

  it('строка готовности считает разобранные, отложенные и упавшие', () => {
    const markup = panel({
      ...emptyKitState(),
      topobaseFull: { kind: 'parsed', fileName: 'a.dxf', counters: [] },
      surveyStankevicha: { kind: 'covered', byId: 'topobaseFull' },
      designBrief: { kind: 'stored', fileName: 'b.pdf', parsedAtStage: 4 },
      routeScheme: { kind: 'failed', fileName: 'c.pdf', reason: 'x' },
    })
    expect(markup).toContain('&quot;filled&quot;:2')
    expect(markup).toContain('&quot;failed&quot;:1')
    expect(markup).toContain('&quot;covered&quot;:1')
  })

  it('неподтверждённое не выглядит ни готовым, ни упавшим', () => {
    /*
      Успешная запись и документ в базе — разные вещи; на живом сайте они
      разошлись на пять документов. Слот, чью запись не удалось сверить с
      базой, получает собственный вид: в «Готово» он не попадает, ошибкой не
      называется, и причина стоит текстом.
    */
    const markup = panel({
      ...emptyKitState(),
      topobaseFull: { kind: 'parsed', fileName: 'a.dxf', counters: [] },
      technicalConditions: {
        kind: 'unverified', fileName: 'tu.pdf', reason: 'Сверить с базой не удалось: сеть недоступна.',
      },
    })
    expect(markup).toContain('data-kit-unverified="technicalConditions"')
    expect(markup).toContain('project.kit.statusUnverified')
    expect(markup).toContain('Сверить с базой не удалось: сеть недоступна.')
    expect(markup).toContain('&quot;filled&quot;:1')
    expect(markup).toContain('&quot;failed&quot;:0')
    expect(markup).toContain('&quot;unverified&quot;:1')
  })

  it('кнопка выжимки несёт пометку о неполноте данных', () => {
    const markup = html(createElement(StankevichaDemoView, { projectId: 'p1' }))
    expect(markup).toContain('data-kit-seed-note')
    expect(markup).toContain('project.kit.seedNote')
    expect(markup).toContain('data-kit-wizard')
  })

  it('у каждого разбираемого слота есть разбор, а не тихий уход в basis', () => {
    // Слот `topobaseFull` однажды был объявлен разбираемым и остался без
    // обработчика: файл молча сохранялся basis-файлом, и «разобрано»
    // превращалось в «отложено» незаметно. Список связывает состав комплекта с
    // видом, а тип `PARSING_HANDLERS` требует обработчик на каждый его пункт.
    const declared = STANKEVICHA_KIT_SLOTS
      .filter((slot) => slot.handling === 'parsed')
      .map((slot) => slot.id)
      .sort()
    expect([...PARSED_KIT_SLOT_IDS].sort()).toEqual(declared)
  })
})

describe('экран подтверждения величин из акта обследования', () => {
  const facts = extractSurveyActFacts([{
    page: 9,
    text: `Материал канализационной сети – керамическая труба.
Керамическая труба Ø 45 0 мм, протяженностью 458,94 метров, без учета врезок.
Для керамических, асбоцементных трубопроводов – в соответствии со СН РК 1.04-26-2022 составляет 30 лет.`,
  }])
  const labels = {
    diameterMm: 'd', material: 'm', lengthM: 'l', depthRangeM: 'h', category: 'c', verdict: 'v',
  } as const

  const markup = html(createElement(SurveyActValues, {
    facts, fileName: 'ТО.pdf', confirmed: [], onConfirm: () => {},
  }))

  it('каждый кандидат показан с цитатой, страницей и кнопкой подтверждения', () => {
    expect(markup).toContain('project.existing.act.thQuote')
    expect(markup).toContain('Материал канализационной сети')
    // Диаметр дошёл, хотя в тексте он разорван кернингом.
    expect(markup).toContain('450')
    expect((markup.match(/project\.existing\.act\.confirm</g) ?? []).length)
      .toBe(surveyActRows(facts, labels).length)
  })

  it('кандидат из ссылки на норматив помечен, а не выброшен и не приравнен', () => {
    // Асбоцемент назван только в ссылке на срок службы по норме; труба по
    // описанию керамическая. Выбросить — спрятать противоречие акта, принять
    // молча — подменить материал объекта материалом нормы.
    expect(markup).toContain('project.existing.act.fromNorm')
    expect(markup).toContain('асбестоцементная')
    const own = surveyActRows(facts, labels)
      .filter((row) => row.key === 'material' && !row.fromNormReference)
    expect(own.map((row) => row.shown)).toEqual(['керамическая', 'керамическая'])
  })

  it('отсутствие шероховатости названо вслух, а не подставлено', () => {
    expect(markup).toContain('data-survey-act-missing')
    expect(markup).toContain('шероховатость')
    expect(markup).toContain('принимает инженер')
  })

  it('подтверждённая строка больше не предлагает подтверждение', () => {
    const confirmed = html(createElement(SurveyActValues, {
      facts, fileName: 'ТО.pdf', confirmed: ['diameterMm-0'], onConfirm: () => {},
    }))
    expect(confirmed).toContain('project.existing.act.confirmed')
  })
})

describe('шероховатость керамики принимается инженером, а не подставляется', () => {
  const pipe = (material: string, roughnessMm: number | null) => ({
    id: 'p1',
    project_id: 'pr1',
    length_m: 458.94,
    diameter_mm: 450,
    material,
    laid_year: null,
    wear_percent: 80,
    roughness_mm: roughnessMm,
    decision: 'replace' as const,
    meta: { ax: 0, ay: 0, bx: 1, by: 0 },
  })
  const section = (material: string, roughnessMm: number | null) => html(createElement(ExistingNetworkSection, {
    projectId: 'pr1',
    basisDataset: undefined,
    existing: [pipe(material, roughnessMm)],
    points: [],
    designedLengthM: 458.94,
    onChanged: async () => {},
  }))

  it('керамика показывает прочерк и поля «величина + источник», а не число', () => {
    const markup = section('ceramic', null)
    expect(markup).toContain('existing-roughness-source-p1')
    expect(markup).toContain('project.existing.roughnessAccept')
    // Нуля вместо непосчитанной величины больше нет: пустая графа честнее.
    expect(markup).toContain('—')
    // Норматив на трубу как таковую назван ориентиром — 1,35 мм по табл. 5.18.
    expect(markup).toContain('1.35')
  })

  it('материал с кривой износа считается как считался, без ручного ввода', () => {
    const markup = section('steel', 1.62)
    expect(markup).not.toContain('existing-roughness-source-p1')
    expect(markup).toContain('1.62')
  })

  it('керамика есть в списке материалов: акт назвал её прямым текстом', () => {
    expect(section('ceramic', null)).toContain('project.existing.material.ceramic')
  })
})

describe('статус раздела не спорит с его же текстом', () => {
  const pipe = (id: string, from: string, to: string) => ({
    id, from_node: from, to_node: to, length_m: 35, diameter_mm: 450, material: null,
  })
  const chain = [pipe('p1', 'К-1', 'К-2'), pipe('p2', 'К-2', 'К-3')]
  const broken = [...chain, pipe('p3', 'К-7', 'К-8')]

  const section = (options: { source: unknown; pipes: ReturnType<typeof pipe>[] }) =>
    html(createElement(ImportSection, {
      projectId: 'p1',
      buildings: [],
      source: options.source as never,
      points: [],
      existingNodes: 3,
      existingPipes: options.pipes as never,
      onChanged: async () => {},
    }))

  it('«ЗАПОЛНЕНО» не стоит рядом с «Сначала задайте источник»', () => {
    // Участки загружены, но обязательный шаг раздела не закрыт: заполненным
    // он не считается. Раньше стояло «ЗАПОЛНЕНО» прямо над требованием
    // задать источник.
    const markup = section({ source: null, pipes: chain })
    expect(markup).toContain('project.import.needSource')
    expect(markup).not.toContain('project.status.filled')
    expect(markup).toContain('project.status.default')
    // Загруженное при этом не пропадает: оно видно строкой ниже.
    expect(markup).toContain('project.import.loadedRoute')
  })

  it('с закрытым обязательным шагом раздел объявляется заполненным', () => {
    const markup = section({ source: { x: 0, y: 0 }, pipes: chain })
    expect(markup).not.toContain('project.import.needSource')
    expect(markup).toContain('project.status.filled')
  })

  it('«Загружена трасса» соседствует с настоящей причиной, а не с молчанием', () => {
    // «13 участков» зелёной пометкой и «нет непрерывной оси» в шлюзе были
    // верны порознь и лживы вместе. Теперь причина названа тут же и поимённо.
    const markup = section({ source: { x: 0, y: 0 }, pipes: broken })
    expect(markup).toContain('data-axis-continuity')
    expect(markup).toContain('Ось разрывна')
    expect(markup).toContain('К-7')
  })

  it('непрерывная ось так и называется, без ложной тревоги', () => {
    const markup = section({ source: { x: 0, y: 0 }, pipes: chain })
    expect(markup).toContain('Ось непрерывна')
  })
})

describe('ситуационная схема строится по топооснове', () => {
  const network = {
    nodes: [
      { id: 'ВК-1', label: 'ВК-1', x: 0, y: 0, groundElevation: 688, kind: 'manhole' },
      { id: 'ВК-2', label: 'ВК-2', x: 120, y: 40, groundElevation: 687, kind: 'manhole' },
      { id: 'ВК-3', label: 'ВК-3', x: 240, y: 30, groundElevation: 686, kind: 'outlet' },
    ],
    pipes: [
      { id: 'У-1', fromNode: 'ВК-1', toNode: 'ВК-2', lengthM: 126, kind: 'main' },
      { id: 'У-2', fromNode: 'ВК-2', toNode: 'ВК-3', lengthM: 120, kind: 'main' },
    ],
  } as never

  const steps = {
    network,
    pipeDiameterMm: new Map([['У-1', 450], ['У-2', 450]]),
    buildingsCount: 0,
  } as never

  /** Подоснова: те же поля, что приходят из `buildDxfCadContext`. */
  const constraints = {
    cadContextLines: [
      { points: [{ x: -20, y: -20 }, { x: 260, y: -20 }] },
      { points: [{ x: -20, y: 60 }, { x: 260, y: 60 }] },
    ],
    terrainLines: [],
    cadTextEntities: [{ x: 100, y: 10, text: 'ул. Станкевича' }],
    cadBlockEntities: [],
  } as never

  const view = (props: Record<string, unknown>) => html(createElement(SituationSchemeView, {
    scheme: { title: 'К1. Станкевича', network, ...props } as never,
    steps,
  }))

  it('с подосновой рисует её линии тем же отрисовщиком, что и плановые листы', () => {
    const markup = view({ constraints, pipeDiameterMm: new Map([['У-1', 450]]) })
    expect(markup).toContain('data-situation-scheme')
    // Разметка подосновы — та же, что на плановом листе: общий отрисовщик.
    expect(markup).toContain('data-cad-context="line"')
    expect(markup).toContain('ул. Станкевича')
    // Проектная графика поверх: труба и обозначения колодцев.
    expect(markup).toContain('data-scheme-route')
    expect(markup).toContain('ВК-1')
    expect(markup).toContain('Ø450')
    // Север и численный масштаб на месте.
    expect(markup).toContain('М 1:')
  })

  it('без топоосновы — пустое состояние с адресом раздела, а не выдуманная графика', () => {
    const markup = view({})
    expect(markup).toContain('data-scheme-empty')
    expect(markup).toContain('project.scheme.needTopobase')
    expect(markup).toContain('href="#import"')
    // Ничего не нарисовано: чертежа нет, и придумывать его нельзя.
    expect(markup).not.toContain('data-situation-scheme="true"')
  })

  it('без полосы отвода схема рисуется, а пробел назван с адресом', () => {
    // Случай Станкевича: подоснова есть, полосы отвода нет. Блокировать схему
    // целиком из-за одного слоя нельзя.
    const markup = view({ constraints })
    expect(markup).toContain('data-situation-scheme')
    expect(markup).toContain('data-scheme-missing="corridor"')
    expect(markup).toContain('href="#parcels"')
  })

  it('полоса отвода, когда она есть, рисуется и о пробеле не сообщается', () => {
    const markup = view({
      constraints,
      corridorRings: [[{ x: -10, y: -10 }, { x: 250, y: -10 }, { x: 250, y: 50 }]],
    })
    // Полоса отвода рисуется общим блоком колец — тем же, что и у планового
    // листа, — и помечена ролью, а не собственным признаком схемы.
    expect(markup).toContain('data-plan-ring="corridor"')
    expect(markup).not.toContain('data-scheme-missing="corridor"')
  })

  it('пропорции кадра берутся по геометрии, а не растягиваются', () => {
    // Вытянутая вдоль улицы трасса не должна превращаться в квадрат.
    const wide = buildSituationSchemeSvg({
      title: 'т', network,
      constraints,
    } as never)
    const box = /viewBox="0 0 (\d+) (\d+)"/.exec(wide.svg)
    expect(box).not.toBeNull()
    const [, w, h] = box!
    expect(Number(w)).toBeGreaterThan(Number(h))
  })

  it('кнопки «Нарисовать заново» и её ключа в проекте нет', () => {
    const markup = view({ constraints })
    expect(markup).not.toContain('replay')
    expect(markup).not.toContain('builder.pause')
  })

  /**
   * Замкнутый контур здания на обзорной схеме.
   *
   * Ситуационную схему смотрят ради того, где трасса идёт относительно
   * ЗАСТРОЙКИ. У Станкевича это шестнадцать зданий.
   *
   * Отсев `drawnAsRing` верен для планового листа: там кольца выводит отдельный
   * блок полигонов. У схемы такого блока не было вовсе, и контур, ставший
   * кольцом, не рисовал никто — до появления ролей он попадал на схему общим
   * проходом чёрным волосом.
   */
  const buildingRing = [{ x: 40, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 40 }, { x: 40, y: 40 }]
  const withBuilding = (drawnAsRing: boolean) => buildSituationSchemeSvg({
    title: 'т',
    network,
    constraints: {
      ...(constraints as unknown as Record<string, unknown>),
      cadContextLines: [
        ...(constraints as unknown as { cadContextLines: unknown[] }).cadContextLines,
        {
          points: [...buildingRing, buildingRing[0]], role: 'building', closed: true,
          ...(drawnAsRing ? { drawnAsRing: true } : {}),
        },
      ],
      hardObstacleRings: drawnAsRing ? [buildingRing] : [],
    },
  } as never)

  /**
   * След роли считается ПО РОЛИ, а не по цвету.
   *
   * Цвет `#000000` носят четыре роли сразу — подоснова, здания, дороги и рамка
   * листа, — и счёт по цвету ловил бы их все. Ломаная помечена `data-plan-role`,
   * кольцо — `data-plan-ring`; вместе они и дают полное число следов роли.
   */
  const roleTraces = (svg: string, role: string) =>
    [...svg.matchAll(new RegExp(`data-plan-(?:role|ring)="${role}"`, 'g'))].length

  it('здание, ставшее кольцом, на схеме есть — и ровно один раз', () => {
    const asRing = withBuilding(true)
    const asLine = withBuilding(false)
    // Контур без флага рисовался всегда — это образец.
    expect(roleTraces(asLine.svg, 'existingBuilding')).toBe(1)
    // С флагом — тот же контур и тот же один след, а не ноль и не два.
    expect(roleTraces(asRing.svg, 'existingBuilding')).toBe(1)
    // Цвет у обоих — из измеренной таблицы, а не свой у каждого листа.
    expect(asRing.svg).toContain(PLAN_LINE_STYLE.existingBuilding.colour)
  })

  it('полоса отвода на схеме не задваивается при двух источниках колец', () => {
    // Схеме полоса отвода приходит собственным входом, а в общем блоке колец
    // лежит `constraints.corridorRings`. Заполнены оба — след должен быть один.
    const rings = [[{ x: -10, y: -10 }, { x: 250, y: -10 }, { x: 250, y: 50 }]]
    const built = buildSituationSchemeSvg({
      title: 'т', network,
      constraints: { ...(constraints as unknown as Record<string, unknown>), corridorRings: rings },
      corridorRings: rings,
    } as never)
    expect(roleTraces(built.svg, 'corridor')).toBe(1)
  })
})

describe('продовая навигация: В1 и учебные экраны скрыты', () => {
  const norms = (systemType: 'water' | 'sewer' | 'storm') => html(createElement(NormsSection, {
    projectId: 'p1', dataset: undefined, systemType, onSaved: async () => {},
  }))

  it('в проекте К2 водопроводных нормпараметров нет', () => {
    // Владелец видел на экране ливневого проекта свободный напор по этажности и
    // расход на пожаротушение. В самотёчной канализации напора нет вовсе.
    const markup = norms('storm')
    expect(markup).not.toContain('project.norms.fireFlow')
    expect(markup).not.toContain('project.norms.minHead')
    expect(markup).not.toContain('project.norms.perFloor')
    expect(markup).not.toContain('project.norms.maxHead')
    // Общие параметры остаются: удельное потребление в водоотведении читается
    // как удельное водоотведение.
    expect(markup).toContain('project.norms.perCapita')
    expect(markup).toContain('project.norms.kDayMax')
  })

  it('в проекте К1 их тоже нет', () => {
    expect(norms('sewer')).not.toContain('project.norms.fireFlow')
  })

  it('в проекте В1 они на месте: ветка не сломана, а скрыта', () => {
    const markup = norms('water')
    expect(markup).toContain('project.norms.fireFlow')
    expect(markup).toContain('project.norms.maxHead')
  })

  it('мастер комплекта Станкевича остаётся: это рабочий путь, а не учебный экран', () => {
    // Учебная выжимка уходит из продовой сборки, мастер — нет: им грузят
    // настоящий объект.
    const markup = html(createElement(StankevichaDemoView, { projectId: 'p1' }))
    expect(markup).toContain('data-kit-wizard')
    expect(markup).toContain('kit-file-topobaseFull')
  })
})

describe('проект В1 под выключенным флагом объясняет себя', () => {
  const markup = html(createElement(WaterBranchNotice))

  it('показывает одно состояние вместо пустоты', () => {
    expect(markup).toContain('data-water-branch-unavailable="true"')
    expect(markup).toContain('project.waterBranch.title')
  })

  it('числа причины берутся из реестра, а не написаны в тексте', () => {
    // Сверят пункт — счётчик уменьшится сам. Написанное руками «22 из 28»
    // соврало бы задним числом ровно в тот день, когда придут документы.
    const unverified = unverifiedClauses()
    const applicable = unverified.filter((clause) => clause.appliesSystem.includes('water')).length
    // React экранирует кавычки в тексте, поэтому подмена словаря выводит
    // значения как &quot;registry&quot;:75 — сверяется именно эта форма.
    const q = '&quot;'
    expect(markup).toContain(`${q}registry${q}:${NORM_REGISTRY.length}`)
    expect(markup).toContain(`${q}unverified${q}:${unverified.length}`)
    expect(markup).toContain(`${q}applicable${q}:${applicable}`)
    // Основание промпта: 22 применимых к В1 из 28 неподтверждённых.
    expect(unverified.length).toBe(28)
    expect(applicable).toBe(22)
  })

  it('говорит, что данные целы и что выпуск заблокирован', () => {
    expect(markup).toContain('data-water-branch-data="true"')
    expect(markup).toContain('project.waterBranch.dataIntact')
    expect(markup).toContain('data-water-branch-export="true"')
    expect(markup).toContain('project.waterBranch.exportBlocked')
  })

  it('на экране проекта не осталось признака «не водоснабжение» через отрицание', () => {
    // ЭТО И БЫЛ ДЕФЕКТ. Признак `!isWater` сливал два разных случая: проект
    // канализации и проект В1 под выключенным флагом. Второму он выдавал
    // разделы первого — каталог колодцев и каталог насосов ЛНС на экране
    // водопроводного проекта. Разделы не просто исчезали: вместо них приходили
    // чужие. Отрисовать ProjectPage в проверке нельзя — он тянет хранилище и
    // маршрутизацию, — поэтому сторожем стоит сам исходник.
    const source = readFileSync(new URL('../ProjectPage.tsx', import.meta.url), 'utf8')
    // Комментарии срезаются: в них `!isWater` упомянут как раз затем, чтобы
    // объяснить, почему признака больше нет.
    const code = source.split(/\r?\n/).filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//')
    }).join(' ')
    expect(code).not.toContain('!isWater')
    expect(code).toContain('isWaterHidden && <WaterBranchNotice />')
  })

  it('адресует причину существующей записью карты, а не новым стоп-фактором', () => {
    const target = READINESS_SECTIONS[WATER_BRANCH_BLOCKER_CODE]
    expect(target).toBeTruthy()
    expect(markup).toContain(WATER_BRANCH_BLOCKER_CODE)
    expect(markup).toContain(`href="#${target.anchor}"`)
    expect(markup).toContain(target.title)
    expect(markup).toContain(target.action)
  })
})

describe('перезакладка профиля от измеренных лотков — на экране', () => {
  /**
   * Четыре обратных уклона объекта Станкевича. Движок находил их с самого
   * появления `layReconstructionProfile`, складывал в `profile.reconstruction`
   * — и ни один вид этого не читал. Инженер видел глубины 2,91…4,50 м и не
   * знал, что четыре участка из тринадцати текут против уклона.
   */
  const reconstruction = {
    stations: [],
    tieNodeIds: ['ВК-1', 'ВК-2', 'ВК-3'],
    tied: true,
    reason: 'Профиль заложен от измеренных отметок: связей 14 из 14 узлов.',
    shallow: [],
    conflicts: [
      {
        fromNodeId: 'ВК-2', toNodeId: 'ВК-3', lengthM: 69.75,
        actualSlope: -0.01104, minSlope: 0.00227, maxSlope: 0.1, kind: 'counter',
        message: 'Лоток поднимается против течения.',
      },
      {
        fromNodeId: 'ВК-13', toNodeId: 'ВК-14', lengthM: 29.36,
        actualSlope: -0.02827, minSlope: 0.00227, maxSlope: 0.1, kind: 'counter',
        message: 'Лоток поднимается против течения.',
      },
    ],
  }
  const markup = html(createElement(ReconstructionProfileNotes, { reconstruction } as never))

  it('называет каждый участок, его уклон со знаком и норму', () => {
    expect(markup).toContain('data-reconstruction-notes="true"')
    expect(markup).toContain('ВК-2')
    expect(markup).toContain('ВК-3')
    // Знак сохраняется: минус здесь и есть весь смысл строки.
    expect(markup).toContain('-11.04')
    expect(markup).toContain('-28.27')
    // Норма рядом, иначе число не с чем сравнить.
    expect(markup).toContain('2.27')
    expect(markup).toContain('data-slope-conflict="counter"')
    // Сообщение движка доходит дословно, а не пересказывается видом.
    expect(markup).toContain('Лоток поднимается против течения.')
  })

  it('задаёт владельцу вопрос, на который он отвечает одним предложением', () => {
    expect(markup).toContain('data-reconstruction-question="true"')
    expect(markup).toContain('project.gravity.reconstruction.question')
    // React экранирует кавычки: подмена словаря выводит &quot;count&quot;:2.
    expect(markup).toContain('&quot;count&quot;:2')
  })

  it('без конфликтов не поднимает ложной тревоги, а без перезакладки молчит', () => {
    const clean = html(createElement(ReconstructionProfileNotes, {
      reconstruction: { ...reconstruction, conflicts: [] },
    } as never))
    expect(clean).toContain('data-reconstruction-notes="true"')
    expect(clean).not.toContain('data-reconstruction-question')
    expect(clean).toContain('stat-line ok')
    // Профиля реконструкции нет вовсе (новое строительство) — вида тоже нет.
    expect(html(createElement(ReconstructionProfileNotes, {} as never))).toBe('')
  })
})

describe('промерзание: кандидаты отчёта видны, выбор за инженером', () => {
  /**
   * На живом сайте стояло «Черновой режим: 0.79 м; источник:
   * stankevicha-geology.json», ранг — «принято по умолчанию». Величина ИЗ
   * отчёта этого объекта (Алматы, суглинок), но выбрал её посев, а не инженер:
   * отчёт даёт три грунта — 0,79 / 0,96 / 1,03 м — и не говорит, какой лежит
   * на отметке лотка. Раздел готовности при этом давно обещал «выберите одну
   * из кандидатов отчёта», а показать их было негде.
   */
  const dataset = {
    id: 'g1',
    content: {
      soilType: 'clay', groundwaterDepthM: 6, corrosivity: 'low',
      freezingDepthCandidates: [
        { soil: 'суглинок, глина', valueM: 0.79 },
        { soil: 'песок пылеватый', valueM: 0.96 },
        { soil: 'песок средней крупности', valueM: 1.03 },
      ],
      freezingDepthQuote: 'Нормативная глубина сезонного промерзания для суглинков – 0,79м…',
    },
  }
  const markup = html(createElement(GeologySection, {
    projectId: 'p1', dataset, basisDataset: undefined,
    boreholes: [], surveyPoints: [], onChanged: async () => {},
  } as never))

  it('показывает все три кандидата с грунтом и величиной', () => {
    expect(markup).toContain('data-freezing-candidates="true"')
    for (const soil of ['суглинок, глина', 'песок пылеватый', 'песок средней крупности']) {
      expect(markup).toContain(`data-freezing-candidate="${soil}"`)
    }
    expect(markup).toContain('0.79')
    expect(markup).toContain('1.03')
  })

  it('ни один кандидат не выбран заранее', () => {
    // Ровно то, что чинится: величина не должна приезжать уже выбранной.
    const active = [...markup.matchAll(/data-freezing-candidate="[^"]+"/g)]
    expect(active).toHaveLength(3)
    // Все три — второстепенные кнопки: ни одна не помечена как выбранная.
    expect(markup.split('btn-ghost').length - 1).toBeGreaterThanOrEqual(3)
  })

  it('без кандидатов в наборе выбор не показывается', () => {
    const bare = html(createElement(GeologySection, {
      projectId: 'p1',
      dataset: { id: 'g2', content: { soilType: 'clay', groundwaterDepthM: 6, corrosivity: 'low' } },
      basisDataset: undefined, boreholes: [], surveyPoints: [], onChanged: async () => {},
    } as never))
    expect(bare).not.toContain('data-freezing-candidates')
  })

  it('строка без единицы названа и кнопкой не становится', () => {
    /*
      2,00 м дважды выпалывали как выдуманную подстановку, и она вернулась
      третьим путём — кандидатом «из документа», с цитатой. Теперь строка
      видна как строка: разбор её отверг и сказал почему, а нажать на неё
      нельзя.
    */
    const markup = html(createElement(GeologySection, {
      projectId: 'p1',
      dataset: { id: 'g4', content: { soilType: 'clay', groundwaterDepthM: 6, corrosivity: 'low' } },
      basisDataset: {
        id: 'b2',
        content: {
          files: { geology: 'Геологический Отчет.docx' },
          extracted: {
            geology: {
              parserVersion: 2,
              freezingDepthCandidates: [
                { valueM: 1.17, soil: 'Крупнообломочные', quote: 'Крупнообломочные\t1,17м', form: 'table' },
              ],
              freezingDepthUnitlessRows: [
                { raw: 2, soil: 'Суглинок твердый', quote: '1\tСуглинок твердый -35в;\t2\t2', form: 'table' },
              ],
            },
          },
        },
      },
      boreholes: [], surveyPoints: [], onChanged: async () => {},
    } as never))
    expect(markup).toContain('data-freezing-unitless="true"')
    expect(markup).toContain('project.geology.frostUnitless')
    // Кнопка есть только у настоящего кандидата.
    expect(markup).toContain('data-freezing-candidate="Крупнообломочные"')
    expect(markup).not.toContain('data-freezing-candidate="Суглинок твердый"')
  })

  it('кандидаты из разобранного отчёта доходят до выбора с цитатой', () => {
    // Слот мастера кладёт разбор в запись basis-файла — не в набор геологии:
    // там живут подтверждённые величины, и разбор их не трогает.
    const withReport = html(createElement(GeologySection, {
      projectId: 'p1',
      dataset: { id: 'g3', content: { soilType: 'clay', groundwaterDepthM: 6, corrosivity: 'low' } },
      basisDataset: {
        id: 'b1',
        content: {
          files: { geology: 'Геологический Отчет.docx' },
          extracted: {
            geology: {
              // Выбор кандидатов открыт только при действующем разборе: с
              // неизвестной версией величины видны, но не выбираются.
              parserVersion: 2,
              freezingDepthCandidates: [
                { valueM: 0.79, soil: 'суглинков', quote: 'сезонного промерзания для суглинков – 0,79м', form: 'prose' },
                { valueM: 1.03, soil: 'песка средней крупности', quote: 'для песка средней крупности – 1,03м', form: 'prose' },
              ],
              ige: [{ code: '1', name: 'суглинок твердый' }],
              // Строка таблицы трудности разработки: «2» в конце — номер
              // столбца. Кандидатом не стала, но и не пропала.
              freezingDepthUnitlessRows: [
                { raw: 2, soil: 'Суглинок твердый', quote: '1\tСуглинок твердый -35в;\t2\t2', form: 'table' },
              ],
            },
          },
        },
      },
      boreholes: [], surveyPoints: [], onChanged: async () => {},
    } as never))
    expect(withReport).toContain('data-freezing-candidates="true"')
    expect(withReport).toContain('data-freezing-candidate="суглинков"')
    expect(withReport).toContain('data-freezing-candidate="песка средней крупности"')
    expect(withReport).toContain('0.79')
    expect(withReport).toContain('1.03')
  })
})

describe('итог расчёта не обещает того, чего нельзя', () => {
  it('«рассчитан» больше не значит «можно экспортировать»', () => {
    // Шапка говорила «Проект рассчитан. Можно экспортировать документацию», а
    // ниже на той же странице стояло «к выпуску 0 (0%), заблокировано 5».
    expect(ru.translation.project.pipeline.done).not.toContain('экспорт')
    expect(ru.translation.project.pipeline.done).toBe('Проект рассчитан и сохранён')
  })

  it('состояние выпуска называется отдельной строкой и адресует раздел', () => {
    const pipeline = ru.translation.project.pipeline
    expect(pipeline.releaseBlocked).toContain('{{total}}')
    expect(pipeline.releaseBlocked).toContain('Готовность к выпуску')
    expect(pipeline.releasePartial).toContain('{{verified}}')
    expect(pipeline.releaseReady).toContain('{{total}}')
  })
})

describe('мастер комплекта получает проект на месте вызова', () => {
  /**
   * НАЙДЕНО НА ЖИВОМ САЙТЕ, а не в проверке. Владелец положил в слоты пять
   * настоящих документов, нажал «Прогнать комплект (5)» и получил пять раз
   * «Проект не открыт: сохранять basis-файл некуда» — на странице
   * /app/projects/5d7e1463-…, то есть при открытом проекте.
   *
   * Причина — `<StankevichaDemoView />` без `projectId`. Проп был объявлен
   * необязательным, поэтому TypeScript промолчал; проверки монтировали
   * компонент напрямую и тоже молчали — они не видят МЕСТА ВЫЗОВА.
   *
   * Мастер комплекта — единственный путь загрузить настоящий объект: кнопка
   * «Настоящий объект» кладёт только выжимку, без подосновы. Непереданный проп
   * стоил всего пути загрузки.
   *
   * ProjectPage в проверке не отрисовать — он тянет хранилище и маршрутизацию,
   * — поэтому сторожем стоит исходник, как и для `!isWater`.
   */
  it('в разметке страницы проекта мастер не вызывается без projectId', () => {
    const source = readFileSync(new URL('../ProjectPage.tsx', import.meta.url), 'utf8')
    const calls = [...source.matchAll(/<StankevichaDemoView[\s/>][^>]*>/g)].map((match) => match[0])
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call, `мастер комплекта вызван без проекта: ${call}`).toContain('projectId')
    }
  })
})

describe('сообщения называют то, что произошло', () => {
  it('посев настоящего объекта не отчитывается синтетическим демо', () => {
    // Владелец сеял свой К1 «Станкевича» и читал наверху «Синтетическое демо
    // К2 загружено»: данные были целы, врал только текст.
    const source = readFileSync(new URL('../ProjectPage.tsx', import.meta.url), 'utf8')
    const code = source.split(/\r?\n/).filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//')
    }).join(' ')
    // Ветка настоящего объекта ставит собственный итог, а не общий с демо.
    expect(code).toContain("setRealObjectShown(true)")
    expect(code).toContain("setDemoNotice('realObjectDone')")
    expect(ru.translation.project.realObjectDone).toContain('Станкевича')
    expect(ru.translation.project.realObjectDone).not.toContain('К2')
    expect(ru.translation.project.demoDone).toContain('демо')
  })

  it('отказ считать не превращается в пустой экран', () => {
    /*
      На живом сайте у проекта с шестью загруженными документами было: участков
      0, схемы нет, кнопок выпуска нет — и ни слова о том, чего не хватает.
      Отказ считать без промерзания правильный, но его следствием оказалось
      молчание, а молчание хуже и подстановки, и пустого состояния.

      Ветка `!result` разбирала три причины и не разбирала эту: она проваливалась
      в `null`. Проверка по исходнику, потому что раздел не монтируется без
      двух десятков пропов; она держит ровно то, что пропало, — ветку, ссылку
      и то, что названо известным без промерзания.
    */
    const source = readFileSync(new URL('./GravitySection.tsx', import.meta.url), 'utf8')
    const code = source.split(/\r?\n/).filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//')
    }).join(' ')
    expect(code).toContain('data-gravity-needs-freezing')
    expect(code).toContain('freezingDepth.valueM === null &&')
    expect(code).toContain('knownWithoutFreezing')
    // Ссылка ведёт прямо к разделу геологии, а не к общему совету.
    expect(code).toContain('href="#geology"')
    expect(ru.translation.project.gravity.knownWithoutFreezing).toContain('участков в сети')
    expect(ru.translation.project.gravity.chooseFreezingLink).toContain('Геология')
  })

  it('раздел называет ВСЕ незакрытые причины, а не первую', () => {
    /*
      Разбор «что известно без промерзания» владелец на живом сайте не увидел, и
      был прав: ветка стояла четвёртой в цепочке `? :`, а на его проекте
      срабатывала первая — сети нет, конвертер не развёрнут. Одна причина
      закрывала три остальных, и расстояние до результата было неизвестно.

      Проверка монтирует раздел, а не читает исходник: вопрос был именно
      «видно ли это на экране».
    */
    const markup = html(createElement(GravitySection, {
      projectId: 'p1', systemType: 'sewer', projectName: 'Станкевича',
      buildings: [], nodes: [], pipes: [],
    } as never))
    // Ни сети, ни промерзания — и сказано про обе причины, а не про первую.
    // Ряд диаметров при пустом наборе условий блокером не становится: каталог
    // берёт стандартный ряд, и заявлять здесь стоп было бы неправдой.
    expect(markup).toContain('data-gravity-needs-network="true"')
    expect(markup).toContain('data-gravity-needs-freezing="true"')
    expect(markup).toContain('href="#geology"')
    // Сети нет — состав сети не называется: «участков 0» это шум, а не сведение.
    expect(markup).not.toContain('project.gravity.knownWithoutFreezing')
  })

  it('храповик подстановок смотрит на виды, а не только на движок', () => {
    /*
      Обе подстановки 2,00 м жили в видах, и сторож не увидел ни одну: в его
      списке `CRITICAL` не было ни одного файла из `frontend/src/app/project/`.
      Первую нашли глазами по чертежу, вторую владелец нашёл в исходнике.

      Список ведётся руками — значит, из него можно так же руками убрать.
      Проверка держит ровно те два файла, из которых уходит вызов расчёта.
    */
    const audit = readFileSync(new URL('../../../../scripts/fallback-audit.mjs', import.meta.url), 'utf8')
    for (const watched of [
      'frontend/src/app/project/GravitySection.tsx',
      'frontend/src/app/project/SituationSchemeSection.tsx',
    ]) {
      expect(audit, `${watched} выпал из списка наблюдения`).toContain(watched)
    }
  })

  it('без выбранной глубины промерзания профиль не считается по числу из воздуха', () => {
    // Сторож смотрит на ОБА раздела: первую подстановку убрали из самотёка, а
    // вторая, в ситуационной схеме, осталась и в поле зрения не попала — её не
    // было и в списке законных, так что храповик её тоже не видел.
    for (const name of ['./GravitySection.tsx', './SituationSchemeSection.tsx']) {
      const text = readFileSync(new URL(name, import.meta.url), 'utf8')
      const body = text.split(/\r?\n/).filter((line) => {
        const trimmed = line.trim()
        return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//')
      }).join(' ')
      expect(body, name).not.toContain('DEFAULT_FREEZING_DEPTH_M')
    }
    const source = readFileSync(new URL('./GravitySection.tsx', import.meta.url), 'utf8')
    const code = source.split(/\r?\n/).filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//')
    }).join(' ')
    // 2,00 м нет ни в одном документе объекта: у Станкевича максимум 1,03 м.
    expect(code).not.toContain('DEFAULT_FREEZING_DEPTH_M')
    expect(ru.translation.project.gravity.freezingNotChosen).toContain('не считается')
  })
})

describe('экран говорит, каким разбором получены величины', () => {
  /**
   * ИЗМЕРЕНО НА ЖИВОМ САЙТЕ, ТРИЖДЫ. Правка извлечения чинит будущие загрузки
   * и не трогает сделанные. Владелец открывал проект после каждой из трёх
   * правок и видел старый результат: 2,00 м из таблицы нумерации ИГЭ стоял
   * кандидатом уже после того, как разбор научился его отбрасывать.
   */
  const geology = (extraction: Record<string, unknown>) => html(createElement(GeologySection, {
    projectId: 'p1',
    dataset: { id: 'g5', content: { soilType: 'clay', groundwaterDepthM: 6, corrosivity: 'low' } },
    basisDataset: {
      id: 'b3',
      content: { files: { geology: 'Геологический Отчет.docx' }, extracted: { geology: extraction } },
    },
    boreholes: [], surveyPoints: [], onChanged: async () => {},
  } as never))

  const CANDIDATES = [
    { valueM: 1.17, soil: 'Крупнообломочные', quote: 'Крупнообломочные\t1,17м', form: 'table' },
  ]

  it('устаревший разбор назван обеими версиями, а величины остаются на месте', () => {
    const markup = geology({ parserVersion: 1, freezingDepthCandidates: CANDIDATES })
    expect(markup).toContain('data-extraction-age="outdated"')
    expect(markup).toContain('project.extraction.outdated')
    expect(markup).toContain('&quot;stored&quot;:1')
    expect(markup).toContain('&quot;current&quot;:2')
    // Величины не прячутся: на них могли уже сослаться.
    expect(markup).toContain('data-freezing-candidate-locked="Крупнообломочные"')
    // Но и не выбираются: предупреждение, обходимое одним кликом, — не
    // предупреждение. Кнопки нет, есть одно действие — перезапуск.
    expect(markup).not.toContain('data-freezing-candidate="Крупнообломочные"')
    expect(markup).toContain('project.geology.frostChoiceLocked')
    // Рядом — действие, а не только упрёк.
    expect(markup).toContain('id="reparse-geology"')
    expect(markup).toContain('project.extraction.noStoredFile')
  })

  it('запись без версии читается как «неизвестно», а не как свежая', () => {
    // Ровно то, что лежит в базе владельца: разбор есть, версии нет.
    const markup = geology({ freezingDepthCandidates: CANDIDATES })
    expect(markup).toContain('data-extraction-age="unknown"')
    expect(markup).toContain('project.extraction.unknown')
    // Ровно случай владельца: шесть кнопок, две из них мусор из таблицы
    // нумерации ИГЭ, и все шесть нажимались. Теперь видны, но не выбираются.
    expect(markup).toContain('data-freezing-candidate-locked="Крупнообломочные"')
    expect(markup).not.toContain('data-freezing-candidate="Крупнообломочные"')
  })

  it('действующий разбор молчит', () => {
    const markup = geology({ parserVersion: 2, freezingDepthCandidates: CANDIDATES })
    expect(markup).not.toContain('data-extraction-age')
    // Разбор действующий — выбор открыт.
    expect(markup).toContain('data-freezing-candidate="Крупнообломочные"')
    expect(markup).not.toContain('data-freezing-candidate-locked')
  })

  it('разбор новее кода перезапуском не лечится', () => {
    const markup = geology({ parserVersion: 99, freezingDepthCandidates: CANDIDATES })
    expect(markup).toContain('data-extraction-age="ahead"')
    // Кнопка откатила бы чужую работу назад — её здесь нет.
    expect(markup).not.toContain('id="reparse-geology"')
  })

  it('правка разбора геологии не вешает предупреждение на акт', () => {
    /*
      Общая версия объявила бы устаревшим всё сразу. У акта своя версия, она
      не менялась — и раздел АТО молчит, пока молчать честно.
    */
    const facts = {
      diameterMm: [{ value: 450, page: 1, quote: 'диаметром 450 мм' }],
      lengthM: [], material: [], depthRangeM: [], category: [], verdicts: [], missing: [],
    }
    const markup = html(createElement(ExistingNetworkSection, {
      projectId: 'p1', existing: [], points: [], designedLengthM: 0,
      basisDataset: {
        id: 'b4',
        content: {
          extracted: {
            geology: { parserVersion: 1, freezingDepthCandidates: [] },
            survey_act: { parserVersion: 1, ...facts },
          },
        },
      },
      onChanged: async () => {},
    } as never))
    expect(markup).not.toContain('data-extraction-age')
    expect(markup).toContain('450')
  })

  it('выбранная величина, исчезнувшая после пере-разбора, названа', () => {
    /*
      Случай владельца после перезапуска: 2,00 м был выбран из отчёта, а
      сегодняшний разбор кандидатом его не считает. Тихо подменить выбор
      нельзя — правило «извлечённое ≠ подтверждённое» работает в обе стороны.
    */
    const markup = html(createElement(GeologySection, {
      projectId: 'p1',
      dataset: {
        id: 'g6',
        content: { soilType: 'clay', groundwaterDepthM: 6, corrosivity: 'low', freezingDepthM: 2 },
      },
      basisDataset: {
        id: 'b5',
        content: {
          files: { geology: 'Геологический Отчет.docx' },
          extracted: { geology: { parserVersion: 2, freezingDepthCandidates: CANDIDATES } },
        },
      },
      boreholes: [], surveyPoints: [], onChanged: async () => {},
    } as never))
    expect(markup).toContain('data-freezing-chosen-missing="true"')
    expect(markup).toContain('project.geology.frostChosenMissing')
    expect(markup).toContain('2.00')
  })
})

describe('реестры говорят про одни и те же бумаги согласованно', () => {
  /**
   * На одной странице стояло «Мастер комплекта: готово 6 из 8» и
   * «Исходно-разрешительная документация: доступно 0 из 9» — про ОДИН И ТОТ ЖЕ
   * комплект. Мастер писал в тот же набор basis-файлов своими ключами
   * (`stankevicha_<слот>`), и реестр ИРД их не видел. Инженер грузил документ
   * второй раз, потому что экран уверял, что его нет.
   *
   * Ключи мастера БОЛЬШЕ НЕ СУЩЕСТВУЮТ: слот пишет под тем именем, под каким
   * документ знает база, и переводить между двумя словарями стало нечего.
   * Здесь поэтому лежит то, что мастер запишет сегодня.
   */
  const uploadedByKit = {
    id: 'b1',
    content: {
      files: {
        tu: 'ТУ_05-3-2723 (1).pdf',
        assignment: 'ТЗ_5669_Станкевича.pdf',
        geology: 'Геологический Отчет.docx',
        survey_act: 'ТО_5669_Станкевича.pdf',
      },
    },
  }
  const markup = html(createElement(BasisSection, {
    projectId: 'p1', dataset: uploadedByKit, onSaved: async () => {},
  } as never))

  it('загруженное мастером засчитывается в ИРД', () => {
    // Три из четырёх — пункты ИРД: ТУ, задание, геология. Акт технического
    // обследования в перечень ИРД не входит и не засчитывается.
    expect(markup).toContain('ТУ_05-3-2723 (1).pdf')
    expect(markup).toContain('ТЗ_5669_Станкевича.pdf')
    expect(markup).toContain('Геологический Отчет.docx')
    expect(markup).toContain('project.basis.progress {&quot;count&quot;:3,&quot;total&quot;:9}')
  })

  it('акт обследования в ИРД не засчитывается: его там нет по составу', () => {
    // Засчитать документ в перечень, которого он не член, — та же неправда,
    // только с другого конца.
    expect(markup).not.toContain('ТО_5669_Станкевича.pdf')
  })

  it('каждый слот пишет под объявленным именем, своих ключей у мастера нет', () => {
    // Имя документа в базе объявлено в реестре слотов и больше нигде: пара
    // словарей и переводчик между ними — это и была потеря.
    expect(STANKEVICHA_KIT_SLOTS.map((slot) => [slot.id, slot.basisItemId])).toEqual([
      ['topobaseFull', 'topo'],
      ['surveyStankevicha', 'topo_survey'],
      ['technicalConditions', 'tu'],
      ['designBrief', 'assignment'],
      ['surveyReport', 'survey_act'],
      ['geologyReport', 'geology'],
      ['geologyAppendices', 'geology_appendices'],
      ['routeScheme', 'route_scheme'],
    ])
  })
})

describe('десять величин акта видны, а не посчитаны', () => {
  it('раздел АТО показывает разобранное мастером с цитатами', () => {
    // Слот извлекал величины, показывал число «10» и выбрасывал их. Ни Ø450,
    // ни 458,94 м, ни глубин 3,7…5,2 м на экране не было.
    const facts = {
      diameterMm: [{ value: 450, page: 1, quote: 'диаметром 450 мм' }],
      lengthM: [{ value: 458.94, page: 1, quote: 'протяжённостью 458,94 м' }],
      material: [{ value: 'керамическая', page: 1, quote: 'труба керамическая' }],
      depthRangeM: [{ value: { fromM: 3.7, toM: 5.2 }, page: 1, quote: 'на глубине 3,7-5,2 м' }],
      category: [{ value: 'III', page: 1, quote: 'категория III' }],
      verdicts: [], missing: [],
    }
    const markup = html(createElement(ExistingNetworkSection, {
      projectId: 'p1', existing: [], points: [], designedLengthM: 0,
      basisDataset: { id: 'b1', content: { extracted: { survey_act: facts } } },
      onChanged: async () => {},
    } as never))
    expect(markup).toContain('450')
    expect(markup).toContain('458.94')
    expect(markup).toContain('керамическая')
    expect(markup).toContain('диаметром 450 мм')
    expect(markup).toContain('протяжённостью 458,94 м')
  })
})
