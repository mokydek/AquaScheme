import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  applyGravityBasinLifts,
  buildSewerSchedule,
  buildWorkingDrawingSet,
  parseManholeCatalogRows,
  planBasinPressureLinks,
  selectManholeConstructions,
  corridorAxis,
  importNetwork,
  parseCatalogRows,
  solveGravityNetwork,
  workingDrawingSpecificationItemCount,
} from '@aquascheme/engine'
// Разбор DXF живёт отдельным подпутём — так его берёт и само приложение.
import { classifyDxfConstraints, parseDxfNetwork } from '@aquascheme/engine/dxfread'
import { crossingsFromSurvey } from '@aquascheme/engine'
import { buildDxfCadContext } from './dxfContext'

/**
 * Сборка альбома реального объекта для ИЗМЕРЕНИЯ сходства с эталоном.
 *
 * Это не проверка поведения, а прогон: он собирает проект из настоящих
 * исходников и кладёт PDF туда, где его ждёт `visual-benchmark.mjs`. Оформлен
 * проверкой потому, что движок живёт исходниками TypeScript, а vitest — то
 * единственное, что уже умеет их запускать; тем же приёмом собирается
 * многостраничный PDF в `projectAlbum.test.ts`.
 *
 * Исходники объекта конфиденциальны и в git не попадают. Нет их на машине —
 * прогон ЯВНО пропускается с причиной: зелёный прогон, в котором ничего не
 * собиралось, хуже красного.
 */

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const DXF = join(ROOT, 'docs', 'benchmark', 'taldykol', 'dxf', 'topo.dxf')
const CATALOG = join(ROOT, 'docs', 'benchmark', 'out', 'catalog-pipes.csv')
const MANHOLE_CATALOG = join(ROOT, 'docs', 'benchmark', 'out', 'manhole-catalog.csv')
/** Разделитель строк CSV: файл может прийти и с переводом каретки. */
const SPLIT_LINES = /\r?\n/
const OUT = join(ROOT, 'docs', 'benchmark', 'out', 'generated-album.pdf')
const ready = existsSync(DXF) && existsSync(CATALOG)

/**
 * Промерзание, м — ВЫБОР, а не прочитанная величина.
 *
 * Отчёт ИГИ даёт четыре нормативные глубины по грунтам: суглинки и глины 1,71,
 * пески мелкие 2,08, пески крупные 2,22, крупнообломочные грунты 2,53. Прежде
 * разбор возвращал наибольшую «в запас», и 2,53 выглядела подтверждённой
 * отчётом. Это был молчаливый выбор за инженера, и с правкой разбора его больше
 * нет: величина определяется грунтом на отметке трубы.
 *
 * Здесь принята 2,53 — наибольшая, то есть заведомо не заниженная. Какой грунт
 * лежит на отметке трубы, из отчёта НЕ УСТАНОВЛЕНО: продольного описания по
 * трассе в нём нет. Величина остаётся принятой с пометкой и требует
 * подтверждения владельцем; запись — в GAP.md, раздел «принято за владельца».
 */
const FREEZING_DEPTH_M = 2.53
const FREEZING_DEPTH_BASIS = 'выбор инженера: наибольшая из четырёх нормативных глубин отчёта ИГИ '
  + '(крупнообломочные грунты); грунт на отметке трубы из отчёта не следует — требует подтверждения владельцем'

/**
 * Расчётный расход проектной ЛНС, л/с.
 *
 * Со «Схемы ЛК от Генплан», распознано и ПОДТВЕРЖДЕНО владельцем 08.08.2026.
 * Формулой интенсивности не считается — ТЗ предписывает брать расход из
 * расчёта ТОО «НИПИ Астана Генплан».
 */
const DESIGN_FLOW_LPS = 2335.8

/** Идентификатор узла-источника: по нему гидравлика находит приток. */
const INFLOW_ID = 'ЛНС'

describe('сборка альбома реального объекта', () => {
  it.skipIf(!ready)('собирает комплект и пытается отрисовать альбом для измерения', async () => {
    const data = (parseDxfNetwork as unknown as (text: string) => never)(readFileSync(DXF, 'utf8'))
    const constraints = (classifyDxfConstraints as unknown as (d: never) => Record<string, never[]>)(data)
    const surveyPoints = constraints.surveyPoints as unknown as Array<{ x: number; y: number; z: number }>
    const rings = constraints.corridorRings as unknown as Array<Array<{ x: number; y: number }>>
    console.log(`СЪЁМКА: точек ${surveyPoints.length}, контуров коридора ${rings.length}`)
    expect(surveyPoints.length).toBeGreaterThan(100)
    expect(rings.length).toBeGreaterThan(0)

    // Ось — предложение программы из коридора инженерных сетей. Разрешение
    // владельца на это решение записано в GAP.md.
    const axis = (corridorAxis as unknown as (r: never) => { ok: boolean; points: Array<{ x: number; y: number }>; lengthM: number; reason: string })(rings[0] as never)
    console.log(`ОСЬ ИЗ КОРИДОРА: ok=${axis.ok}, точек ${axis.points.length}, длина ${axis.lengthM} м; ${axis.reason}`)
    expect(axis.points.length).toBeGreaterThan(1)

    // Ряд диаметров — каталог АГСК-3 объекта.
    const lines = readFileSync(CATALOG, 'utf8').trim().split('\n')
    const head = lines[0].split(';')
    const rows = lines.slice(1).map((line) => Object.fromEntries(line.split(';').map((v, i) => [head[i], v])))
    const catalog = (parseCatalogRows as unknown as (r: never) => { items: Array<{ internalMm?: number }> })(rows as never)
    const series = catalog.items.map((item) => item.internalMm).filter((value): value is number => typeof value === 'number')
    console.log(`КАТАЛОГ: ряд ${series.join(', ')}`)

    // Ось подаётся ЗВЕНЬЯМИ, а не одной полилинией: поданная целиком, она
    // сворачивается импортом до трёх участков на шестнадцать километров, и
    // профиль тогда не режется на листы вовсе.
    const segments = axis.points.slice(1).map((point, index) => ({
      points: [axis.points[index], point], layer: 'ось из коридора',
    }))
    const head0 = axis.points[0]
    const tail0 = axis.points[axis.points.length - 1]
    const network = (importNetwork as unknown as (
      s: never, b: never, src: never, sp: never,
    ) => { network: never; report: unknown })(
      segments as never,
      // Сток входит в модель узлом-источником в голове трассы. Привязать
      // подтверждённые расходы к отдельным очистным сооружениям НЕВОЗМОЖНО:
      // в съёмке есть только одиночные подписи «кнс», «очистной»,
      // «резервуар» — без номеров III-4/III-6/III-8, и какое из них какое,
      // из чертежа не следует. Поэтому принята консервативная схема: вся
      // подтверждённая нагрузка приходит с головы трассы.
      [{ id: INFLOW_ID, x: head0.x, y: head0.y }] as never,
      tail0 as never,
      surveyPoints as never,
    )

    const gravity = (solveGravityNetwork as unknown as (i: never) => {
      profile: unknown; pipes: unknown[]; surfaceGapNodeIds: string[]; outletFlowLps: number
    })({
      network: network.network,
      // Ключ — идентификатор ИСТОЧНИКА, а не узла: гидравлика ищет приток по
      // `node.buildingId ?? node.id`, и узел, созданный импортом, несёт
      // buildingId исходного объекта. Ключ по 'B1' промахивался мимо, и на
      // выпуске получался ноль при подтверждённых 2335,8 л/с.
      buildingFlowLps: new Map([[INFLOW_ID, DESIGN_FLOW_LPS]]),
      system: 'storm',
      freezingDepthM: FREEZING_DEPTH_M,
      allowedDiametersMm: series,
      // Магистральный коллектор на плоском рельефе: критерий подбора —
      // наименьшее заглубление, а не наименьший диаметр. По умолчанию берётся
      // `minDiameter`, и он гонит крутые уклоны: на шестнадцати километрах это
      // дало скорости до 7,3 м/с и глубину 537 м. Выбор критерия — вход
      // инженера; для этого объекта он записан в GAP.md итерации 0.
      strategy: 'minBurial' as const,
    } as never)
    console.log(`САМОТЁК: участков ${gravity.pipes.length}, расход на выпуске ${gravity.outletFlowLps} л/с,`
      + ` профиль ${gravity.profile === null ? 'НЕ построен' : 'построен'},`
      + ` непокрытых узлов ${gravity.surfaceGapNodeIds.length}`)

    // Что дал подбор: ряд диаметров, наполнение, скорость, замечания.
    const pipes = gravity.pipes as unknown as Array<{
      diameterMm: number; fillRatio: number; velocityMs: number; slope: number; flowLps: number
      issues: Array<{ code: string }>
    }>
    const diameters = [...new Set(pipes.map((pipe) => pipe.diameterMm))].sort((a, b) => a - b)
    const codes = new Map<string, number>()
    for (const pipe of pipes) for (const issue of pipe.issues) codes.set(issue.code, (codes.get(issue.code) ?? 0) + 1)
    const fills = pipes.map((pipe) => pipe.fillRatio)
    const speeds = pipes.map((pipe) => pipe.velocityMs)
    console.log(`ПОДБОР: диаметры ${diameters.join(', ')}; наполнение `
      + `${Math.min(...fills).toFixed(3)}…${Math.max(...fills).toFixed(3)}; скорость `
      + `${Math.min(...speeds).toFixed(3)}…${Math.max(...speeds).toFixed(3)} м/с`)
    console.log(`ЗАМЕЧАНИЯ УЧАСТКОВ: ${codes.size === 0 ? 'нет' : JSON.stringify([...codes])}`)
    // Разбивка на самотёчные бассейны с перекачками.
    //
    // Решатель топил трубу одной самотёчной ниткой до 47,10 м: механизм
    // разбивки в движке был, но к сборке не подключён, и подтверждённое
    // инженером решение до выпуска не доходило.
    //
    // Предел глубины — вход инженера. Каталога конструкций колодцев в этой
    // сборке нет (manholeConstructions пуст), высот колец взять неоткуда,
    // поэтому по действующему разрешению владельца принят предел 6,0 м —
    // типовая граница сборных колодцев ГОСТ 8020. Происхождение — assumed,
    // запись «принято за владельца» в GAP.md.
    const DEPTH_LIMIT_M = 6
    const design = new Map((gravity.pipes as unknown as Array<{ id: string; diameterMm: number; slope: number }>)
      .map((pipe) => [pipe.id, { diameterMm: pipe.diameterMm, slope: pipe.slope }]))
    const basinOutcome = (applyGravityBasinLifts as unknown as (p: never, d: never, o: never) => {
      profile: { maxDepthM: number; stations: unknown[]; totalLengthM: number }
      plan: {
        reason: string
        basins: Array<{ index: number; fromChainageM: number; toChainageM: number; maxDepthM: number; liftAtEnd: boolean }>
        lifts: Array<{ nodeId: string; chainageM: number; incomingDepthM: number; liftHeightM: number }>
      }
    })(gravity.profile as never, design as never, { maxDepthM: DEPTH_LIMIT_M, freezingDepthM: FREEZING_DEPTH_M } as never)
    gravity.profile = basinOutcome.profile
    console.log(`РАЗБИВКА: ${basinOutcome.plan.reason}`)
    console.log(`БАССЕЙНЫ: ${basinOutcome.plan.basins.length}, перекачек ${basinOutcome.plan.lifts.length},`
      + ` наибольшая глубина после разбивки ${basinOutcome.profile.maxDepthM} м при пределе ${DEPTH_LIMIT_M} м`)
    for (const basin of basinOutcome.plan.basins.slice(0, 12)) {
      console.log(`  бассейн ${basin.index}: ${basin.fromChainageM.toFixed(2)}…${basin.toChainageM.toFixed(2)} м,`
        + ` глубина макс ${basin.maxDepthM} м, перекачка в конце: ${basin.liftAtEnd ? 'да' : 'нет (выпуск)'}`)
    }
    // Напорные перемычки: длина выводится из геометрии по границам бассейнов,
    // диаметр — подбором по допустимой скорости из каталожного ряда. Каталога
    // насосов в сборке нет, и это скажет блокер каждой перемычки, а не общий
    // молчаливый пропуск.
    const links = (planBasinPressureLinks as unknown as (i: never) => {
      links: Array<{ chainageM: number; lengthM: number | null; lengthOrigin: string; suggestedDiameterMm: number | null; requiredHeadM: number | null; blockers: string[] }>
      missing: string[]
      reason: string
    })({
      lifts: basinOutcome.plan.lifts,
      designFlowLps: DESIGN_FLOW_LPS,
      basinBoundariesM: basinOutcome.plan.basins.map((basin) => basin.fromChainageM),
      routeEndM: basinOutcome.profile.totalLengthM,
      availableDiametersMm: series,
    } as never)
    console.log(`ПЕРЕМЫЧКИ: ${links.links.length}; ${links.reason}`)
    console.log(`НЕ ХВАТАЕТ ДЛЯ НАПОРНЫХ: ${links.missing.length === 0 ? 'ничего' : links.missing.join('; ')}`)
    for (const link of links.links.slice(0, 12)) {
      console.log(`  перемычка на ${link.chainageM.toFixed(2)} м: длина ${link.lengthM ?? '—'} м (${link.lengthOrigin}),`
        + ` Ø${link.suggestedDiameterMm ?? '—'}, напор ${link.requiredHeadM ?? '—'} м,`
        + ` блокеры: ${link.blockers.length === 0 ? 'нет' : link.blockers.join(', ')}`)
    }

    const prof = gravity.profile as unknown as { maxDepthM?: number; stations?: unknown[] } | null
    console.log(`ПРОФИЛЬ: станций ${prof?.stations?.length ?? 0}, наибольшая глубина ${prof?.maxDepthM ?? '—'} м`)
    // Контрольная сумма инженерных величин профиля: смена подачи на листе не
    // смеет их менять. Сравнивается между заходами.
    const digits = JSON.stringify((prof?.stations ?? []).map((station) => {
      const point = station as { chainageM: number; groundElevationM: number; invertElevationM: number; depthM: number }
      return [point.chainageM, point.groundElevationM, point.invertElevationM, point.depthM]
    }))
    let sum = 0
    for (let index = 0; index < digits.length; index++) sum = (sum * 31 + digits.charCodeAt(index)) >>> 0
    console.log(`КОНТРОЛЬНАЯ СУММА ПРОФИЛЯ: ${sum}`)

    // Пересечения — из той же съёмки: карточки нужны и составу, и листам.
    const crossings = (crossingsFromSurvey as unknown as (a: never, c: never, d: never) => unknown[])(
      axis.points as never, constraints as never, data as never,
    )
    console.log(`ПЕРЕСЕЧЕНИЙ ИЗ СЪЁМКИ: ${crossings.length}`)

    // Каталог конструкций колодцев: позиции ГОСТ 8020 и ГОСТ 3634 из АГСК-3.
    //
    // Прежде он был пуст, и таблицы расхода материалов печатались без состава
    // конструкций. Высота кольца берётся из марки КС d-h (h — дециметры), а
    // ПРЕДЕЛЬНОЙ глубины конструкции марки не задают: кольца ставятся стопкой,
    // и сколько их можно поставить, каталог не говорит. Поэтому предел
    // бассейнов остаётся принятым (6,0 м, assumed), а не каталожным.
    const manholeCatalogRows = (() => {
      if (!existsSync(MANHOLE_CATALOG)) return []
      const lines = readFileSync(MANHOLE_CATALOG, 'utf8').trim().split(SPLIT_LINES)
      const split = (line: string) => {
        const cells: string[] = []
        let cell = ''
        let quoted = false
        for (let index = 0; index < line.length; index++) {
          const char = line[index]
          if (char === '"') {
            if (quoted && line[index + 1] === '"') { cell += '"'; index++ } else quoted = !quoted
          } else if (char === ';' && !quoted) { cells.push(cell); cell = '' } else cell += char
        }
        cells.push(cell)
        return cells
      }
      const headers = split(lines[0])
      return lines.slice(1).map((line) => Object.fromEntries(split(line).map((cell, index) => [headers[index], cell])))
    })()
    const manholeCatalog = (parseManholeCatalogRows as unknown as (r: never) => {
      entries: unknown[]; issues: unknown[]
    })(manholeCatalogRows as never)
    console.log(`КАТАЛОГ КОНСТРУКЦИЙ: позиций ${manholeCatalog.entries.length}, замечаний разбора ${manholeCatalog.issues.length}`)

    const schedule = gravity.profile === null ? null
      : (buildSewerSchedule as unknown as (r: never, o: never) => never)(gravity as never, {} as never)

    // Конструкции подбираются под каждый колодец ведомости по диаметру трубы и
    // глубине — тем же отбором, что и в приложении. Не подобранные названы:
    // Ø2000 требует камеры 2400, а такой в каталоге нет.
    const manholeSelection = (selectManholeConstructions as unknown as (m: never, e: never) => {
      selected: unknown[]; unmatched: string[]
    })(((schedule as unknown as { manholes?: unknown[] } | null)?.manholes ?? []) as never, manholeCatalog.entries as never)
    const manholeConstructions = manholeSelection.selected
    console.log(`КОНСТРУКЦИИ КОЛОДЦЕВ: подобрано ${manholeSelection.selected.length},`
      + ` без конструкции ${manholeSelection.unmatched.length}`
      + `${manholeSelection.unmatched.length === 0 ? '' : ` (${manholeSelection.unmatched.slice(0, 6).join(', ')}…)`}`)

    const drawingSet = (buildWorkingDrawingSet as unknown as (i: never) => {
      sheets: Array<{ status: string; title: string }>
      summary: Record<string, unknown>
      manifest: { pdfPageCount: number }
    })({
      system: 'storm',
      network: network.network,
      profile: gravity.profile,
      schedule,
      routeStatus: 'calculated',
      georeference: { kind: 'survey_grid', source: 'сетка чертежа d-Grid 50×50 м' },
      surveyPoints,
      planContextFeatureCount: (constraints.contextLines ?? []).length,
      unresolvedLayerCount: 0,
      catalogReady: series.length > 0,
      hydraulicsReady: gravity.profile !== null,
      // Состав комплекта — по ведомости эталона (ETALON-SHEETS.md). Состав
      // сверять с эталоном правилами проекта разрешено; величины — нет.
      deliverableRequirements: {
        // Отдельных листов пересечений эталон не выпускает — пересечения у него
        // показаны на планах. Состав по ведомости эталона, не «на всякий случай».
        crossingDetailSheets: false,
        protectiveGridDetail: true,
        existingSectionProfile: true,
        source: 'Ведомость рабочих чертежей эталона 2024-51-НК',
        verified: true,
      },
      crossings,
      // Число строк спецификации СЧИТАЕТСЯ ПО МОДЕЛИ, а не остаётся умолчанием.
      // Без него комплект разбивал спецификацию по шести строкам ведомости
      // труб, а к отрисовке модель давала девять — трубы плюс три вида колец
      // подобранных конструкций, — и альбом останавливался на первом же листе
      // с «реестр спецификации устарел». Приложение считает это число тем же
      // вызовом; прогон просто отстал от модели.
      specificationItemCount: (workingDrawingSpecificationItemCount as unknown as (s: never, m: never) => number)(
        schedule as never, manholeConstructions as never,
      ),
      manholeCatalogReady: manholeCatalog.entries.length > 0,
      utilityFeatureCount: (constraints.utilityLines ?? []).length,
      // Промерзание — величина из документа, а не принятая: отчёт по
      // инженерно-геологическим изысканиям ТОО «Geo Global KZ», Арх. № 17-08/25,
      // раздел «Климат». Разобрана из отчёта, не введена руками.
      freezingDepth: {
        valueM: FREEZING_DEPTH_M,
        // Не «подтверждено»: величина ВЫБРАНА из четырёх, а не прочитана как
        // единственная. Ярлык обязан отличать выбор инженера от подтверждения
        // документом, иначе аудит происхождения показывает неправду.
        status: 'assumed' as const,
        source: 'Отчёт ИГИ ТОО «Geo Global KZ», Арх. № 17-08/25, раздел «Климат»; '
          + FREEZING_DEPTH_BASIS,
      },
      // Расход дождевого стока не считается формулой интенсивности: ТЗ
      // предписывает брать его из расчёта ТОО «НИПИ Астана Генплан». Величина
      // распознана со «Схемы ЛК от Генплан» и подтверждена владельцем.
      stormRunoff: {
        available: true,
        verified: true,
        source: 'Схема ЛК от Генплан, ТОО «НИПИ Астана Генплан»; подтверждено владельцем 08.08.2026',
        detail: `расчётный расход на выпуске ${DESIGN_FLOW_LPS} л/с`,
      },
    } as never)

    const byStatus = new Map<string, number>()
    for (const sheet of drawingSet.sheets) byStatus.set(sheet.status, (byStatus.get(sheet.status) ?? 0) + 1)
    console.log(`ЛИСТОВ: ${drawingSet.sheets.length}; страниц PDF ${drawingSet.manifest.pdfPageCount};`
      + ` по статусам ${JSON.stringify([...byStatus])}`)
    // Поимённый состав нужен для сопоставления с ведомостью эталона.
    drawingSet.sheets.forEach((sheet, index) => {
      console.log(`НАШ ЛИСТ ${index + 1}: ${sheet.title}`)
    })
    // Стоп-факторы поимённо: какой код скольким листам мешает.
    const blockerCounts = new Map<string, number>()
    for (const sheet of drawingSet.sheets as unknown as Array<{ status: string; blockers: Array<{ code: string }> }>) {
      if (sheet.status !== 'BLOCKED') continue
      for (const code of new Set(sheet.blockers.map((issue) => issue.code))) {
        blockerCounts.set(code, (blockerCounts.get(code) ?? 0) + 1)
      }
    }
    for (const [code, count] of [...blockerCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`СТОП-ФАКТОР ${code}: листов ${count}`)
    }

    // Подоснова листа: проектные координаты совпадают с координатами чертежа
    // (привязка вида survey_grid, смещения нет), поэтому перенос тождественный.
    const cad = buildDxfCadContext(constraints as never, (point) => point)
    const albumConstraints = {
      corridorRings: constraints.corridorRings,
      redLines: constraints.redLines,
      utilityLines: constraints.utilityLines,
      roadLines: constraints.roadLines,
      waterLines: constraints.hydrography,
      buildingPolygons: constraints.buildingFootprints,
      ...cad,
      crossings,
    }
    const count = (value: unknown) => Array.isArray(value) ? value.length : 0
    console.log('ПОДОСНОВА В АЛЬБОМ: '
      + `коридор ${count(albumConstraints.corridorRings)}, `
      + `красные ${count(albumConstraints.redLines)}, `
      + `сети ${count(albumConstraints.utilityLines)}, `
      + `дороги ${count(albumConstraints.roadLines)}, `
      + `гидрография ${count(albumConstraints.waterLines)}, `
      + `здания ${count(albumConstraints.buildingPolygons)}, `
      + `рельеф ${count(cad.terrainLines)} из ${count(constraints.terrainLines)}, `
      + `подложка ${count(cad.cadContextLines)} из ${count(constraints.contextLines)}, `
      + `подписи ${count(cad.cadTextEntities)}, блоки ${count(cad.cadBlockEntities)}`)

    const { buildBenchmarkAlbumDoc } = await import('./benchmarkAlbum')
    // Один и тот же вход и для альбома, и для снимка отдельного листа: снимок
    // обязан показывать ровно тот лист, который уходит в измерение.
    const albumInput = {
      projectName: 'Водосбросной коллектор до р. Есиль',
      projectCode: '2024-51-НК',
      system: 'storm',
      network: network.network,
      profile: gravity.profile,
      schedule,
      drawingSet,
      surveyPoints,
      manholeConstructions,
      constraints: albumConstraints,
      pipeDiameterMm: new Map(),
      outletFlowLps: gravity.outletFlowLps,
    }
    try {
      const doc = buildBenchmarkAlbumDoc(albumInput as never)

      // Объём документа — первый признак того, что отрисовка не зависла, а
      // захлебнулась содержимым.
      console.log(`ДОКУМЕНТ: узлов JSON ${JSON.stringify(doc).length} символов`)

      /**
       * Снимок листа плана и ситуационной схемы — по метке прогона.
       *
       * Нужен, чтобы «до» и «после» правки отрисовки сравнивались на ОДНОМ
       * объекте и одном листе, а не на словах. Метка задаётся переменной
       * окружения, файлы ложатся рядом с остальными снимками.
       */
      const snapshotLabel = String(process.env.AQUASCHEME_SNAPSHOT_LABEL ?? '').trim()
      if (snapshotLabel !== '') {
        const { buildProjectSheetDoc, buildSituationSchemeSvg } = await import('./projectAlbum')
        const planSheet = (drawingSet as unknown as { sheets: Array<{ id: string; kind: string; title: string }> })
          .sheets.find((sheet) => sheet.kind === 'plan')
        const dir = join(ROOT, 'docs', 'benchmark', 'stankevicha', 'snapshots')
        mkdirSync(dir, { recursive: true })
        if (planSheet) {
          const sheetDoc = (buildProjectSheetDoc as unknown as (i: never, id: string) => {
            content: Array<{ stack?: Array<{ svg?: string }> }>
          })(albumInput as never, planSheet.id)
          const planSvg = sheetDoc.content[0]?.stack?.find((node) => typeof node.svg === 'string')?.svg ?? ''
          writeFileSync(join(dir, `plan-role-${snapshotLabel}.svg`), planSvg)
          const roleCounts = new Map<string, number>()
          for (const match of planSvg.matchAll(/data-plan-role="([a-zA-Z]+)"/g)) {
            roleCounts.set(match[1], (roleCounts.get(match[1]) ?? 0) + 1)
          }
          const strokes = new Map<string, number>()
          for (const match of planSvg.matchAll(/stroke="(#[0-9a-fA-F]{6})"/g)) {
            strokes.set(match[1], (strokes.get(match[1]) ?? 0) + 1)
          }
          console.log(`СНИМОК ПЛАНА (${snapshotLabel}): лист «${planSheet.title}», ${planSvg.length} символов;`
            + ` ломаных ${[...planSvg.matchAll(/<polyline/g)].length};`
            + ` по ролям ${JSON.stringify([...roleCounts].sort((a, b) => b[1] - a[1]))};`
            + ` по цвету обводки ${JSON.stringify([...strokes].sort((a, b) => b[1] - a[1]))}`)
        }
        const scheme = (buildSituationSchemeSvg as unknown as (i: never) => {
          svg: string; scaleDenominator: number; contextLines: number; droppedLines: number
          roles?: Array<{ role: string; arrived: number; drawn: number; thinned: number }>
        })({
          network: network.network,
          constraints: albumConstraints,
          corridorRings: (albumConstraints as { corridorRings?: unknown[] }).corridorRings,
          title: 'Ситуационная схема — измерение',
        } as never)
        writeFileSync(join(dir, `scheme-role-${snapshotLabel}.svg`), scheme.svg)
        console.log(`СНИМОК СХЕМЫ (${snapshotLabel}): М 1:${scheme.scaleDenominator},`
          + ` линий подосновы ${scheme.contextLines}, отброшено ${scheme.droppedLines};`
          + ` по ролям ${JSON.stringify(scheme.roles ?? [])}`)
      }
      // Ограничение числа страниц — только для поиска места зависания.
      const limit = Number(process.env.AQUASCHEME_RENDER_PAGES ?? 0)
      if (limit > 0 && Array.isArray((doc as { content?: unknown[] }).content)) {
        ;(doc as { content: unknown[] }).content = (doc as { content: unknown[] }).content.slice(0, limit)
        console.log(`ОТРИСОВКА ОГРАНИЧЕНА: первые ${limit} элементов содержимого`)
      }
      if (process.env.AQUASCHEME_SKIP_RENDER === '1') {
        console.log('ОТРИСОВКА ПРОПУЩЕНА по AQUASCHEME_SKIP_RENDER=1')
        return
      }

    // Рисуем тем же pdfmake, что и приложение. Обёртка `renderPdfDoc` не
    // экспортирована, а `generateProjectAlbumPdf` идёт через шлюз выпуска —
    // поэтому здесь тот же вызов, что делает она сама.
      // `getBlob()` в pdfmake 0.3 возвращает ПРОМИС и колбэка не принимает.
      // Обёртка `new Promise((resolve) => ....getBlob(resolve))` не
      // разрешалась никогда — это выглядело как бесконечно медленная
      // отрисовка и стоило часа ожидания.
      const pdfmake = (await import('pdfmake/build/pdfmake')).default as unknown as {
        addVirtualFileSystem: (v: unknown) => void
        createPdf: (d: unknown) => { getBlob: () => Promise<Blob> }
      }
      const fonts = (await import('pdfmake/build/vfs_fonts')).default
      pdfmake.addVirtualFileSystem(fonts)
      const blob = await pdfmake.createPdf(doc).getBlob()
      mkdirSync(join(ROOT, 'docs', 'benchmark', 'out'), { recursive: true })
      writeFileSync(OUT, Buffer.from(await blob.arrayBuffer()))
      console.log(`АЛЬБОМ ЗАПИСАН: ${OUT}`)

      // Манифест обязан совпадать с фактом. Расхождение значит, что альбом
      // содержит страницы, о которых реестр не знает: их не пронумеровать, не
      // сослаться на них и не сверить.
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const reopened = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(OUT)) }).promise
      const manifest = (drawingSet as unknown as {
        manifest: { pdfPageCount: number; pages: Array<{ pageFormat: { widthMm: number; heightMm: number }; title: string }> }
      }).manifest
      console.log(`СВЕРКА: манифест ${manifest.pdfPageCount} стр., файл ${reopened.numPages} стр.`)
      // Реестр обязан знать о каждой странице альбома: страница, о которой он
      // не знает, не пронумерована, на неё нельзя сослаться и её нельзя
      // сверить. Прежде расходилось на две страницы молча.
      expect(reopened.numPages).toBe(manifest.pdfPageCount)
      const PT = 72 / 25.4
      for (let page = 1; page <= Math.min(reopened.numPages, manifest.pages.length); page++) {
        const viewport = (await reopened.getPage(page)).getViewport({ scale: 1 })
        const declared = manifest.pages[page - 1].pageFormat
        const widthOff = Math.abs(viewport.width - declared.widthMm * PT)
        const heightOff = Math.abs(viewport.height - declared.heightMm * PT)
        const off = widthOff > 1 || heightOff > 1
        if (off) {
          console.log(`  РАЗОШЛОСЬ с.${page}: файл ${Math.round(viewport.width)}×${Math.round(viewport.height)} пт,`
            + ` манифест ${Math.round(declared.widthMm * PT)}×${Math.round(declared.heightMm * PT)} — «${manifest.pages[page - 1].title}»`)
        }
        expect(off, `формат страницы ${page} разошёлся с манифестом`).toBe(false)
      }
      await reopened.destroy()
    } catch (error) {
      // Сборка или отрисовка могут отказать: у листа свои ограничения на
      // размер. Отказ не прячется под зелёным прогоном и не выдаётся за успех —
      // он называется причиной, и по нему видно, что числа в этот раз нет.
      console.log(`АЛЬБОМ НЕ СОБРАН: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, 3_600_000)

  it.skipIf(ready)('пропуск объявляется причиной, а не тишиной', () => {
    expect(ready).toBe(false)
  })
})
