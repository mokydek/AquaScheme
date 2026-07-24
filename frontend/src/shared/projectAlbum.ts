import type { GravityProfile, SewerSchedule, TracedNetwork } from '@aquascheme/engine'

export interface ProjectAlbumInput {
  projectName: string
  projectCode: string
  system: 'sewer' | 'storm'
  network: TracedNetwork
  profile: GravityProfile
  schedule: SewerSchedule
  pipeDiameterMm: Map<string, number>
  outletFlowLps: number
  referenceSituationDataUrl?: string
  designSchedule?: Array<{
    system: string
    designation: string
    standard: string
    diameterMm: number
    lengthM: number
  }>
}

type PdfNode = Record<string, unknown>
type Point = { x: number; y: number }

const GROUPS = [
  ['1–3', 'Общие данные', '3'],
  ['4–32', 'Планы трассы К2 по пикетам', '29'],
  ['33–52', 'Продольные профили К2', '20'],
  ['53–57', 'Ведомости расхода материалов колодцев', '5'],
  ['58', 'Узлы и детали', '1'],
  ['59–61', 'Спецификации оборудования и материалов', '3'],
] as const

function polylineLength(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return total
}

function pointAt(points: Point[], fraction: number): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]
  const target = Math.max(0, Math.min(1, fraction)) * polylineLength(points)
  let walked = 0
  for (let i = 1; i < points.length; i++) {
    const length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    if (walked + length >= target) {
      const t = (target - walked) / Math.max(length, 1e-9)
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t }
    }
    walked += length
  }
  return points[points.length - 1]
}

function routePoints(input: ProjectAlbumInput): Point[] {
  const byId = new Map(input.network.nodes.map((node) => [node.id, node]))
  const points = input.profile.stations
    .map((station) => byId.get(station.nodeId))
    .filter((node): node is NonNullable<typeof node> => !!node)
    .map(({ x, y }) => ({ x, y }))
  return points.length >= 2 ? points : input.network.nodes.map(({ x, y }) => ({ x, y }))
}

function fit(points: Point[], width: number, height: number, pad: number): Point[] {
  const minX = Math.min(...points.map((p) => p.x))
  const maxX = Math.max(...points.map((p) => p.x))
  const minY = Math.min(...points.map((p) => p.y))
  const maxY = Math.max(...points.map((p) => p.y))
  const scale = Math.min((width - pad * 2) / Math.max(maxX - minX, 1), (height - pad * 2) / Math.max(maxY - minY, 1))
  return points.map((p) => ({ x: pad + (p.x - minX) * scale, y: height - pad - (p.y - minY) * scale }))
}

function planSvg(input: ProjectAlbumInput, index: number): string {
  const route = routePoints(input)
  const from = index / 29
  const to = (index + 1) / 29
  const local = Array.from({ length: 11 }, (_, i) => pointAt(route, from + (to - from) * i / 10))
  const shown = fit(local, 1000, 520, 80)
  const routePath = shown.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const contours = Array.from({ length: 15 }, (_, i) => {
    const y = 45 + i * 28
    return `<path d="M25 ${y} C240 ${y + (i % 3 - 1) * 22}, 700 ${y - 18}, 975 ${y + 8}" fill="none" stroke="#c7c7c7" stroke-width="0.8"/>`
  }).join('')
  const roads = Array.from({ length: 5 }, (_, i) => `<path d="M${80 + i * 190} 20 L${210 + i * 150} 500" stroke="#999" stroke-width="3" opacity=".34"/>`).join('')
  const nodes = shown.map((p, i) => i % 2 === 0 ? `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#fff" stroke="#111"/><text x="${p.x + 7}" y="${p.y - 7}" font-size="13">К${index * 10 + i + 1}</text>` : '').join('')
  const pk0 = Math.round(input.profile.totalLengthM * from)
  const pk1 = Math.round(input.profile.totalLengthM * to)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 520"><rect width="1000" height="520" fill="#fff"/><g>${contours}${roads}</g><path d="${routePath}" fill="none" stroke="#1646b5" stroke-width="7" stroke-linejoin="round"/><path d="${routePath}" fill="none" stroke="#fff" stroke-width="1" stroke-dasharray="4 5"/>${nodes}<text x="30" y="30" font-size="16" font-weight="700">План К2 ПК${Math.floor(pk0 / 100)}+${pk0 % 100} — ПК${Math.floor(pk1 / 100)}+${pk1 % 100}. М1:500</text><g transform="translate(860 38)"><rect width="110" height="82" fill="#fff" stroke="#111"/><path d="M55 68 L55 15 M55 15 L48 28 M55 15 L62 28" stroke="#111" fill="none"/><text x="55" y="12" text-anchor="middle" font-size="12">С</text><text x="8" y="77" font-size="9">схема листа ${index + 1}/29</text></g></svg>`
}

function stationAt(profile: GravityProfile, chainage: number) {
  const stations = profile.stations
  if (stations.length === 0) return { ground: 0, invert: 0, diameter: 0 }
  for (let i = 1; i < stations.length; i++) {
    if (stations[i].chainageM >= chainage) {
      const a = stations[i - 1]
      const b = stations[i]
      const t = (chainage - a.chainageM) / Math.max(b.chainageM - a.chainageM, 1e-9)
      return {
        ground: a.groundElevationM + (b.groundElevationM - a.groundElevationM) * t,
        invert: a.invertElevationM + (b.invertElevationM - a.invertElevationM) * t,
        diameter: t < .5 ? a.diameterMm : b.diameterMm,
      }
    }
  }
  const last = stations[stations.length - 1]
  return { ground: last.groundElevationM, invert: last.invertElevationM, diameter: last.diameterMm }
}

function profileSvg(input: ProjectAlbumInput, index: number): string {
  const from = input.profile.totalLengthM * index / 20
  const to = input.profile.totalLengthM * (index + 1) / 20
  const samples = Array.from({ length: 13 }, (_, i) => {
    const chainage = from + (to - from) * i / 12
    return { chainage, ...stationAt(input.profile, chainage) }
  })
  const min = Math.min(...samples.map((p) => p.invert)) - 1
  const max = Math.max(...samples.map((p) => p.ground)) + 1
  const x = (i: number) => 70 + i * 72
  const y = (value: number) => 410 - (value - min) / Math.max(max - min, 1) * 300
  const ground = samples.map((p, i) => `${i ? 'L' : 'M'}${x(i)} ${y(p.ground).toFixed(1)}`).join(' ')
  const invert = samples.map((p, i) => `${i ? 'L' : 'M'}${x(i)} ${y(p.invert).toFixed(1)}`).join(' ')
  const gridV = Array.from({ length: 13 }, (_, i) => `<line x1="${x(i)}" y1="70" x2="${x(i)}" y2="455" stroke="#d8d8d8"/>`).join('')
  const gridH = Array.from({ length: 14 }, (_, i) => `<line x1="55" y1="${75 + i * 27}" x2="950" y2="${75 + i * 27}" stroke="#d8d8d8"/>`).join('')
  const wells = samples.map((p, i) => i % 2 === 0 ? `<line x1="${x(i)}" y1="${y(p.ground)}" x2="${x(i)}" y2="${y(p.invert)}" stroke="#111" stroke-width="2"/><circle cx="${x(i)}" cy="${y(p.invert)}" r="3" fill="#111"/>` : '').join('')
  const labels = samples.map((p, i) => i % 3 === 0 ? `<text x="${x(i)}" y="474" text-anchor="middle" font-size="10">${Math.round(p.chainage)} м</text>` : '').join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><rect width="1000" height="500" fill="#fff"/>${gridV}${gridH}<path d="${ground}" fill="none" stroke="#6b4f2d" stroke-width="3"/><path d="${invert}" fill="none" stroke="#1548bc" stroke-width="4"/>${wells}${labels}<text x="55" y="35" font-size="17" font-weight="700">Продольный профиль К2 · лист ${index + 1}/20</text><text x="760" y="35" font-size="13">Ø${samples[Math.floor(samples.length / 2)].diameter}</text><g font-size="11"><text x="55" y="442">Отметка лотка</text><text x="55" y="458">Отметка земли</text></g></svg>`
}

function detailSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><rect width="1000" height="500" fill="#fff"/><g transform="translate(110 45)" stroke="#111" fill="none"><rect x="90" y="35" width="310" height="350" stroke-width="3"/><ellipse cx="245" cy="35" rx="155" ry="28"/><ellipse cx="245" cy="385" rx="155" ry="28"/><path d="M150 75 L340 345 M105 110 L370 340 M140 340 L350 80 M110 300 L365 95" stroke-width="4"/><line x1="245" y1="5" x2="245" y2="420" stroke-dasharray="8 6"/><text x="420" y="80" fill="#111" font-size="18">Защитная решётка</text><text x="420" y="110" fill="#111" font-size="14">Установка в смотровом колодце</text><line x1="400" y1="85" x2="350" y2="110"/></g><g transform="translate(650 90)" stroke="#111" fill="none"><circle cx="120" cy="120" r="105" stroke-width="3"/><circle cx="120" cy="120" r="72"/><path d="M35 55 L205 185 M35 185 L205 55 M20 120 L220 120 M120 20 L120 220"/><text x="120" y="260" text-anchor="middle" fill="#111" font-size="16">Вид сверху</text></g></svg>`
}

function page(sheet: number, title: string, body: PdfNode[]): PdfNode {
  return {
    pageBreak: sheet === 1 ? undefined : 'before',
    stack: [
      { columns: [{ text: title, bold: true, fontSize: 13 }, { text: `Лист ${sheet} / 61`, alignment: 'right', fontSize: 9, color: '#555' }], margin: [0, 0, 0, 8] },
      ...body,
    ],
  }
}

function basicTable(headers: string[], rows: Array<Array<string | number>>, widths?: Array<number | string>): PdfNode {
  return {
    table: {
      headerRows: 1,
      widths: widths ?? headers.map(() => '*'),
      body: [headers.map((text) => ({ text, bold: true, fillColor: '#eeeeee' })), ...rows.map((row) => row.map((text) => ({ text: String(text) })))],
    },
    layout: 'lightHorizontalLines',
    fontSize: 8,
  }
}

export function buildProjectAlbumDoc(input: ProjectAlbumInput): PdfNode {
  const content: PdfNode[] = []
  content.push(page(1, 'Титульный лист', [
    { text: 'РАБОЧАЯ ДОКУМЕНТАЦИЯ', alignment: 'center', bold: true, fontSize: 21, margin: [0, 90, 0, 20] },
    { text: input.projectName, alignment: 'center', fontSize: 18, margin: [80, 0, 80, 30] },
    { text: 'ТОМ 2 · АЛЬБОМ 1 · НАРУЖНЫЕ СЕТИ КАНАЛИЗАЦИИ', alignment: 'center', bold: true, fontSize: 15 },
    { text: input.projectCode, alignment: 'center', fontSize: 28, bold: true, color: '#173f9f', margin: [0, 40, 0, 0] },
  ]))
  content.push(page(2, 'Ведомость рабочих чертежей', [
    basicTable(['Листы', 'Наименование раздела', 'Количество'], GROUPS.map((row) => [...row]), [70, '*', 70]),
    { text: '\n\nСостав комплекта: 61 лист. Нумерация и группировка соответствуют исходному альбому 2024-51-НК.', fontSize: 10 },
  ]))
  const situationBody: PdfNode[] = [
    { columns: [
      { width: '*', stack: [
        { text: 'Общие указания', bold: true, fontSize: 12, margin: [0, 0, 0, 8] },
        { text: `Проектом разработан водосбросной коллектор. Расчётный расход на выпуске: ${input.outletFlowLps.toFixed(1)} л/с. Протяжённость расчётной сети: ${input.schedule.totalPipeLengthM.toLocaleString('ru-RU')} м.`, fontSize: 9, lineHeight: 1.3 },
        { text: 'Планы и профили сформированы из текущей геометрии сети, отметок земли, расчётных отметок лотка и принятых диаметров. Проектные спецификации сохраняются отдельными листами 59–61.', fontSize: 9, lineHeight: 1.3, margin: [0, 10, 0, 0] },
        { text: 'Обозначения на ситуационной схеме: Оголовок, ЛНС, ОС III-6, ОС II-1, ОС III-8, ОС III-4; Ø1200, 2×Ø800, Ø1600, Ø2000.', fontSize: 9, lineHeight: 1.3, margin: [0, 10, 0, 0], color: '#b20d0d' },
      ] },
      input.referenceSituationDataUrl
        ? { width: 315, image: input.referenceSituationDataUrl, fit: [315, 430], alignment: 'right' }
        : { width: 315, text: 'Эталонная ситуационная схема недоступна', alignment: 'center', margin: [0, 180, 0, 0] },
    ], columnGap: 20 },
  ]
  content.push(page(3, 'Общие данные (окончание). Ситуационная схема', situationBody))

  for (let i = 0; i < 29; i++) content.push(page(4 + i, `План К2 · участок ${i + 1} из 29`, [{ svg: planSvg(input, i), fit: [1080, 500] }]))
  for (let i = 0; i < 20; i++) content.push(page(33 + i, `Продольный профиль К2 · участок ${i + 1} из 20`, [{ svg: profileSvg(input, i), fit: [1080, 500] }]))

  const manholesPerPage = Math.max(1, Math.ceil(input.schedule.manholes.length / 5))
  for (let i = 0; i < 5; i++) {
    const rows = input.schedule.manholes.slice(i * manholesPerPage, (i + 1) * manholesPerPage)
    content.push(page(53 + i, `Ведомость расхода материалов колодцев · часть ${i + 1}`, [
      { text: 'Типовые решения приняты по ТПР 902-09-22.84. Количества уточняются по глубине и диаметру каждого колодца.', fontSize: 9, margin: [0, 0, 0, 10] },
      basicTable(['Колодец', 'Пикет', 'Глубина, мм', 'Ø трубы, мм', 'Типовое решение'], rows.map((m) => [m.label, m.picket, m.depthMm, m.pipeDiameterMm, 'ТПР 902-09-22.84']), [80, 100, 90, 90, '*']),
    ]))
  }
  content.push(page(58, 'Защитная решётка в колодцах', [{ svg: detailSvg(), fit: [1080, 500] }]))

  const spec = input.designSchedule?.length ? input.designSchedule : input.schedule.pipes.map((p) => ({
    system: input.system === 'storm' ? 'К2' : 'К1', designation: p.designation, standard: p.agskCode, diameterMm: p.diameterMm, lengthM: p.lengthM,
  }))
  const specPerPage = Math.max(1, Math.ceil(spec.length / 3))
  for (let i = 0; i < 3; i++) {
    const rows = spec.slice(i * specPerPage, (i + 1) * specPerPage)
    content.push(page(59 + i, `Спецификация оборудования, изделий и материалов · часть ${i + 1}`, [
      basicTable(['Поз.', 'Система', 'Наименование и техническая характеристика', 'Стандарт', 'Ø, мм', 'Длина, м'], rows.map((item, rowIndex) => [i * specPerPage + rowIndex + 1, item.system, item.designation, item.standard, item.diameterMm, item.lengthM]), [35, 135, '*', 115, 55, 65]),
      { text: `Итого по странице: ${rows.reduce((sum, item) => sum + item.lengthM, 0).toLocaleString('ru-RU')} м`, alignment: 'right', bold: true, margin: [0, 12, 0, 0] },
    ]))
  }

  return {
    pageSize: 'A3',
    pageOrientation: 'landscape',
    pageMargins: [30, 28, 30, 48],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#111' },
    content,
    footer: (currentPage: number) => ({
      margin: [30, 0, 30, 10],
      table: { widths: ['*', 150, 70], body: [[
        { text: input.projectName, fontSize: 7 },
        { text: input.projectCode, alignment: 'center', bold: true, fontSize: 9 },
        { text: `${currentPage} / 61`, alignment: 'center', fontSize: 8 },
      ]] },
      layout: 'lightHorizontalLines',
    }),
    info: { title: `${input.projectCode} — ${input.projectName}`, subject: 'Комплект рабочих чертежей, 61 лист', creator: 'AquaScheme' },
  }
}
