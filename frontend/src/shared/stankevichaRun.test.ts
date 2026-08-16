import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  READINESS_SECTIONS,
  buildSewerSchedule,
  buildWorkingDrawingSet,
  selectManholeConstructions,
  solveGravityNetwork,
  summarizeReadiness,
  unverifiedClauses,
  workingDrawingSpecificationItemCount,
} from '@aquascheme/engine'
import { classifyDxfConstraints, parseDxfNetwork } from '@aquascheme/engine/dxfread'
import { buildDxfCadContext } from './dxfContext'
import { buildProjectSheetDoc, buildSituationSchemeSvg } from './projectAlbum'
import { belowCalculated, buildBenchmarkAlbumDoc } from './benchmarkAlbum'
import { STANKEVICHA_CHAMBERS, STANKEVICHA_CONDITIONS } from './stankevichaDemo'

/**
 * КОНТРОЛЬНЫЙ ПРОГОН ОБЪЕКТА, а не проверка поведения.
 *
 * Владелец спросил прямо: выдаёт ли программа результат по его объекту.
 * Ответить можно только прогоном. Здесь объект проходит тем же путём, каким
 * пойдёт он сам: топооснова разбирается тем же `parseDxfNetwork` +
 * `classifyDxfConstraints`, что и мастер комплекта; сеть собирается из камер
 * акта обследования; расчёт, комплект и свод готовности — те же вызовы, что
 * стоят в `GravitySection`. Обходных путей нет: если бы они были, прогон
 * доказывал бы работоспособность обхода, а не продукта.
 *
 * НИ ОДИН ИСТОЧНИК ЗДЕСЬ НЕ ПОДТВЕРЖДАЕТСЯ. Промерзание, состав комплекта,
 * каталог — решения инженера; пометить их `verified` от его имени значило бы
 * подделать основание чертежа. Прогон показывает картину как есть.
 *
 * Исходники объекта в git не входят: нет их на машине — прогон пропускается с
 * причиной.
 */

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const TOPO = join(ROOT, 'docs', 'benchmark', 'stankevicha', 'dxf', 'topo_stankevicha.dxf')
const OUT = join(ROOT, 'docs', 'benchmark', 'stankevicha', 'run')
const ready = existsSync(TOPO)

/** Секунды с точностью до сотой: время шага — часть ответа владельцу. */
const took = (from: number) => `${((performance.now() - from) / 1000).toFixed(2)} с`

describe('контрольный прогон объекта Станкевича', () => {
  it.skipIf(!ready)('проходит путь владельца от комплекта до попытки выпуска', () => {
    mkdirSync(OUT, { recursive: true })
    const report: string[] = []
    const say = (line: string) => { report.push(line); console.log(line) }

    // 1. Мастер комплекта: разбор топоосновы.
    let mark = performance.now()
    const data = parseDxfNetwork(readFileSync(TOPO, 'utf8')) as never as {
      segments: unknown[]; layers: unknown[]; points: unknown[]; ok: boolean
    }
    const parseTime = took(mark)
    mark = performance.now()
    const dxf = classifyDxfConstraints(data as never) as never as Record<string, never>
    const classifyTime = took(mark)
    mark = performance.now()
    const cad = buildDxfCadContext(dxf as never, (point) => point)
    const contextTime = took(mark)
    const count = (value: unknown) => (Array.isArray(value) ? value.length : 0)
    say(`ТОПООСНОВА: разбор ${parseTime}, классификация ${classifyTime}, перенос ${contextTime};`
      + ` слоёв ${count(data.layers)}, сегментов ${count(data.segments)},`
      + ` линий подосновы ${count(cad.cadContextLines)}, отметок ${count(dxf.surveyPoints)}`)
    const unresolvedLayers = Object.entries(dxf.roles as unknown as Record<string, string>)
      .filter(([, role]) => role === 'unknown').map(([name]) => name)
    say(`СЛОИ БЕЗ РОЛИ: ${unresolvedLayers.length}`)

    // 2. Сеть объекта: 14 камер акта обследования, отметки лотков измеренные.
    const nodes = STANKEVICHA_CHAMBERS.map((chamber, index) => ({
      id: chamber.label,
      label: chamber.label,
      kind: index === STANKEVICHA_CHAMBERS.length - 1 ? 'outlet' : 'manhole',
      x: chamber.x,
      y: chamber.y,
      groundElevation: chamber.rimElevationM,
      invertElevationM: chamber.invertElevationM,
    }))
    const pipes = nodes.slice(1).map((node, index) => ({
      id: `У-${index + 1}`,
      kind: 'main',
      fromNode: nodes[index].id,
      toNode: node.id,
      lengthM: Math.hypot(node.x - nodes[index].x, node.y - nodes[index].y),
      alignment: [
        { x: nodes[index].x, y: nodes[index].y },
        { x: node.x, y: node.y },
      ],
    }))
    const network = {
      nodes,
      pipes,
      totalLengthM: pipes.reduce((sum, pipe) => sum + pipe.lengthM, 0),
    } as never
    const surveyPoints = STANKEVICHA_CHAMBERS.map((chamber) => ({
      x: chamber.x, y: chamber.y, z: chamber.rimElevationM,
    }))
    say(`СЕТЬ: узлов ${nodes.length}, участков ${pipes.length},`
      + ` длина ${(network as unknown as { totalLengthM: number }).totalLengthM.toFixed(2)} м`
      + ` (по акту ${STANKEVICHA_CONDITIONS.declaredLengthM} м)`)

    // 3. Расчёт. Ряд диаметров — из ТУ, как его подаёт экран.
    mark = performance.now()
    const gravity = solveGravityNetwork({
      network,
      buildingFlowLps: new Map(),
      system: 'sewer',
      // Промерзание НЕ ВЫБРАНО: четыре кандидата отчёта, решение владельца.
      // В расчёт идёт наименьший — как нижняя граница, а не как принятая
      // величина; статус ниже остаётся `unverified`, и листы это видят.
      freezingDepthM: 1.71,
      allowedDiametersMm: [STANKEVICHA_CONDITIONS.designDiameterMm],
      diametersFromConditions: true,
    } as never) as never as {
      profile: {
        stations: Array<{ nodeId: string; depthM: number; invertElevationM: number; groundElevationM: number; chainageM: number }>
        maxDepthM: number
        reconstruction?: {
          tied: boolean; tieNodeIds: string[]; reason: string
          conflicts: Array<{ fromNodeId: string; toNodeId: string; kind: string; actualSlope: number; message: string }>
          shallow: Array<{ nodeId: string; depthM: number; requiredM: number }>
        }
      } | null
      pipes: Array<{ id: string; diameterMm: number; slope: number; issues: Array<{ code: string; message: string }> }>
      outletFlowLps: number
    }
    say(`РАСЧЁТ: ${took(mark)}`)
    const profile = gravity.profile
    expect(profile).not.toBeNull()
    const depths = profile!.stations.map((station) => station.depthM)
    say(`ПРОФИЛЬ: станций ${profile!.stations.length}, глубины`
      + ` ${Math.min(...depths).toFixed(2)}…${Math.max(...depths).toFixed(2)} м`)
    const recon = profile!.reconstruction
    say(`РЕКОНСТРУКЦИЯ: ${recon ? `привязка ${recon.tied ? 'есть' : 'НЕТ'},`
      + ` опорных узлов ${recon.tieNodeIds.length}, конфликтов уклона ${recon.conflicts.length},`
      + ` мелких ${recon.shallow.length}; ${recon.reason}` : 'не выполнялась'}`)
    for (const conflict of recon?.conflicts ?? []) {
      say(`  КОНФЛИКТ УКЛОНА: ${conflict.fromNodeId} → ${conflict.toNodeId}`
        + ` ${(conflict.actualSlope * 1000).toFixed(2)} ‰ (${conflict.kind}) — ${conflict.message}`)
    }
    const issues = gravity.pipes.flatMap((pipe) => pipe.issues.map((issue) => `${pipe.id}: ${issue.code}`))
    say(`ЗАМЕЧАНИЯ УЧАСТКОВ: ${issues.length}${issues.length ? ' — ' + [...new Set(issues.map((i) => i.split(': ')[1]))].join(', ') : ''}`)

    // 4. Ведомость и конструкции колодцев. Каталога конструкций у объекта нет.
    const schedule = buildSewerSchedule(gravity as never, {} as never) as never as {
      manholes: Array<{ label: string }>; pipes: unknown[]
    }
    const manholeSelection = selectManholeConstructions(schedule.manholes as never, [] as never) as never as {
      selected: unknown[]; unmatched: string[]
    }
    say(`ВЕДОМОСТЬ: колодцев ${schedule.manholes.length}, конструкций подобрано`
      + ` ${manholeSelection.selected.length}, без конструкции ${manholeSelection.unmatched.length}`)

    // 5. Комплект рабочих чертежей — тот же вызов, что в GravitySection.
    const applicable = unverifiedClauses().filter((clause) => clause.appliesSystem.includes('sewer'))
    const constraints = {
      corridorRings: [],
      ...cad,
      hardObstacleRings: dxf.buildingFootprints,
      parcelRings: dxf.parcelRings,
      utilityLines: dxf.utilityLines,
      redLines: dxf.redLines,
      roadLines: dxf.roadLines,
      waterLines: dxf.hydrography,
      surveyPoints,
    } as never as Record<string, unknown[]>
    const planContextFeatureCount = [
      constraints.cadContextLines, constraints.terrainLines, constraints.cadTextEntities,
      constraints.cadBlockEntities, constraints.hardObstacleRings, constraints.parcelRings,
      constraints.utilityLines, constraints.redLines, constraints.roadLines, constraints.waterLines,
    ].reduce((total, group) => total + count(group), 0)

    mark = performance.now()
    const drawingSet = buildWorkingDrawingSet({
      system: 'sewer',
      network,
      profile,
      schedule,
      routeStatus: 'calculated',
      routeBlockers: [],
      georeference: { kind: 'survey_grid', source: 'сетка чертежа топоосновы' },
      surveyPoints,
      planContextFeatureCount,
      unresolvedLayerCount: unresolvedLayers.length,
      catalogReady: false,
      catalogFingerprint: { activeCatalogId: null, catalogDiameters: [] },
      hydraulicsReady: Boolean(profile) && gravity.pipes.every((pipe) => pipe.issues.length === 0),
      // Промерзание НЕ ПОДТВЕРЖДЕНО: четыре кандидата, выбор владельца.
      freezingDepth: {
        valueM: 1.71,
        status: 'unverified',
        source: 'Отчёт ИГИ: четыре нормативные глубины по грунтам, выбор не сделан',
      },
      utilityFeatureCount: count(constraints.utilityLines),
      spatialBoreholeCount: 0,
      manholeCatalogReady: false,
      manholeCatalogMissingLabels: manholeSelection.unmatched,
      specificationItemCount: workingDrawingSpecificationItemCount(schedule as never, manholeSelection.selected as never),
      normsVerified: applicable.length === 0,
    } as never) as never as {
      sheets: Array<{ id: string; sheetNumber: number; title: string; kind: string; status: string; blockers: Array<{ code: string; message: string }> }>
      summary: { draftExportAllowed: boolean; finalExportAllowed: boolean }
      manifest: { pdfPageCount: number }
    }
    say(`КОМПЛЕКТ: ${took(mark)}; листов ${drawingSet.sheets.length},`
      + ` страниц PDF ${drawingSet.manifest.pdfPageCount}`)
    say(`ВОРОТА: draftExportAllowed=${drawingSet.summary.draftExportAllowed},`
      + ` finalExportAllowed=${drawingSet.summary.finalExportAllowed}`)
    say(`НОРМЫ: применимых к К1 неподтверждённых пунктов ${applicable.length}`)

    // 6. Главная таблица: лист → статус → что держит → адрес.
    say('')
    say('| № | Лист | Статус | Держит (код) | Раздел | Действие |')
    say('| ---: | --- | --- | --- | --- | --- |')
    for (const sheet of drawingSet.sheets) {
      const codes = [...new Set(sheet.blockers.map((blocker) => blocker.code))]
      const addressed = codes.map((code) => {
        const target = READINESS_SECTIONS[code]
        return target ? `${code} → ${target.title} (#${target.anchor}): ${target.action}` : `${code} → АДРЕСА НЕТ`
      })
      say(`| ${sheet.sheetNumber} | ${sheet.title} | ${sheet.status} | ${codes.join(', ') || '—'} | `
        + `${addressed.map((line) => line.split(' → ')[1] ?? '—').join('; ')} | `
        + `${addressed.map((line) => (line.split(': ')[1] ?? '—')).join('; ')} |`)
    }

    // 7. Свод готовности и адреса причин.
    const readiness = summarizeReadiness(drawingSet as never) as never as {
      sheetCount: number; verifiedPercent: number; blockingIssueCount: number; reason: string
      byStatus: Record<string, number>
      issues: Array<{ code: string; sheetCount: number; blocking: boolean; section?: string; anchor?: string; action?: string }>
    }
    say('')
    say(`ГОТОВНОСТЬ: ${readiness.reason}`)
    say(`ПО СТАТУСАМ: ${JSON.stringify(readiness.byStatus)}`)
    for (const issue of readiness.issues) {
      say(`  ${issue.blocking ? 'СТОП' : 'пред'} ${issue.code}: листов ${issue.sheetCount};`
        + ` ${issue.section ?? 'РАЗДЕЛ НЕ НАЗВАН'} (#${issue.anchor ?? '—'}) — ${issue.action ?? 'ДЕЙСТВИЕ НЕ НАЗВАНО'}`)
    }

    // Каждая причина обязана иметь адрес: без него владелец её не снимет.
    const homeless = readiness.issues.filter((issue) => !issue.section || !issue.anchor || !issue.action)
    say(`ПРИЧИН БЕЗ АДРЕСА: ${homeless.length}${homeless.length ? ' — ' + homeless.map((i) => i.code).join(', ') : ''}`)

    /**
     * Сводка для владельца: числа СЧИТАЮТСЯ повторным прогоном комплекта после
     * каждого гипотетического подтверждения, а не оцениваются на глаз.
     *
     * Подтверждения живут только внутри прогона: в проект ничего не пишется,
     * ворота выпуска не трогаются, статус источника в базе остаётся прежним.
     * Это ответ на вопрос «что мне даст вот это действие», а не действие.
     */
    const baseInput = {
      system: 'sewer', network, profile, schedule,
      routeStatus: 'calculated', routeBlockers: [],
      georeference: { kind: 'survey_grid', source: 'сетка чертежа топоосновы' },
      surveyPoints, planContextFeatureCount,
      unresolvedLayerCount: unresolvedLayers.length,
      catalogReady: false,
      catalogFingerprint: { activeCatalogId: null, catalogDiameters: [] },
      hydraulicsReady: Boolean(profile) && gravity.pipes.every((pipe) => pipe.issues.length === 0),
      freezingDepth: { valueM: 1.71, status: 'unverified', source: 'четыре кандидата отчёта ИГИ' },
      utilityFeatureCount: count(constraints.utilityLines),
      spatialBoreholeCount: 0,
      manholeCatalogReady: false,
      manholeCatalogMissingLabels: manholeSelection.unmatched,
      specificationItemCount: workingDrawingSpecificationItemCount(schedule as never, manholeSelection.selected as never),
      normsVerified: applicable.length === 0,
    }
    const setUnder = (patch: Record<string, unknown>) => buildWorkingDrawingSet({
      ...baseInput, ...patch,
    } as never) as never as {
      sheets: Array<{ sheetNumber: number; title: string; status: string; blockers: Array<{ code: string }> }>
      summary: { draftExportAllowed: boolean; finalExportAllowed: boolean }
    }
    const blockedIn = (set: ReturnType<typeof setUnder>) =>
      set.sheets.filter((sheet) => sheet.status === 'BLOCKED').length
    const base = setUnder({})
    say('')
    say(`СЕЙЧАС: заблокировано ${blockedIn(base)} из ${base.sheets.length}`)

    const ownerSteps: Array<[string, Record<string, unknown>]> = [
      ['подтвердить глубину промерзания', {
        freezingDepth: { valueM: 1.71, status: 'verified', source: 'гипотеза прогона' },
      }],
      ['задать состав проектного комплекта', {
        deliverableRequirements: {
          crossingDetailSheets: false, protectiveGridDetail: false,
          source: 'гипотеза прогона', verified: true,
        },
      }],
      ['назначить роли нераспознанным слоям', { unresolvedLayerCount: 0 }],
      ['выбрать активный каталог труб', {
        catalogReady: true, catalogFingerprint: { activeCatalogId: 'hypothetical', catalogDiameters: [450] },
      }],
    ]
    const dataSteps: Array<[string, Record<string, unknown>]> = [
      ['каталог конструкций колодцев', { manholeCatalogReady: true, manholeCatalogMissingLabels: [] }],
      ['координаты скважин (Приложение 2)', {
        spatialBoreholeCount: 3,
        geologyCoverage: { maxOffsetM: 100, status: 'verified', source: 'гипотеза прогона' },
      }],
      ['приток по зданиям', { hydraulicsReady: true }],
      // Карточка заполняется по ТУ эксплуатирующей организации: отметка,
      // диаметр и материал пересекаемой сети берутся оттуда, а не с глазомера.
      ['ТУ владельцев пересекаемых сетей → карточки пересечений', {
        crossings: [{
          id: 'X-1', stationM: 100, kind: 'utility', owner: 'гипотеза прогона',
          size: '100 мм', source: 'гипотеза прогона',
          existingElevationM: 686.0, designInvertElevationM: 683.5,
          clearanceM: 2.5, requiredClearanceM: 0.2, method: 'open cut', approved: true,
        }],
      }],
    ]
    /**
     * Две колонки, и вторая важнее.
     *
     * «Снимает в одиночку» почти везде ноль, и это не ошибка счёта: лист держат
     * по три–восемь причин разом, и снятие одной ничего не меняет. Полезен
     * НАКОПИТЕЛЬНЫЙ столбец — сколько остаётся, если делать шаги подряд.
     */
    for (const [label, list] of [['ДЕЙСТВИЯ ВЛАДЕЛЬЦА', ownerSteps], ['НЕДОСТАЮЩИЕ ДАННЫЕ', dataSteps]] as const) {
      say('')
      say(`${label}: | шаг | в одиночку снимает | нарастающим итогом заблокировано |`)
      let cumulative: Record<string, unknown> = {}
      for (const [name, patch] of list) {
        const alone = setUnder(patch)
        cumulative = { ...cumulative, ...patch }
        const running = setUnder(cumulative)
        say(`  | ${name} | ${blockedIn(base) - blockedIn(alone)} |`
          + ` ${blockedIn(running)} из ${running.sheets.length} |`)
      }
    }

    // Всё, что в силах владельца, плюс все недостающие документы — разом.
    const allPatches = Object.assign({}, ...[...ownerSteps, ...dataSteps].map(([, patch]) => patch))
    const everything = setUnder(allPatches)
    say('')
    say(`ЕСЛИ СДЕЛАНО ВСЁ: заблокировано ${blockedIn(everything)} из ${everything.sheets.length};`
      + ` черновой выпуск ${everything.summary.draftExportAllowed},`
      + ` финальный ${everything.summary.finalExportAllowed}`)
    for (const sheet of everything.sheets.filter((sheet) => sheet.status !== 'VERIFIED')) {
      say(`  ОСТАЁТСЯ ${sheet.sheetNumber} «${sheet.title}» (${sheet.status}):`
        + ` ${[...new Set(sheet.blockers.map((blocker) => blocker.code))].join(', ') || '—'}`)
    }

    /**
     * Что объект выдаёт ПРЯМО СЕЙЧАС.
     *
     * Черновой выпуск закрыт (`draftExportAllowed = false`), и обходить его
     * нельзя. Но лист — не альбом: каждый собирается сам по себе, и владелец
     * вправе увидеть, что программа уже умеет по его объекту. Собирается ровно
     * то, что собирается; несобравшееся называется с причиной.
     */
    const albumInput = {
      projectName: 'Реконструкция К1 по ул. Станкевича',
      projectCode: 'К1',
      system: 'sewer',
      network, profile, schedule, drawingSet, surveyPoints,
      manholeConstructions: manholeSelection.selected,
      constraints,
      pipeDiameterMm: new Map(gravity.pipes.map((pipe) => [pipe.id, pipe.diameterMm])),
      outletFlowLps: gravity.outletFlowLps,
    }
    say('')
    mark = performance.now()
    const scheme = buildSituationSchemeSvg({
      network,
      constraints,
      title: 'К1. Реконструкция коллектора по ул. Станкевича',
      pipeDiameterMm: albumInput.pipeDiameterMm,
    } as never) as never as { svg: string; scaleDenominator: number; contextLines: number; droppedLines: number }
    writeFileSync(join(OUT, 'scheme.svg'), scheme.svg, 'utf8')
    say(`СОБРАЛОСЬ — ситуационная схема: ${took(mark)}, М 1:${scheme.scaleDenominator},`
      + ` линий подосновы ${scheme.contextLines}, отброшено ${scheme.droppedLines}, ${scheme.svg.length} символов`)

    for (const sheet of drawingSet.sheets) {
      mark = performance.now()
      try {
        const doc = buildProjectSheetDoc(albumInput as never, sheet.id) as never as {
          content: Array<{ stack?: Array<{ svg?: string }> }>
        }
        const svg = doc.content[0]?.stack?.find((node) => typeof node.svg === 'string')?.svg
        if (svg) {
          writeFileSync(join(OUT, `sheet-${sheet.sheetNumber}.svg`), svg, 'utf8')
          say(`СОБРАЛОСЬ — лист ${sheet.sheetNumber} «${sheet.title}»: ${took(mark)}, ${svg.length} символов`)
        } else {
          say(`СОБРАЛОСЬ — лист ${sheet.sheetNumber} «${sheet.title}»: ${took(mark)}, таблица без чертежа`)
        }
      } catch (error) {
        say(`НЕ СОБРАЛОСЬ — лист ${sheet.sheetNumber} «${sheet.title}»: ${(error as Error).message}`)
      }
    }

    /**
     * Чертёж существует и рисуется — закрыт именно ВЫПУСК.
     *
     * Отдельный лист как документ не отдаётся, пока он BLOCKED, и ослаблять это
     * нельзя. Но владелец вправе увидеть, что программа по его объекту уже
     * чертит. Для этого в проекте есть режим измерения: он помечает документ
     * «НЕ ВЫПУСК», кладёт результат вне git и физически не встречается в коде
     * экранов. Ворота выпуска он не трогает — они остаются закрытыми.
     */
    say('')
    say(`ДО РАСЧЁТНОГО СОСТОЯНИЯ НЕ ДОТЯГИВАЮТ: ${belowCalculated(albumInput as never).join(', ')}`)
    mark = performance.now()
    const draft = buildBenchmarkAlbumDoc(albumInput as never) as never as { content: unknown[] }
    // Страница альбома завёрнута в `section`, отдельный лист — нет. Чертёж
    // ищется по всему поддереву: гадать о форме обёртки здесь незачем.
    const firstSvg = (node: unknown): string | undefined => {
      if (typeof node !== 'object' || node === null) return undefined
      const record = node as Record<string, unknown>
      if (typeof record.svg === 'string') return record.svg
      for (const value of Object.values(record)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            const found = firstSvg(item)
            if (found !== undefined) return found
          }
        } else {
          const found = firstSvg(value)
          if (found !== undefined) return found
        }
      }
      return undefined
    }
    const drawn = draft.content
      .map((page, index) => ({ index, svg: firstSvg(page) }))
      .filter((page): page is { index: number; svg: string } => typeof page.svg === 'string')
    say(`РЕЖИМ ИЗМЕРЕНИЯ (НЕ ВЫПУСК): ${took(mark)}; страниц ${draft.content.length}, с чертежом ${drawn.length}`)
    for (const page of drawn) {
      writeFileSync(join(OUT, `draft-${page.index + 1}.svg`), page.svg, 'utf8')
      say(`  страница ${page.index + 1}: ${page.svg.length} символов`)
    }

    writeFileSync(join(OUT, 'run.md'), report.join('\n'), 'utf8')
    expect(drawingSet.sheets.length).toBeGreaterThan(0)
  })
})
