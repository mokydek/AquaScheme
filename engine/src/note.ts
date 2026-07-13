import type { ExportInput } from './exportdata'
import { materialLabel } from './exportdata'
import { assessHazards } from './equipment'
import type { HazardMeasureCode, MaterialReasonCode } from './equipment'
import { assessGeologyInfluences, sampleGeoAlong } from './geoprofile'
import type { GeoInfluenceCode } from './geoprofile'
import { summarizeGeology } from './geology'
import type { HazardKind } from './regions'
import { getClause, NORM_DOCUMENTS } from './normregistry'

/**
 * Builds an explanatory note as a pdfmake document definition (a plain
 * object). The engine stays free of the pdfmake dependency; the frontend
 * feeds this object to pdfmake. Output language is Russian (MVP scope).
 */

// A minimal structural type; compatible with pdfmake TDocumentDefinitions.
export type NoteDoc = Record<string, unknown>

const SOIL_LABELS: Record<string, string> = {
  sand: 'песок',
  loam: 'суглинок',
  clay: 'глина',
  rock: 'скальный грунт',
}

const CORROSIVITY_LABELS: Record<string, string> = {
  low: 'низкая',
  medium: 'средняя',
  high: 'высокая',
}

const REASON_TEXT: Record<MaterialReasonCode, string> = {
  corrosionProtection:
    'Агрессивные грунты или высокий уровень грунтовых вод: принят неметаллический материал труб.',
  seismicJoints:
    'Сейсмичность площадки 7 баллов и выше: приняты сварные соединения и компенсационные вставки у колодцев и на вводах в здания (СП РК 2.03-30-2017).',
  subsidence: 'Просадочные грунты: обеспечена гибкость стыков и контроль осадок.',
  flood: 'Подтопляемость территории: предусмотрена защита колодцев и оборудования от затопления.',
  pressureClass: 'Класс давления труб принят с запасом от расчётного рабочего давления сети.',
  freezingDepth: 'Низ трубы заглублён на 0.5 м ниже расчётной глубины промерзания.',
}

const HAZARD_LABELS: Record<HazardKind, string> = {
  earthquake: 'землетрясение',
  flood: 'паводок и подтопление',
  mudflow: 'сель',
  landslide: 'оползень',
  subsidence: 'просадочные грунты',
  karst: 'карст',
  high_groundwater: 'высокий уровень грунтовых вод',
}

const AGGRESSIVENESS_LABELS: Record<string, string> = { low: 'низкая', medium: 'средняя', high: 'высокая' }

const GEO_INFLUENCE_TEXT: Record<GeoInfluenceCode, string> = {
  corrosion: 'Защита от коррозии: по агрессивности среды вдоль трассы принят неметаллический материал или защитное покрытие.',
  bedding: 'Основание и постель труб приняты по виду грунта вдоль трассы.',
  dewatering: 'На участках с высоким уровнем грунтовых вод предусмотрено водопонижение при производстве работ.',
  subsidence: 'Просадочные грунты: приняты мероприятия по подготовке основания и контролю осадок.',
  heaving: 'Пучинистые грунты: приняты противопучинистые мероприятия основания.',
}

const HAZARD_MEASURE_TEXT: Record<HazardMeasureCode, string> = {
  sealedManholes: 'Колодцы в зоне подтопления приняты герметичными.',
  checkValves: 'На выпусках предусмотрены обратные клапаны.',
  raisedCovers: 'Отметки люков колодцев приняты выше расчётного горизонта воды.',
  slopeWarning:
    'ПРЕДУПРЕЖДЕНИЕ. Территория подвержена селям или оползням: требуются специальные инженерные мероприятия по отдельному проекту инженерной защиты; автоматический расчёт их не заменяет.',
  karstWarning:
    'ПРЕДУПРЕЖДЕНИЕ. Территория подвержена карсту: требуется инженерная защита по отдельному проекту.',
  dewateringWarning:
    'Высокий уровень грунтовых вод: при производстве работ предусмотреть водопонижение (инженерное решение).',
}

const REFERENCES = [
  'СП РК 4.01-101-2012. Водоснабжение. Наружные сети и сооружения.',
  'СП РК 2.03-30-2017. Строительство в сейсмических зонах.',
  'ГОСТ 21.704-2011. Правила выполнения рабочей документации наружных сетей водоснабжения.',
  'СНиП 2.04.02-84* (справочно). Методика гидравлического расчёта.',
]

const DISCLAIMER =
  'Система является инструментом автоматизации проектирования. Окончательные решения принимает инженер; проект подлежит экспертизе в установленном порядке.'

const PIPE_KIND_LABEL: Record<string, string> = {
  supply: 'Водовод',
  ring: 'Кольцо',
  main: 'Магистраль',
  cross: 'Перемычка',
  service: 'Ввод',
}

/** Reference to a registry clause, with an unverified marker. */
function clauseText(id: string): string {
  const c = getClause(id)
  if (!c) return id
  const clause = c.clause ? `п. ${c.clause}` : 'пункт уточняется'
  return `${c.documentCode} ${clause}${c.status === 'unverified' ? ' (требует проверки)' : ''}`
}

/** A "Нормативное обоснование" line under a decision table. */
function basisLine(ids: string[], extra?: string): Record<string, unknown> {
  const parts = ids.map(clauseText)
  if (extra) parts.push(extra)
  return {
    text: `Нормативное обоснование: ${parts.join('; ')}`,
    fontSize: 8,
    italics: true,
    color: '#555555',
    margin: [0, 2, 0, 8],
  }
}

function heading(text: string): Record<string, unknown> {
  return { text, style: 'h2', margin: [0, 14, 0, 6] }
}

function kvTable(rows: Array<[string, string]>): Record<string, unknown> {
  return {
    table: {
      widths: ['*', 'auto'],
      body: rows.map(([k, v]) => [
        { text: k, color: '#555555' },
        { text: v, alignment: 'right' },
      ]),
    },
    layout: 'lightHorizontalLines',
    margin: [0, 4, 0, 4],
  }
}

export function buildNoteDoc(input: ExportInput): NoteDoc {
  const d = input.demand
  const m = input.material
  const g = input.geology
  const s = input.seismicity

  const hydraulicBody: unknown[] = [
    ['Участок', 'Тип', 'D, мм', 'L, м', 'Q, л/с', 'V, м/с', '1000i', 'h, м'].map((t) => ({
      text: t,
      bold: true,
    })),
  ]
  const labelOfNode = buildNodeLabeler(input)
  for (const p of [...input.sizing.pipes].sort(sortPipes)) {
    hydraulicBody.push([
      `${labelOfNode(p.fromNode)}–${labelOfNode(p.toNode)}`,
      PIPE_KIND_LABEL[p.kind] ?? p.kind,
      String(p.nominalMm),
      p.lengthM.toFixed(1),
      Math.abs(p.flowLps).toFixed(2),
      p.velocityMs.toFixed(2),
      p.unitHeadlossMPerKm.toFixed(1),
      p.headlossM.toFixed(2),
    ])
  }

  const pressureBody: unknown[] = [
    ['Здание', 'Этажей', 'Требуется, м', 'Факт, м', 'Оценка'].map((t) => ({ text: t, bold: true })),
  ]
  const buildingById = new Map(input.buildings.map((b) => [b.id, b]))
  for (const node of input.sizing.nodes.filter((n) => n.buildingId)) {
    const building = buildingById.get(node.buildingId as string)
    pressureBody.push([
      building?.label ?? node.id,
      String(building?.floors ?? ''),
      node.requiredPressureM != null ? node.requiredPressureM.toFixed(1) : '—',
      node.pressureM.toFixed(1),
      node.ok ? 'норма' : 'проверить',
    ])
  }

  const content: unknown[] = [
    { text: 'Пояснительная записка', style: 'h1' },
    { text: `Проект: ${input.projectName}`, margin: [0, 2, 0, 0] },
    { text: `Дата: ${input.dateIso.slice(0, 10)}`, margin: [0, 0, 0, 8] },
    { text: DISCLAIMER, italics: true, color: '#555555', margin: [0, 0, 0, 6] },

    heading('1. Исходные данные'),
    kvTable([
      ['Отметка земли у источника, м', input.source.groundElevation.toFixed(2)],
      ['Располагаемый напор источника, м', input.source.availableHead.toFixed(1)],
      ['Удельное водопотребление, л/сут на человека', String(input.norms.perCapitaDemandLpd)],
      ['Коэффициент суточной неравномерности', String(input.norms.dayMaxCoefficient)],
      ['Коэффициент альфа max', String(input.norms.alphaMax)],
      ['Расход на пожаротушение, л/с', String(input.norms.fireFlowLps)],
      ['Тип грунта', SOIL_LABELS[g.soilType] ?? g.soilType],
      ['Уровень грунтовых вод, м', g.groundwaterDepthM.toFixed(1)],
      ['Коррозионная агрессивность грунта', CORROSIVITY_LABELS[g.corrosivity] ?? g.corrosivity],
      ['Глубина промерзания, м', g.freezingDepthM.toFixed(2)],
      ['Сейсмичность площадки, баллов', String(s.siteIntensityPoints)],
    ]),
    ...geologyProfileSection(input),

    heading('2. Методика и нормативная база'),
    {
      text: 'Расчётные расходы приняты по СП РК 4.01-101 (методика СНиП 2.04.02-84*). Гидравлический расчёт выполнен по формуле Дарси-Вейсбаха, потокораспределение и увязка колец — программой EPANET 2.2. Диаметры подобраны итерационно из стандартного ряда.',
      margin: [0, 0, 0, 4],
    },
    { ul: REFERENCES },

    heading('3. Расчётные расходы воды'),
    kvTable([
      ['Число жителей', String(d.totalResidents)],
      ['Q сут.ср, м³/сут', d.avgDailyM3.toFixed(2)],
      ['Q сут.max, м³/сут', d.maxDailyM3.toFixed(2)],
      ['K ч.max (альфа × бета)', `${d.kHourMax.toFixed(2)} (${d.alphaMax.toFixed(2)} × ${d.betaMax.toFixed(2)})`],
      ['Q ч.max, м³/ч', d.maxHourlyM3h.toFixed(2)],
      ['Расчётный секундный расход, л/с', d.designFlowLps.toFixed(2)],
      ['С учётом пожаротушения, л/с', d.designFlowWithFireLps.toFixed(2)],
    ]),
    basisLine(['demand.perCapita', 'demand.kDayMax', 'demand.hourly', 'fire.flow']),

    heading('4. Гидравлический расчёт по участкам'),
    {
      table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'], body: hydraulicBody },
      layout: 'lightHorizontalLines',
      fontSize: 8,
    },
    basisLine(['velocity.economic', 'velocity.max', 'main.looped']),

    heading('5. Проверка свободных напоров у зданий'),
    {
      text: 'Требуемый свободный напор: 10 м при одноэтажной застройке плюс 4 м на каждый следующий этаж.',
      margin: [0, 0, 0, 4],
    },
    {
      table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto'], body: pressureBody },
      layout: 'lightHorizontalLines',
      fontSize: 8,
    },
    basisLine(['freeHead.base', 'freeHead.perFloor', 'freeHead.max']),

    heading('6. Материалы, стыки и глубина заложения'),
    kvTable([
      ['Материал труб', materialLabel(input)],
      ['Тип стыков', m.jointType === 'welded' ? 'сварные' : 'гибкие раструбные'],
      ['Глубина заложения до низа трубы, м', m.burialDepthM.toFixed(2)],
      ['Компенсационные вставки', m.needsCompensators ? 'требуются' : 'не требуются'],
    ]),
    { ul: m.reasons.map((r) => REASON_TEXT[r]).filter(Boolean), margin: [0, 4, 0, 0] },
    ...geologyInfluenceSection(input),
    basisLine(
      ['burial.depth', 'seismic.joints'],
      'выбор марки материала — проектное решение по критерию минимальной стоимости; норматив выбор не регламентирует',
    ),

    heading('7. Арматура и сооружения'),
    kvTable([
      ['Пожарные гидранты, шт', String(input.fittings.counts.hydrants)],
      ['Задвижки, шт', String(input.fittings.counts.valves)],
      ['Вантузы, шт', String(input.fittings.counts.airValves)],
      ['Выпуски, шт', String(input.fittings.counts.washouts)],
      ['Колодцы, шт', String(input.fittings.counts.wells)],
    ]),
    basisLine(['hydrant.spacing']),

    heading('8. Учёт региональных рисков и ЧС'),
    ...hazardSection(input),

    heading('9. Перечень использованных нормативных документов'),
    {
      ol: NORM_DOCUMENTS.map(
        (dd) =>
          `${dd.code} — ${dd.title}${dd.status === 'unverified' ? ' (ссылки на пункты требуют проверки по официальному изданию)' : ''}`,
      ),
    },
    {
      text: 'Часть ссылок на пункты нормативов помечена как требующая проверки по официальному изданию СП РК и ГОСТ. Окончательная сверка выполняется инженером.',
      fontSize: 9,
      italics: true,
      color: '#555555',
      margin: [0, 4, 0, 0],
    },

    { text: DISCLAIMER, italics: true, color: '#555555', margin: [0, 16, 0, 0] },
  ]

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    content,
    styles: {
      h1: { fontSize: 18, bold: true },
      h2: { fontSize: 13, bold: true },
    },
    defaultStyle: { fontSize: 10, lineHeight: 1.2 },
    footer: (currentPage: number, pageCount: number) => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: 'center',
      fontSize: 8,
      color: '#8a8a8a',
      margin: [0, 8, 0, 0],
    }),
  }
}

/** Ring main path (node order R1..Rn closed) for geology sampling. */
function ringPath(input: ExportInput): Array<{ x: number; y: number }> {
  const ring = input.network.nodes
    .filter((n) => n.kind === 'ring')
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  return ring.length >= 2 ? [...ring, ring[0]].map((n) => ({ x: n.x, y: n.y })) : []
}

/**
 * Geology cross-section along the route (G3): boreholes interpolated per
 * station. Appears in section 1 only when boreholes are provided; old projects
 * without boreholes keep the summary-only geology inputs above.
 */
function geologyProfileSection(input: ExportInput): unknown[] {
  const boreholes = input.boreholes ?? []
  if (boreholes.length === 0) return []
  const path = ringPath(input)
  if (path.length === 0) return []
  const stations = sampleGeoAlong(boreholes, path, input.material.burialDepthM)

  const body: unknown[] = [
    ['Пикет, м', 'Грунт', 'УГВ, м', 'Агрессивность'].map((tt) => ({ text: tt, bold: true })),
  ]
  for (const st of stations) {
    body.push([
      st.stationM.toFixed(0),
      st.geo.soilName ?? '—',
      st.geo.waterDepthM !== null ? st.geo.waterDepthM.toFixed(1) : '—',
      st.geo.aggressiveness ? AGGRESSIVENESS_LABELS[st.geo.aggressiveness] : '—',
    ])
  }
  return [
    { text: 'Геологический разрез по трассе (интерполяция между скважинами):', margin: [0, 6, 0, 2] },
    {
      table: { headerRows: 1, widths: ['auto', '*', 'auto', 'auto'], body },
      layout: 'lightHorizontalLines',
      fontSize: 8,
    },
  ]
}

/** Geology-driven design influences appended to section 6 (materials). */
function geologyInfluenceSection(input: ExportInput): unknown[] {
  const boreholes = input.boreholes ?? []
  if (boreholes.length === 0) return []
  const summary = summarizeGeology({ boreholes })
  const influences = assessGeologyInfluences({
    maxAggressiveness: summary.maxAggressiveness,
    minWaterDepthM: summary.minWaterDepthM,
    burialDepthM: input.material.burialDepthM,
    dominantSoil: boreholes[0]?.layers[0]?.soilName ?? null,
    attributes: input.geologyAttributes,
  })
  if (influences.length === 0) return []
  const refs = [...new Set(influences.flatMap((i) => i.refs))]
  return [
    { text: 'Влияние геологии вдоль трассы:', margin: [0, 6, 0, 2] },
    { ul: influences.map((i) => GEO_INFLUENCE_TEXT[i.code]), margin: [0, 0, 0, 2] },
    basisLine(refs),
  ]
}

/** Section 8 content: region, declared hazards, measures and warnings. */
function hazardSection(input: ExportInput): unknown[] {
  const s = input.seismicity
  const hazards = [
    ...new Set<HazardKind>([
      ...(s.floodProne ? (['flood'] as HazardKind[]) : []),
      ...(s.subsidenceProne ? (['subsidence'] as HazardKind[]) : []),
      ...(s.hazards ?? []),
    ]),
  ]
  const measures = assessHazards(s)

  const regionLine = input.region
    ? `Регион: ${input.region.name} (${input.region.source === 'auto' ? 'определён по координатам площадки' : 'выбран вручную'}).`
    : 'Регион не выбран; региональные параметры приняты по данным площадки.'
  const hazardsLine =
    hazards.length > 0
      ? `Учтённые риски: ${hazards.map((h) => HAZARD_LABELS[h]).join(', ')}.`
      : 'Риски ЧС для площадки не заявлены.'

  const out: unknown[] = [
    { text: regionLine, margin: [0, 0, 0, 2] },
    { text: `Сейсмичность площадки: ${s.siteIntensityPoints} баллов.`, margin: [0, 0, 0, 2] },
    { text: hazardsLine, margin: [0, 0, 0, 4] },
  ]
  if (measures.length > 0) {
    out.push({ ul: measures.map((m) => HAZARD_MEASURE_TEXT[m.code]), margin: [0, 0, 0, 4] })
  }
  const refs = [
    ...(input.region ? ['region.seismicMap', 'region.freezing'] : []),
    ...new Set(measures.flatMap((m) => m.refs)),
  ]
  if (refs.length > 0) out.push(basisLine(refs))
  return out
}

function buildNodeLabeler(input: ExportInput): (engineId: string) => string {
  const buildingLabelById = new Map(input.buildings.map((b) => [b.id, b.label]))
  const engineToBuilding = new Map(
    input.network.nodes.filter((n) => n.buildingId).map((n) => [n.id, n.buildingId as string]),
  )
  return (engineId: string) => {
    const buildingId = engineToBuilding.get(engineId)
    if (buildingId) return buildingLabelById.get(buildingId) || engineId
    return engineId
  }
}

const KIND_ORDER: Record<string, number> = { supply: 0, ring: 1, cross: 2, service: 3 }
function sortPipes(a: { kind: string; id: string }, b: { kind: string; id: string }): number {
  const ka = KIND_ORDER[a.kind] ?? 9
  const kb = KIND_ORDER[b.kind] ?? 9
  if (ka !== kb) return ka - kb
  return Number(a.id.replace(/\D/g, '') || 0) - Number(b.id.replace(/\D/g, '') || 0)
}
