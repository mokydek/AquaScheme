import { describe, expect, it } from 'vitest'
import { buildWorkingDrawingSet, workingDrawingSpecificationItemCount } from '@aquascheme/engine'
import type { GravityProfile, SelectedManholeConstruction, SewerSchedule, TracedNetwork } from '@aquascheme/engine'
import { generateProjectAlbumPdf, generateWorkingDrawingSetDxfs, generateWorkingDrawingSheetDxf } from './exporters'
import {
  buildAlbumDocument,
  buildProjectAlbumDoc,
  buildProjectSheetDoc,
  crossingBelongsToProfile,
  localAxisCoordinates,
  scaleMillimetresPerMetre,
} from './projectAlbum'

const network: TracedNetwork = {
  nodes: [
    { id: 'A', kind: 'ring', x: 0, y: 0, groundElevation: 100 },
    { id: 'B', kind: 'source', x: 650, y: 100, groundElevation: 98 },
  ],
  pipes: [{
    id: 'AB', kind: 'gravity_collector', fromNode: 'A', toNode: 'B', lengthM: 670,
    alignment: [{ x: 0, y: 0 }, { x: 220, y: 80 }, { x: 470, y: 40 }, { x: 650, y: 100 }],
  }],
  totalLengthM: 670,
}

const profile: GravityProfile = {
  stations: [
    { nodeId: 'A', chainageM: 0, groundElevationM: 100, invertElevationM: 97, depthM: 3, diameterMm: 800 },
    { nodeId: 'B', chainageM: 670, groundElevationM: 98, invertElevationM: 95, depthM: 3, diameterMm: 1000 },
  ],
  maxDepthM: 3,
  outletInvertElevationM: 95,
  totalLengthM: 670,
  pipeIds: ['AB'],
}

const schedule: SewerSchedule = {
  manholes: [
    { nodeId: 'A', label: 'К-1', picket: 'ПК0', depthMm: 3000, pipeDiameterMm: 800 },
    { nodeId: 'B', label: 'К-2', picket: 'ПК6+70', depthMm: 3000, pipeDiameterMm: 1000 },
  ],
  pipes: [{ designation: 'Труба', diameterMm: 800, lengthM: 670, agskCode: 'catalog-item' }],
  totalPipeLengthM: 670,
}

const surveyPoints = [{ x: 0, y: 0, z: 100 }, { x: 325, y: 50, z: 99 }, { x: 650, y: 100, z: 98 }]
const manholeConstructions: SelectedManholeConstruction[] = [{
  manholeLabel: 'К-1',
  typeCode: 'TEST-K-1',
  chamberDiameterMm: 1500,
  source: 'Тестовый катал, лист 1',
  components: [{ name: 'Кольцо', unit: 'шт', baseQuantity: 1, quantity: 3 }],
}]

function drawingSet(routeStatus: 'calculated' | 'blocked' = 'calculated') {
  return buildWorkingDrawingSet({
    system: 'storm', network, profile, schedule, routeStatus,
    georeference: { kind: 'local_anchor', source: 'control points' },
    surveyPoints,
    unresolvedLayerCount: 0,
    catalogReady: true,
    catalogFingerprint: ['800', '1000'],
    hydraulicsReady: true,
    stormRunoff: { available: true, verified: true, source: 'synthetic catchment calculation', detail: '1 catchment' },
    freezingDepth: { valueM: 1.8, status: 'verified', source: 'synthetic verified fixture' },
    utilityFeatureCount: 0,
    deliverableRequirements: {
      crossingDetailSheets: false,
      protectiveGridDetail: false,
      source: 'synthetic approved deliverable register',
      verified: true,
    },
    spatialBoreholeCount: 1,
    geologyCoverage: { maxOffsetM: 100, status: 'verified', source: 'synthetic verified corridor' },
    geologyFingerprint: [{ x: 300, y: 50 }],
    manholeCatalogReady: true,
    specificationItemCount: workingDrawingSpecificationItemCount(schedule, manholeConstructions),
    normsVerified: true,
  })
}

describe('project working-drawing album', () => {
  it('keeps plan/profile model distances at their physical paper scales', () => {
    expect(scaleMillimetresPerMetre(500)).toBe(2)
    expect(scaleMillimetresPerMetre(100)).toBe(10)
    const local = localAxisCoordinates({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 3, y: 4 })
    expect(local.x).toBeCloseTo(5, 9)
    expect(local.y).toBeCloseTo(0, 9)

    const set = drawingSet()
    const input = {
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm' as const, network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]),
      pipeDesign: new Map([['AB', { diameterMm: 800, slope: 0.00299, lengthM: 670 }]]), outletFlowLps: 12,
    }
    const svgFor = (sheetId: string) => {
      const doc = buildProjectSheetDoc(input, sheetId) as {
        content: Array<{ stack: Array<{ svg?: string }> }>
      }
      const svg = doc.content[0].stack.find((node) => typeof node.svg === 'string')?.svg
      expect(svg).toBeTruthy()
      return svg!
    }
    const parsePoints = (svg: string, marker: string) => {
      const points = svg.match(new RegExp(`${marker}="true" points="([^"]+)"`))?.[1]
      expect(points).toBeTruthy()
      return points!.trim().split(/\s+/).map((pair) => pair.split(',').map(Number))
    }
    const unitsPerMm = (svg: string) => Number(svg.match(/data-svg-units-per-mm="([^"]+)"/)?.[1])

    const planSheet = set.sheets.find((sheet) => sheet.kind === 'plan')!
    const planSvg = svgFor(planSheet.id)
    expect(planSvg).toContain('data-horizontal-scale-denominator="500"')
    expect(planSvg).toContain('data-plan-pipe="AB"')
    expect(planSvg).toContain('data-plan-node="A"')
    expect(planSvg).toContain('data-plan-node="B"')
    expect(planSvg).toContain('data-plan-station=')
    expect(planSvg).toContain('Ø800 · i=2.99‰ · L=670.0 м')
    const planPoints = parsePoints(planSvg, 'data-plan-route')
    const planPaperDistanceMm = Math.hypot(
      planPoints.at(-1)![0] - planPoints[0][0],
      planPoints.at(-1)![1] - planPoints[0][1],
    ) / unitsPerMm(planSvg)
    expect(planPaperDistanceMm).toBeCloseTo(Math.hypot(650, 100) * 2, 1)

    const profileSheet = set.sheets.find((sheet) => sheet.kind === 'profile')!
    const profileSvg = svgFor(profileSheet.id)
    expect(profileSvg).toContain('data-horizontal-mm-per-meter="2"')
    expect(profileSvg).toContain('data-vertical-mm-per-meter="10"')
    const profilePoints = parsePoints(profileSvg, 'data-profile-invert')
    expect((profilePoints.at(-1)![0] - profilePoints[0][0]) / unitsPerMm(profileSvg)).toBeCloseTo(670 * 2, 1)
    expect((profilePoints.at(-1)![1] - profilePoints[0][1]) / unitsPerMm(profileSvg)).toBeCloseTo((97 - 95) * 10, 1)

    expect(set.manifest.pages.find((page) => page.sheetId === planSheet.id)?.pageFormat.widthMm).toBe(1560)
    // Ширина профильного листа: 2·670 м в масштабе 1:500 плюс боковые поля.
    // Поля пропорциональны ВЫСОТЕ листа (отрисовка задаёт их в единицах холста,
    // а холст всегда 500 единиц высотой), а не постоянны: 0,44·297 + 3,2 ≈ 134
    // мм. Прежде здесь стояло 1640 — постоянный запас 300 мм, из-за которого
    // высокий лист переставал вмещать профиль по ширине и сборка альбома
    // падала на 38-м листе из 54 на настоящем объекте.
    expect(set.manifest.pages.find((page) => page.sheetId === profileSheet.id)?.pageFormat.widthMm).toBe(1480)
  })

  it('labels an axis-only plan as incomplete instead of presenting it as a finished drawing', () => {
    const set = drawingSet()
    const planSheet = set.sheets.find((sheet) => sheet.kind === 'plan')!
    const doc = buildProjectSheetDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: set, surveyPoints: [], manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    }, planSheet.id)
    const serialized = JSON.stringify(doc)
    expect(serialized).toContain('data-plan-context-missing')
    expect(serialized).toContain('НЕПОЛНЫЙ ПЛАН')
    expect(serialized).toContain('data-plan-pipe')
    expect(serialized).toContain('data-plan-node')
  })

  it('проводит на листе плана горизонтали по отметкам съёмки и подписывает их', () => {
    // Сетка отметок вдоль трассы: скат с перепадом 3 м даёт сечение 0,5 м.
    const grid: Array<{ x: number; y: number; z: number }> = []
    for (let i = 0; i <= 12; i++) {
      for (let j = 0; j <= 4; j++) {
        grid.push({ x: i * 55, y: j * 25, z: 100 - i * 0.25 + j * 0.05 })
      }
    }
    const doc = buildProjectAlbumDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: drawingSet(), surveyPoints: grid, manholeConstructions,
      pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    }) as { content: unknown[] }
    const serialized = JSON.stringify(doc.content)
    expect(serialized).toContain('data-contour')
    expect(serialized).toContain('Горизонтали через 0.5 м выведены по 65 отметкам съёмки')
    expect(serialized).toContain('горизонтали, сечение 0.5 м')
    // Подпись отметки стоит на утолщённых горизонталях: кратные 2,5 м.
    expect(serialized).toContain('97.50')
  })

  it('без достаточной съёмки не рисует горизонтали и говорит почему', () => {
    const doc = buildProjectAlbumDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: drawingSet(), surveyPoints: [], manholeConstructions,
      pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    }) as { content: unknown[] }
    const serialized = JSON.stringify(doc.content)
    expect(serialized).not.toContain('data-contour')
    expect(serialized).toContain('горизонтали не построены')
    expect(serialized).toContain('Точек съёмки меньше трёх')
  })

  it('разводит подписи листа и ничего не теряет', () => {
    // Тесная сцена: колодцы в 12 м друг от друга и густая подпись съёмки.
    // Раньше подписи ставились вслепую — обозначение колодца ложилось на
    // отметку съёмки, пикет на подпись участка.
    const dense = drawingSet()
    const cadTextEntities = Array.from({ length: 60 }, (_, index) => ({
      x: 40 + index * 9, y: 30 + (index % 5) * 6, text: (686 + index / 100).toFixed(2), layer: 'РЕЛЬЕФ',
    }))
    const doc = buildProjectAlbumDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: dense, surveyPoints, manholeConstructions,
      pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
      constraints: { corridorRings: [], cadTextEntities },
    }) as { content: unknown[] }
    // JSON экранирует кавычки, а разметку удобнее читать в исходном виде.
    const serialized = JSON.stringify(doc.content).replaceAll('\\"', '"')

    const planSvg = /(<svg[^>]*?data-horizontal-scale-denominator[\s\S]*?<\/svg>)/.exec(serialized)?.[1] ?? ''
    const boxes = [...planSvg.matchAll(
      /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="13" fill="#fff" stroke="#555"/g,
    )].map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: 13 }))

    // Ни одна подпись не должна пропасть: у каждого показанного колодца есть
    // обозначение, иначе колодец на листе неопознан. У участков — свой признак:
    // без подписи нет ни диаметра, ни длины.
    expect(boxes.length).toBe((planSvg.match(/data-plan-node=/g) ?? []).length)
    expect(boxes.length).toBeGreaterThan(1)
    expect((planSvg.match(/data-plan-pipe-label=/g) ?? []).length)
      .toBe((planSvg.match(/data-plan-pipe=/g) ?? []).length)

    // Прямоугольники подписей колодцев на одном листе не должны пересекаться.
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap).toBe(false)
      }
    }
  })

  it('ведёт стили плана по ролям из измеренной таблицы и повторяет марку вдоль линии', () => {
    // Существующая сеть подписана маркой съёмки, и марка повторяется вдоль
    // линии с шагом 21 мм бумаги — величина измерена по эталону.
    const doc = buildProjectAlbumDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: drawingSet(), surveyPoints, manholeConstructions,
      pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
      constraints: {
        corridorRings: [],
        utilityLines: [{ points: [{ x: 0, y: 40 }, { x: 650, y: 40 }], layer: 'Лив' }],
      },
    }) as { content: unknown[] }
    const serialized = JSON.stringify(doc.content).replaceAll('\\"', '"')
    const planSvg = /(<svg[^>]*?data-horizontal-scale-denominator[\s\S]*?<\/svg>)/.exec(serialized)?.[1] ?? ''
    const unitsPerMm = Number(/data-svg-units-per-mm="([\d.]+)"/.exec(planSvg)?.[1] ?? '0')
    expect(unitsPerMm).toBeGreaterThan(0)

    // Толщины назначены роли и заданы в миллиметрах бумаги: проектируемый
    // трубопровод — толстая основная 0,99 мм (ГОСТ 21.704 п.3.9), подоснова —
    // тонкая 0,127 мм (п.5.1.1).
    expect(planSvg).toContain(`stroke-width="${(0.99 * unitsPerMm).toFixed(3)}"`)
    expect(planSvg).toContain(`stroke-width="${(0.127 * unitsPerMm).toFixed(3)}"`)
    expect(planSvg).toContain('stroke="#b85c00"')

    const marks = [...planSvg.matchAll(/data-utility-mark="[^"]+" transform="translate\((-?[\d.]+) (-?[\d.]+)\)/g)]
      .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    expect(marks.length).toBeGreaterThan(2)
    const steps = marks.slice(1).map((mark, index) => Math.hypot(mark.x - marks[index].x, mark.y - marks[index].y))
    // Координаты в разметке округлены до десятой единицы холста, поэтому шаг
    // сверяется с точностью округления, а не буквально.
    for (const step of steps) expect(step).toBeCloseTo(21 * unitsPerMm, 0)
  })

  it('снимает подпись подосновы, когда место занято проектной: наложений нет', () => {
    // Подписи съёмки густо ложатся туда же, куда идут обозначения колодцев.
    // Приоритет теперь у проектной графики, а подоснова уступает — но уступает
    // пропуском, а не наложением.
    const cadTextEntities = Array.from({ length: 120 }, (_, index) => ({
      x: 20 + index * 5, y: 20 + (index % 7) * 5, text: (686 + index / 100).toFixed(2), layer: 'РЕЛЬЕФ',
    }))
    const doc = buildProjectAlbumDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: drawingSet(), surveyPoints, manholeConstructions,
      pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
      constraints: { corridorRings: [], cadTextEntities },
    }) as { content: unknown[] }
    const serialized = JSON.stringify(doc.content).replaceAll('\\"', '"')
    const planSvg = /(<svg[^>]*?data-horizontal-scale-denominator[\s\S]*?<\/svg>)/.exec(serialized)?.[1] ?? ''

    const nodeBoxes = [...planSvg.matchAll(
      /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="13" fill="#fff" stroke="#555"/g,
    )].map((match) => ({ x: Number(match[1]), y: Number(match[2]), w: Number(match[3]), h: 13 }))
    expect(nodeBoxes.length).toBeGreaterThan(1)

    // Коробка подписи подосновы восстанавливается по той же формуле, по которой
    // ставилась: ширина по числу знаков, базовая линия на 0,8 высоты сверху.
    const sourceBoxes = [...planSvg.matchAll(
      /<text (?:data-cad-context="text" )?x="(-?[\d.]+)" y="(-?[\d.]+)" font-size="([\d.]+)" fill="#000000">([^<]+)<\/text>/g,
    )].map((match) => {
      const size = Number(match[3])
      const height = size * 1.25
      return {
        x: Number(match[1]),
        y: Number(match[2]) - height * 0.8,
        w: match[4].length * size * 0.55,
        h: height,
      }
    })
    expect(sourceBoxes.length).toBeGreaterThan(0)

    const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    for (const source of sourceBoxes) {
      for (const node of nodeBoxes) expect(overlaps(source, node)).toBe(false)
      for (const other of sourceBoxes) {
        if (other === source) continue
        expect(overlaps(source, other)).toBe(false)
      }
    }
    // Снятое не замалчивается: лист печатает, сколько подписей не поместилось.
    expect(planSvg).toContain('снято из-за тесноты')
  })

  it('разводит выноски пересечений профиля по ярусам', () => {
    // Двадцать пересечений подряд: обе строки выноски писались на постоянной
    // высоте, и на плотном участке подписи сливались в нечитаемую полосу.
    const crossings = Array.from({ length: 20 }, (_, index) => ({
      id: `X-${index + 1}`, stationM: 40 + index * 12, kind: 'водопровод',
      owner: 'Владелец', size: 'DN100', source: 'ТУ',
      existingElevationM: 98.4, designInvertElevationM: 96.1,
      clearanceM: 1.8, requiredClearanceM: 1, method: 'открытый способ', approved: true,
    }))
    const doc = buildProjectAlbumDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: drawingSet(), surveyPoints, manholeConstructions,
      pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
      constraints: { corridorRings: [], crossings },
    }) as { content: unknown[] }
    const serialized = JSON.stringify(doc.content).replaceAll('\\"', '"')
    const profileSvg = /(<svg[^>]*?data-vertical-scale-denominator[\s\S]*?<\/svg>)/.exec(serialized)?.[1] ?? ''

    // Ни одна выноска не потеряна: без обозначения линию не связать с карточкой.
    for (const crossing of crossings) {
      expect(profileSvg).toContain(`${crossing.id} · водопровод`)
    }

    // Подложки выносок на профиле не должны пересекаться.
    const boxes = [...profileSvg.matchAll(
      /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="21" fill="#fff"/g,
    )].map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: 21 }))
    expect(boxes).toHaveLength(crossings.length)
    // Ярусы действительно используются, а не всё лежит на одной высоте.
    expect(new Set(boxes.map((box) => box.y)).size).toBeGreaterThan(1)
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap).toBe(false)
      }
    }
  })

  it('assigns tagged crossings to only their owning profile', () => {
    const legacy = { id: 'LEGACY', stationM: 10, kind: 'utility' }
    expect(crossingBelongsToProfile(legacy, undefined, ['MAIN'])).toBe(true)
    expect(crossingBelongsToProfile(legacy, 'spur', ['BRANCH'])).toBe(false)
    expect(crossingBelongsToProfile({ ...legacy, profileId: 'spur' }, 'spur', ['BRANCH'])).toBe(true)
    expect(crossingBelongsToProfile({ ...legacy, profileId: 'main' }, undefined, ['MAIN'])).toBe(true)
    expect(crossingBelongsToProfile({ ...legacy, pipeId: 'BRANCH' }, 'spur', ['BRANCH'])).toBe(true)
    expect(crossingBelongsToProfile({ ...legacy, profileId: 'other', pipeId: 'BRANCH' }, 'spur', ['BRANCH'])).toBe(false)
  })

  it('uses the dynamic register without embedding reference-album content', () => {
    const set = drawingSet()
    const doc = buildProjectAlbumDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
      constraints: {
        corridorRings: [],
        cadContextLines: [{ layer: 'GENPLAN', points: [{ x: 50, y: 15 }, { x: 600, y: 85 }] }],
        terrainLines: [{ layer: 'RELIEF', points: [{ x: 80, y: 5 }, { x: 560, y: 75 }] }],
        cadTextEntities: [{ x: 300, y: 50, text: 'CAD-CONTEXT-LABEL', layer: 'TEXT' }],
        cadBlockEntities: [{ x: 400, y: 55, name: 'CAD-BLOCK', layer: 'BLOCKS' }],
        crossings: [{
        id: 'X-1', stationM: 300, kind: 'utility', owner: 'Synthetic owner', size: '100 mm', source: 'Synthetic survey',
        existingElevationM: 98.4, designInvertElevationM: 96.1, clearanceM: 1.8, requiredClearanceM: 1,
        method: 'open cut', approved: true,
      }],
      },
      boreholes: [{
        label: 'BH-1', x: 300, y: 50, mouthElevationM: 99,
        layers: [{ igeCode: 'G1', topDepthM: 0, bottomDepthM: 4 }], water: { depthM: 2.5 },
      }],
      geologyMaxOffsetM: 100,
    }) as { content: unknown[]; info: { subject: string } }
    expect(doc.content).toHaveLength(set.sheets.length + 3)
    expect(doc.info.subject).toContain(`${set.sheets.length + 3} листов`)
    const serialized = JSON.stringify(doc.content)
    expect(serialized).not.toContain('R01')
    expect(serialized).not.toContain('фиктив')
    // Уклон и длина стоят в графе «Уклон, ‰; длина, м» — состав и запись
    // измерены по эталону: одна десятая, разделитель запятая.
    expect(serialized).toContain('data-sidebar-row=\\"Уклон, ‰; длина, м\\"')
    expect(serialized).toContain('>670,0<')
    expect(serialized).toContain('X-1')
    expect(serialized).toContain('BH-1')
    expect(serialized).toContain('CAD-CONTEXT-LABEL')
    expect(serialized).toContain('data-cad-context')
    expect(serialized).toContain('ИГЭ-G1')
    expect(serialized).toContain('Общие данные')
    expect(serialized).toContain('Точки топографической съёмки')
    expect(serialized).toContain('Хэш расчётных исходных данных')
    expect(serialized).toContain('Начало трассы')
  })

  it('keeps every network polyline but deterministically thins coincident labels and preserves diameter changes', () => {
    const set = drawingSet()
    const networkPaths = Array.from({ length: 12 }, (_, index) => ({
      pipeId: `CROWDED-${index}`,
      points: [{ x: 100, y: 25 }, { x: 550, y: 75 }],
      source: 'synthetic crowded label fixture',
    }))
    const pipeDiameterMm = new Map(networkPaths.map((path, index) => [path.pipeId, index < 6 ? 800 : 1000]))
    const doc = buildProjectAlbumDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: { ...set, networkPaths }, surveyPoints, manholeConstructions, pipeDiameterMm, outletFlowLps: 12,
    })
    const serialized = JSON.stringify(doc)
    expect(serialized.match(/data-network-pipe/g)).toHaveLength(12)
    expect(serialized.match(/data-network-label/g)).toHaveLength(2)
    expect(serialized).toContain('CROWDED-0 · Ø800')
    expect(serialized).toContain('CROWDED-6 · Ø1000')
  })

  it('adds an engineering frame and a structured lower title block without changing sheet data', () => {
    const set = drawingSet()
    const input = {
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm' as const, network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    }
    const doc = buildProjectSheetDoc(input, set.sheets[0].id) as {
      footer: unknown
      background: (currentPage: number, pageSize: { width: number; height: number }) => { canvas: Array<Record<string, number | string>> }
    }
    const footer = JSON.stringify(doc.footer)
    expect(footer).toContain('Стадия')
    expect(footer).toContain('Листов')
    expect(footer).toContain('MAIN/3')
    expect(doc.background(1, { width: 1200, height: 842 }).canvas[0]).toMatchObject({
      type: 'rect', x: 14, y: 14, w: 1172, h: 814,
    })
  })

  it('refuses to issue an album when any required source is blocked', () => {
    const set = drawingSet('blocked')
    expect(() => buildProjectAlbumDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    })).toThrow(/Финальный выпуск запрещён/)
  })

  it('renders and reopens the vector PDF with manifest-driven A3 and generated roll-sheet sizes', async () => {
    const set = drawingSet()
    const blob = await generateProjectAlbumPdf({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
      constraints: { corridorRings: [], crossings: [{
        id: 'X-1', stationM: 300, kind: 'utility', owner: 'Synthetic owner', size: '100 mm', source: 'Synthetic survey',
        existingElevationM: 98.4, designInvertElevationM: 96.1, clearanceM: 1.8, requiredClearanceM: 1,
        method: 'open cut', approved: true,
      }] },
      boreholes: [{
        label: 'BH-1', x: 300, y: 50, mouthElevationM: 99,
        layers: [{ igeCode: 'G1', topDepthM: 0, bottomDepthM: 4 }], water: { depthM: 2.5 },
      }],
      geologyMaxOffsetM: 100,
    })
    const auditPath = process.env.AQUASCHEME_PDF_AUDIT_PATH
    if (auditPath) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(auditPath, new Uint8Array(await blob.arrayBuffer()))
    }
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
    expect(pdf.numPages).toBe(set.sheets.length + 3)
    let albumText = ''
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const pageFormat = set.manifest.pages[pageNumber - 1].pageFormat
      expect(viewport.width).toBeCloseTo(pageFormat.widthMm * 72 / 25.4, 0)
      expect(viewport.height).toBeCloseTo(pageFormat.heightMm * 72 / 25.4, 0)
      albumText += (await page.getTextContent()).items.map((item) => 'str' in item ? item.str : '').join(' ')
    }
    expect(set.manifest.pages.some((page) => page.pageFormat.format === 'custom')).toBe(true)
    expect(albumText).toContain('X-1')
    expect(albumText).toContain('BH-1')
    const normalizedAlbumText = albumText.replace(/\s+/g, '')
    expect(normalizedAlbumText).toContain('670,0')
    expect(normalizedAlbumText).toContain('Общиеданные')
    expect(normalizedAlbumText).toContain('Точкитопографическойсъёмки')
    const structuresPage = await pdf.getPage(pdf.numPages - 1)
    const structuresText = (await structuresPage.getTextContent()).items
      .map((item) => 'str' in item ? item.str : '')
      .join(' ')
    expect(structuresText).toContain('К-1')
    expect(structuresText).toContain('ПК0')
    expect(structuresText.replace(/\s+/g, '')).toContain('TEST-K-1')
  }, 30_000)

  it('includes only layered boreholes inside an explicitly confirmed profile corridor', () => {
    const set = drawingSet()
    const boreholes = [
      {
        label: 'BH-NEAR', x: 300, y: 50, mouthElevationM: 99,
        layers: [{ igeCode: 'NEAR', topDepthM: 0, bottomDepthM: 4 }], water: { depthM: 2.5 },
      },
      {
        label: 'BH-FAR', x: 300, y: 5000, mouthElevationM: 99,
        layers: [{ igeCode: 'FAR', topDepthM: 0, bottomDepthM: 4 }], water: { depthM: 2.5 },
      },
    ]
    const baseInput = {
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm' as const, network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
      boreholes,
    }

    const confirmed = JSON.stringify(buildProjectAlbumDoc({ ...baseInput, geologyMaxOffsetM: 100 }))
    expect(confirmed).toContain('BH-NEAR')
    expect(confirmed).toContain('ИГЭ-NEAR')
    expect(confirmed).not.toContain('BH-FAR')
    expect(confirmed).not.toContain('ИГЭ-FAR')
    expect(confirmed).toContain('"text":"Скважины с координатами"},{"text":"1"')

    const unconfirmed = JSON.stringify(buildProjectAlbumDoc(baseInput))
    expect(unconfirmed).not.toContain('BH-NEAR')
    expect(unconfirmed).not.toContain('BH-FAR')
    expect(unconfirmed).toContain('"text":"Скважины с координатами"},{"text":"0"')
  })

  it('isolates branch-profile geology, crossings and schedule labels in PDF and DXF', async () => {
    const branchNetwork: TracedNetwork = {
      nodes: [
        ...network.nodes,
        { id: 'C', kind: 'source', x: 0, y: 1000, groundElevation: 100 },
      ],
      pipes: [
        ...network.pipes,
        {
          id: 'CB', kind: 'gravity_collector', fromNode: 'C', toNode: 'B', lengthM: 1110,
          alignment: [{ x: 0, y: 1000 }, { x: 300, y: 585 }, { x: 650, y: 100 }],
          dataSource: 'confirmed branch alignment',
        },
      ],
      totalLengthM: 1780,
    }
    const branchProfile: GravityProfile = {
      stations: [
        { nodeId: 'C', chainageM: 0, groundElevationM: 100, invertElevationM: 97, depthM: 3, diameterMm: 600 },
        { nodeId: 'B', chainageM: 1110, groundElevationM: 98, invertElevationM: 95, depthM: 3, diameterMm: 800 },
      ],
      maxDepthM: 3,
      outletInvertElevationM: 95,
      totalLengthM: 1110,
      pipeIds: ['CB'],
    }
    const branchSchedule: SewerSchedule = {
      manholes: [
        { nodeId: 'A', label: 'MAIN-A', picket: 'ПК0', depthMm: 3000, pipeDiameterMm: 800 },
        { nodeId: 'B', label: 'JOINT-B', picket: 'ПК6+70', depthMm: 3000, pipeDiameterMm: 800 },
        { nodeId: 'C', label: 'BRANCH-C', picket: 'ПК0', depthMm: 3000, pipeDiameterMm: 600 },
      ],
      pipes: [
        { designation: 'MAIN', diameterMm: 800, lengthM: 670, agskCode: 'main' },
        { designation: 'BRANCH', diameterMm: 600, lengthM: 1110, agskCode: 'branch' },
      ],
      totalPipeLengthM: 1780,
    }
    const crossings = [
      { id: 'LEGACY-MAIN', stationM: 100, kind: 'utility' },
      { id: 'TAGGED-MAIN', stationM: 120, profileId: 'main', kind: 'utility' },
      { id: 'TAGGED-BRANCH', stationM: 140, profileId: 'spur', kind: 'utility' },
      { id: 'PIPE-BRANCH', stationM: 160, pipeId: 'CB', kind: 'utility' },
      { id: 'WRONG-BRANCH', stationM: 180, profileId: 'other', kind: 'utility' },
    ]
    const set = buildWorkingDrawingSet({
      system: 'storm', network: branchNetwork, profile, schedule: branchSchedule,
      branchProfiles: [{ id: 'spur', title: 'Ветвь C-Б', source: 'confirmed branch model', verified: true, profile: branchProfile }],
      routeStatus: 'calculated',
      georeference: { kind: 'local_anchor', source: 'control points' },
      surveyPoints: [...surveyPoints, { x: 0, y: 1000, z: 100 }, { x: 300, y: 585, z: 99 }],
      unresolvedLayerCount: 0,
      catalogReady: true,
      catalogFingerprint: ['600', '800'],
      hydraulicsReady: true,
      stormRunoff: { available: true, verified: true, source: 'verified runoff', detail: 'branch fixture' },
      freezingDepth: { valueM: 1.8, status: 'verified', source: 'verified fixture' },
      utilityFeatureCount: 0,
      crossings,
      deliverableRequirements: {
        crossingDetailSheets: false,
        protectiveGridDetail: false,
        source: 'approved fixture register',
        verified: true,
      },
      spatialBoreholeCount: 2,
      geologyCoverage: { maxOffsetM: 40, status: 'verified', source: 'verified branch corridors' },
      geologyFingerprint: ['BH-MAIN', 'BH-BRANCH'],
      manholeCatalogReady: true,
      specificationItemCount: workingDrawingSpecificationItemCount(branchSchedule, []),
      normsVerified: true,
    })
    const input = {
      projectName: 'Разветвлённый тест', projectCode: 'К2', system: 'storm' as const,
      network: branchNetwork, profile, schedule: branchSchedule, drawingSet: set,
      surveyPoints: [...surveyPoints, { x: 0, y: 1000, z: 100 }, { x: 300, y: 585, z: 99 }],
      manholeConstructions: [], pipeDiameterMm: new Map([['AB', 800], ['CB', 600]]), outletFlowLps: 12,
      constraints: { corridorRings: [], crossings },
      boreholes: [
        {
          label: 'BH-MAIN', x: 300, y: 50, mouthElevationM: 99,
          layers: [{ igeCode: 'MAIN', topDepthM: 0, bottomDepthM: 3 }], water: {},
        },
        {
          label: 'BH-BRANCH', x: 100, y: 862, mouthElevationM: 99,
          layers: [{ igeCode: 'BRANCH', topDepthM: 0, bottomDepthM: 3 }], water: {},
        },
      ],
      geologyMaxOffsetM: 40,
    }
    const mainSheet = set.sheets.find((sheet) => sheet.kind === 'profile' && sheet.variant === 'main_profile')!
    const branchSheet = set.sheets.find((sheet) => sheet.kind === 'profile' && sheet.profileId === 'spur')!
    expect(mainSheet.status).toBe('VERIFIED')
    expect(branchSheet.status).toBe('VERIFIED')

    const mainPdf = JSON.stringify(buildProjectSheetDoc(input, mainSheet.id))
    const branchPdf = JSON.stringify(buildProjectSheetDoc(input, branchSheet.id))
    expect(mainPdf).toContain('BH-MAIN')
    expect(mainPdf).not.toContain('BH-BRANCH')
    expect(mainPdf).toContain('LEGACY-MAIN')
    expect(mainPdf).toContain('TAGGED-MAIN')
    expect(mainPdf).not.toContain('TAGGED-BRANCH')
    expect(branchPdf).toContain('BH-BRANCH')
    expect(branchPdf).not.toContain('BH-MAIN')
    expect(branchPdf).toContain('TAGGED-BRANCH')
    expect(branchPdf).toContain('PIPE-BRANCH')
    expect(branchPdf).not.toContain('LEGACY-MAIN')
    expect(branchPdf).not.toContain('WRONG-BRANCH')
    expect(branchPdf).toContain('BRANCH-C')
    expect(branchPdf).toContain('JOINT-B')

    const branchDxf = await generateWorkingDrawingSheetDxf(input, branchSheet.id)
    expect(branchDxf).toContain('BH-BRANCH')
    expect(branchDxf).not.toContain('BH-MAIN')
    expect(branchDxf).toContain('TAGGED-BRANCH')
    expect(branchDxf).toContain('PIPE-BRANCH')
    expect(branchDxf).not.toContain('LEGACY-MAIN')
    expect(branchDxf).not.toContain('WRONG-BRANCH')
    expect(branchDxf).toContain('BRANCH-C')
    expect(branchDxf).toContain('JOINT-B')
  })

  it('exports every calculated register sheet as an independent DXF', async () => {
    const set = drawingSet()
    const input = {
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm' as const, network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    }
    for (const sheet of set.sheets) {
      const dxf = await generateWorkingDrawingSheetDxf(input, sheet.id)
      expect(dxf).toContain('SECTION')
      expect(dxf.trimEnd().endsWith('EOF')).toBe(true)
    }
  })

  it('passes imported CAD and survey context into single-sheet and complete-set plan DXFs', async () => {
    const set = drawingSet()
    const input = {
      projectName: 'CAD context export fixture', projectCode: 'K2', system: 'storm' as const, network, profile, schedule,
      drawingSet: set,
      surveyPoints: [{ x: 60, y: 20, z: 101.25 }],
      manholeConstructions,
      pipeDiameterMm: new Map([['AB', 800]]),
      outletFlowLps: 12,
      constraints: {
        corridorRings: [],
        cadContextLines: [{ layer: 'GENPLAN', points: [{ x: 40, y: 10 }, { x: 90, y: 30 }] }],
        terrainLines: [{ layer: 'RELIEF', points: [{ x: 45, y: 12 }, { x: 95, y: 32 }] }],
        cadTextEntities: [{ x: 70, y: 22, text: 'DXF-CAD-TEXT', layer: 'NOTES' }],
        cadBlockEntities: [{ x: 80, y: 24, name: 'DXF-CAD-BLOCK', layer: 'BLOCKS' }],
      },
    }
    const planSheet = set.sheets.find((sheet) => sheet.kind === 'plan')!
    const single = await generateWorkingDrawingSheetDxf(input, planSheet.id)
    for (const marker of [
      'K2-BASE-CAD-GENPLAN',
      'K2-BASE-TERRAIN-RELIEF',
      'DXF-CAD-TEXT',
      'DXF-CAD-BLOCK',
      'K2-BASE-SURVEY',
      '101.25',
    ]) expect(single).toContain(marker)

    const complete = await generateWorkingDrawingSetDxfs(input)
    const planFile = complete.find((file) => file.sheetId === planSheet.id)
    expect(planFile).toBeTruthy()
    expect(planFile!.dxf).toContain('K2-BASE-CAD-GENPLAN')
    expect(planFile!.dxf).toContain('DXF-CAD-TEXT')
    expect(planFile!.dxf).toContain('DXF-CAD-BLOCK')
    expect(planFile!.dxf).toContain('101.25')
  })

  it('exports a complete DXF set with the exact register ids and sheet numbers', async () => {
    const set = drawingSet()
    const files = await generateWorkingDrawingSetDxfs({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm', network, profile, schedule,
      drawingSet: set, surveyPoints, manholeConstructions, pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    })
    expect(files.map(({ sheetId, sheetNumber }) => ({ sheetId, sheetNumber }))).toEqual(
      set.sheets.map(({ id: sheetId, sheetNumber }) => ({ sheetId, sheetNumber })),
    )
    for (const file of files) {
      expect(file.dxf).toContain('SECTION')
      expect(file.dxf.trimEnd().endsWith('EOF')).toBe(true)
    }
  })
})

describe('условный горизонт меняется внутри листа, а лист не растёт', () => {
  /** Профиль с заданным перепадом: земля и лоток равномерно уходят вниз. */
  const slopingProfile = (dropM: number) => ({
    stations: Array.from({ length: 6 }, (_, index) => ({
      nodeId: `K-${index + 1}`,
      chainageM: index * 100,
      groundElevationM: 100 - (dropM * index) / 5,
      invertElevationM: 98 - (dropM * index) / 5,
      depthM: 2,
      diameterMm: 800,
    })),
    maxDepthM: 2,
    outletInvertElevationM: 98 - dropM,
    totalLengthM: 500,
    pipeIds: ['P-1', 'P-2', 'P-3', 'P-4', 'P-5'],
  })

  const sheetSvg = (dropM: number) => {
    const set = drawingSet()
    const profileSheet = set.sheets.find((sheet) => sheet.kind === 'profile')!
    const doc = buildProjectSheetDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm',
      network, profile: slopingProfile(dropM) as never, schedule,
      drawingSet: set, surveyPoints, manholeConstructions,
      pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    } as never, profileSheet.id) as { content: Array<{ stack: Array<{ svg?: string }> }> }
    const svg = doc.content[0].stack.find((node) => typeof node.svg === 'string')?.svg ?? ''
    return { svg, set, profileSheet }
  }

  const datumCount = (svg: string) => (svg.match(/data-datum-label="true"/g) ?? []).length

  it('пологий профиль обходится одним горизонтом', () => {
    // Полоса чертежа вмещает около пятнадцати метров перепада — столько же,
    // сколько показывает шкала отметок на листах эталона (13…17 м).
    expect(datumCount(sheetSvg(6).svg)).toBe(1)
  })

  it('перепад больше полосы вводит смену горизонта', () => {
    expect(datumCount(sheetSvg(24).svg)).toBeGreaterThan(1)
  })

  it('чем глубже перепад, тем больше горизонтов', () => {
    expect(datumCount(sheetSvg(48).svg)).toBeGreaterThan(datumCount(sheetSvg(24).svg))
  })

  it('высота листа не меняется от перепада', () => {
    for (const dropM of [6, 24, 48]) {
      const { set, profileSheet } = sheetSvg(dropM)
      const page = set.manifest.pages.find((item) => item.sheetId === profileSheet.id)
      expect(page?.pageFormat.heightMm, `перепад ${dropM} м`).toBe(297)
    }
  })

  it('линия профиля разрывается на границе горизонта, а не тянется через скачок', () => {
    // Один горизонт — одна ломаная; два горизонта — две.
    const one = (sheetSvg(6).svg.match(/data-profile-invert="true"/g) ?? []).length
    const many = (sheetSvg(48).svg.match(/data-profile-invert="true"/g) ?? []).length
    expect(one).toBe(1)
    expect(many).toBeGreaterThan(1)
  })

  it('базовые отметки круглые — кратны пяти метрам', () => {
    const labels = [...sheetSvg(48).svg.matchAll(/УГ (-?\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]))
    expect(labels.length).toBeGreaterThan(1)
    for (const datum of labels) expect(datum % 5).toBeCloseTo(0, 9)
  })

  it('боковик несёт графы эталона в измеренном порядке и с измеренными высотами', () => {
    // Порядок и высоты сняты по эталону (стр. 34 и 40): разделители граф лежат
    // на 15, 20, 25, 35, 45, 50, 55, 70, 85, 100, 115 мм от нижней кромки листа.
    const { svg } = sheetSvg(6)
    const unitsPerMm = Number(/data-svg-units-per-mm="([\d.]+)"/.exec(svg)?.[1] ?? '0')
    expect(unitsPerMm).toBeGreaterThan(0)
    const bands = [...svg.matchAll(/data-sidebar-band="(\d+)-(\d+)" x="35" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)]
      .map((match) => ({
        fromMm: Number(match[1]), toMm: Number(match[2]), y: Number(match[3]), height: Number(match[4]),
      }))
    expect(bands.map((band) => [band.fromMm, band.toMm])).toEqual([
      [5, 15], [15, 25], [25, 35], [35, 45], [45, 50], [50, 55], [55, 70], [70, 85], [85, 100], [100, 115],
    ])
    for (const band of bands) {
      expect(band.height).toBeCloseTo((band.toMm - band.fromMm) * unitsPerMm, 1)
      // Полоса отсчитывается от нижней кромки листа: холст 500 единиц высотой.
      expect(band.y).toBeCloseTo(500 - band.toMm * unitsPerMm, 1)
    }
    // Заголовки — дословно из текстового слоя эталона.
    expect(svg).toContain('data-sidebar-title="Уклон, ‰; длина, м"')
    expect(svg).toContain('data-sidebar-title="Натурная отметка земли, м"')
    expect(svg).toContain('data-sidebar-title="Проектная отметка низа трубы или низа лотка колодца, м"')
    // Полоса 50…55 мм у эталона пуста: разделители есть, заголовка нет.
    expect(svg).not.toContain('data-sidebar-title=""')
  })

  it('целые пикеты подписаны каждые 100 м, ординаты стоят на станциях', () => {
    const { svg } = sheetSvg(6)
    const picketMarks = [...svg.matchAll(/data-profile-picket="(\d+)" x1="([\d.]+)"/g)]
      .map((match) => ({ metre: Number(match[1]), x: Number(match[2]) }))
    // Лист испытания идёт от ПК0 до ПК6+70 — семь целых пикетов.
    expect(picketMarks.map((mark) => mark.metre)).toEqual([0, 100, 200, 300, 400, 500, 600])
    const unitsPerMm = Number(/data-svg-units-per-mm="([\d.]+)"/.exec(svg)?.[1] ?? '0')
    const steps = picketMarks.slice(1).map((mark, index) => mark.x - picketMarks[index].x)
    // 100 м при 1:500 — это 200 мм бумаги, и шаг обязан быть ровно таким.
    for (const step of steps) expect(step).toBeCloseTo(200 * unitsPerMm, 1)
    expect(svg).toContain('>ПК 3<')
    // Ординаты — на станциях, а не постоянным шагом: графы привязаны к ним.
    const ordinates = [...svg.matchAll(/data-profile-ordinate="([\d.]+)"/g)].map((match) => Number(match[1]))
    // Станции профиля плюс замыкающая станция на конце листа.
    expect(ordinates.slice(0, 6)).toEqual([0, 100, 200, 300, 400, 500])
    expect(ordinates.at(-1)).toBeCloseTo(670, 2)
  })

  it('отметки боковика абсолютные и от смены базы не зависят', () => {
    // Числа в графах «лоток» и «земля» — проектные величины; смена условного
    // горизонта это подача, а не расчёт, и трогать их она не смеет.
    const shallow = sheetSvg(6).svg
    const deep = sheetSvg(48).svg
    const inverts = (svg: string) => [...svg.matchAll(
      /data-sidebar-row="Проектная отметка низа трубы или низа лотка колодца, м"[^>]*>([\d,]+)</g,
    )].map((match) => match[1])
    expect(inverts(shallow).length).toBeGreaterThan(0)
    // Профили разные, поэтому сравниваем не значения, а то, что подписи
    // соответствуют СВОИМ станциям в обоих случаях.
    expect(inverts(deep)[0]).toBe('98,00')
    expect(inverts(shallow)[0]).toBe('98,00')
  })
})

describe('врезка положения листа', () => {
  const planSvg = (withContext: boolean) => {
    const set = drawingSet()
    const planSheet = set.sheets.find((sheet) => sheet.kind === 'plan')!
    const doc = buildProjectSheetDoc({
      projectName: 'Тестовый объект', projectCode: 'К2', system: 'storm',
      network, profile, schedule, drawingSet: set, surveyPoints, manholeConstructions,
      pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
      ...(withContext
        ? {
          constraints: {
            corridorRings: [],
            cadContextLines: Array.from({ length: 900 }, (_, index) => ({
              points: [{ x: index, y: 0 }, { x: index, y: 40 }],
            })),
          },
        }
        : {}),
    } as never, planSheet.id) as { content: Array<{ stack: Array<{ svg?: string }> }> }
    return doc.content[0].stack.find((node) => typeof node.svg === 'string')?.svg ?? ''
  }

  it('прямоугольник границ листа нарисован', () => {
    expect(planSvg(false)).toContain('data-inset-sheet-bounds="true"')
  })

  it('прямоугольник лежит внутри кадра врезки', () => {
    const svg = planSvg(false)
    const rect = /data-inset-sheet-bounds="true" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(svg)!
    const frame = /<rect x="([\d.]+)" y="35" width="150" height="90"/.exec(svg)!
    const [x, y, w, h] = rect.slice(1, 5).map(Number)
    const frameX = Number(frame[1])
    // Врезка сдвинута трансформом на -20 по вертикали, поэтому кадр по Y — 15…105.
    expect(x).toBeGreaterThanOrEqual(frameX - 1)
    expect(x + w).toBeLessThanOrEqual(frameX + 150 + 1)
    expect(y).toBeGreaterThanOrEqual(14)
    expect(y + h).toBeLessThanOrEqual(126)
  })

  it('подоснова во врезке прорежена, а не выведена целиком', () => {
    // Полные четырнадцать тысяч линий сделали бы врезку чёрным пятном.
    const svg = planSvg(true)
    const thin = (svg.match(/stroke="#dcdcdc" stroke-width="0.4"/g) ?? []).length
    expect(thin).toBeGreaterThan(0)
    expect(thin).toBeLessThanOrEqual(400)
  })

  it('без подосновы врезка всё равно строится', () => {
    expect(planSvg(false)).toContain('Положение листа')
  })
})

describe('водяной знак «ДЕМО» ставится только в демо-сборке', () => {
  const albumInput = (syntheticData: boolean) => ({
    projectName: 'Демо-объект', projectCode: 'К2', system: 'storm' as const,
    network, profile, schedule, drawingSet: drawingSet(), surveyPoints, manholeConstructions,
    pipeDiameterMm: new Map([['AB', 800]]), outletFlowLps: 12,
    syntheticData,
  })

  const backgroundOf = (doc: unknown, page = 2) => {
    const background = (doc as { background?: unknown }).background
    if (typeof background !== 'function') return ''
    return JSON.stringify((background as (p: number, s: { width: number; height: number }) => unknown)(
      page, { width: 1190, height: 842 },
    ))
  }

  it('демо-альбом несёт знак на каждом листе', () => {
    const doc = buildAlbumDocument(albumInput(true), 'demo')
    for (const page of [2, 5, 12]) {
      const background = backgroundOf(doc, page)
      expect(background).toContain('ДЕМО')
      expect(background).toContain('не для производства')
    }
  })

  it('в режиме измерения сходства знака нет: он отравил бы сравнение', () => {
    // Знак лёг бы поверх графики и испортил само число, ради которого сборка и
    // делается. Проверка защищает сходство коллектора.
    expect(backgroundOf(buildAlbumDocument(albumInput(true), 'benchmark'))).not.toContain('ДЕМО')
  })

  it('на настоящих данных знака нет ни в одном режиме', () => {
    expect(backgroundOf(buildAlbumDocument(albumInput(false), 'benchmark'))).not.toContain('ДЕМО')
    // Рамка листа при этом на месте: знак добавляется к ней, а не вместо неё.
    expect(backgroundOf(buildAlbumDocument(albumInput(false), 'benchmark'))).toContain('canvas')
  })

  it('знак идёт фоном, то есть под содержанием и штампом листа', () => {
    const doc = buildAlbumDocument(albumInput(true), 'demo') as { background?: unknown; footer?: unknown }
    expect(typeof doc.background).toBe('function')
    // Штамп рисует подвал, и знак его не подменяет.
    expect(typeof doc.footer).toBe('function')
  })
})
