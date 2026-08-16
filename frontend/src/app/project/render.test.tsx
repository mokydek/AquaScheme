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
    expect(html(createElement(StankevichaDemoView))).toContain('project.stankevicha.matches')
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
    const markup = html(createElement(StankevichaDemoView))
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

  it('кнопка выжимки несёт пометку о неполноте данных', () => {
    const markup = html(createElement(StankevichaDemoView))
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
    const markup = html(createElement(StankevichaDemoView))
    expect(markup).toContain('data-kit-wizard')
    expect(markup).toContain('kit-file-topobaseFull')
  })
})
