import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  GravityProfile,
  RouteConstraintInput,
  SelectedManholeConstruction,
  SewerSchedule,
  SurveyPoint,
  TracedNetwork,
  WorkingDrawingSet,
  WorkingDrawingSheet,
} from '@aquascheme/engine'
import { PLAN_LINE_STYLE } from '../../shared/planStyles'
import { planSourceLines } from '../../shared/planLayerRole'
import { buildPlanSheetScene, formatPlanPicket as picket } from '../../shared/planScene'
import type { PlanPipeDesign } from '../../shared/planScene'

/** Заголовки граф боковика профиля. Состав постоянный, поэтому вынесен из тела. */
const PROFILE_ROWS = [
  'Отметка лотка, м',
  'Отметка земли, м',
  'Диаметр, мм',
  'Уклон / длина',
  'Расстояние, м',
  'Колодец / ПК',
]

function statusText(status: WorkingDrawingSheet['status']): string {
  return {
    BLOCKED: 'ВЫПУСК ЗАБЛОКИРОВАН',
    PRELIMINARY: 'ПРЕДВАРИТЕЛЬНО',
    CALCULATED: 'ЧЕРНОВИК · РАССЧИТАНО',
    VERIFIED: 'ПРОВЕРЕНО',
    STALE: 'ТРЕБУЕТ ПЕРЕСЧЁТА',
  }[status]
}

function DrawingFrame({ sheet, children, showFrame = true }: { sheet: WorkingDrawingSheet; children: ReactNode; showFrame?: boolean }) {
  const { t } = useTranslation()
  return (
    <svg className="working-drawing-preview" viewBox="0 0 1180 820" role="img" aria-label={`Предпросмотр: ${sheet.title}`}>
      <rect width="1180" height="820" fill="#fff" />
      {showFrame && <>
        <rect x="18" y="18" width="1144" height="784" fill="none" stroke="#111" strokeWidth="1.5" />
        <rect x="790" y="700" width="372" height="102" fill="#fff" stroke="#111" />
        <line x1="790" y1="736" x2="1162" y2="736" stroke="#111" />
        <line x1="1020" y1="700" x2="1020" y2="802" stroke="#111" />
        <line x1="1090" y1="700" x2="1090" y2="802" stroke="#111" />
        <text x="804" y="721" fontSize="12">{t('project.preview.sewerNetworks')}</text>
        <text x="804" y="756" fontSize="12" fontWeight="700">{sheet.title}</text>
        <text x="1055" y="721" textAnchor="middle" fontSize="10">{sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}</text>
        <text x="1055" y="764" textAnchor="middle" fontSize="18">{sheet.sheetNumber}</text>
        <text x="1126" y="721" textAnchor="middle" fontSize="10">{t('project.preview.status')}</text>
        <text x="1126" y="758" textAnchor="middle" fontSize="9">{sheet.status}</text>
      </>}
      {children}
      {/*
        Отметка статуса вынесена под поле чертежа и не повёрнута. Наискось через
        середину она перекрывала 25 % площади графика — 6067 точек краски внутри
        поля, 18 из них в пределах точки от линии лотка, — то есть мешала читать
        ровно то, ради чего лист и смотрят. Предупреждение обязано быть видным,
        но не поверх линий.
      */}
      {sheet.status !== 'VERIFIED' && (
        <text
          x="590"
          y="712"
          textAnchor="middle"
          fontSize="15"
          fontWeight="700"
          letterSpacing="2"
          fill={sheet.status === 'BLOCKED' || sheet.status === 'STALE' ? '#b42318' : '#8a5a00'}
          opacity="0.75"
        >
          {statusText(sheet.status)}
        </text>
      )}
    </svg>
  )
}

function CadContextLayer({
  constraints,
  x,
  y,
  bounds,
}: {
  constraints?: RouteConstraintInput | null
  x: (value: number) => number
  y: (value: number) => number
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}) {
  const intersectsBounds = (points: Array<{ x: number; y: number }>) => {
    if (points.length === 0) return false
    const minX = Math.min(...points.map((point) => point.x))
    const maxX = Math.max(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y))
    const maxY = Math.max(...points.map((point) => point.y))
    return maxX >= bounds.minX && minX <= bounds.maxX && maxY >= bounds.minY && minY <= bounds.maxY
  }
  const sample = <T,>(items: T[], maximum: number): T[] => {
    if (items.length <= maximum) return items
    const stride = Math.ceil(items.length / maximum)
    return items.filter((_, index) => index % stride === 0)
  }
  /**
   * Предпросмотр показывает ТЕ ЖЕ РОЛИ, что и лист.
   *
   * Здесь был свой словарь цветов: вся подоснова серым #c7c7c7, рельеф зелёным
   * #78906d. Ни того, ни другого на листе нет, и инженер принимал решение по
   * серой каше, а получал цветной чертёж. Источник линий теперь общий с листом
   * (`planSourceLines`), цвета и относительные толщины — из измеренной таблицы.
   *
   * Предпросмотр не имеет масштаба бумаги: он вписан в окно. Множитель ниже
   * переводит миллиметры бумаги в единицы холста так, чтобы самая тонкая линия
   * (0,127 мм) осталась видимой на экране; ОТНОШЕНИЯ толщин при этом
   * сохраняются, а именно они и различают роли.
   */
  const PREVIEW_UNITS_PER_MM = 4
  const contextLines = sample(
    planSourceLines(constraints ?? null).lines.filter((line) => intersectsBounds(line.points)),
    3500,
  )
  const blocks = sample((constraints?.cadBlockEntities ?? []).filter((block) =>
    block.x >= bounds.minX && block.x <= bounds.maxX && block.y >= bounds.minY && block.y <= bounds.maxY), 500)
  const labels = sample((constraints?.cadTextEntities ?? []).filter((label) =>
    label.x >= bounds.minX && label.x <= bounds.maxX && label.y >= bounds.minY && label.y <= bounds.maxY), 900)
  const linePoints = (points: Array<{ x: number; y: number }>) => points
    .map((point) => `${x(point.x)},${y(point.y)}`)
    .join(' ')
  return <>
    {contextLines.map((line, index) => {
      const style = PLAN_LINE_STYLE[line.role]
      return <polyline
        key={`cad-${line.role}-${index}`}
        data-plan-role={line.role}
        points={linePoints(line.points)}
        fill="none"
        stroke={style.colour}
        strokeWidth={style.widthMm * PREVIEW_UNITS_PER_MM}
        strokeDasharray={style.dashMm
          ? `${style.dashMm[0] * PREVIEW_UNITS_PER_MM} ${style.dashMm[1] * PREVIEW_UNITS_PER_MM}`
          : undefined}
      />
    })}
    {blocks.map((block, index) => {
      const bx = x(block.x)
      const by = y(block.y)
      return <g key={`block-${block.sourceHandle ?? index}`}>
        <path d={`M${bx - 3} ${by}H${bx + 3}M${bx} ${by - 3}V${by + 3}`} stroke="#555" strokeWidth="0.8" />
        <text x={bx + 4} y={by - 3} fontSize="6.5" fill="#555">{block.name}</text>
      </g>
    })}
    {labels.map((label, index) => {
      const tx = x(label.x)
      const ty = y(label.y)
      return <text
        key={`text-${label.sourceHandle ?? index}`}
        x={tx}
        y={ty}
        fontSize="7"
        fill="#555"
        transform={label.rotationDeg ? `rotate(${-label.rotationDeg} ${tx} ${ty})` : undefined}
      >{label.text.replaceAll('\\P', ' ')}</text>
    })}
  </>
}

function PlanPreview({
  sheet,
  drawingSet,
  network,
  schedule,
  pipeDiameterMm,
  pipeDesign,
  buildingLabels,
  surveyPoints,
  showTopography,
  showFrame,
  constraints,
}: {
  sheet: WorkingDrawingSheet
  drawingSet: WorkingDrawingSet
  network: TracedNetwork
  schedule: SewerSchedule | null
  pipeDiameterMm: Map<string, number>
  pipeDesign?: Map<string, PlanPipeDesign>
  buildingLabels?: Map<string, string>
  surveyPoints: SurveyPoint[]
  showTopography: boolean
  showFrame: boolean
  constraints?: RouteConstraintInput | null
}) {
  const { t } = useTranslation()
  const window = sheet.window
  if (!window) {
    return <DrawingFrame sheet={sheet} showFrame={showFrame}><text x="60" y="90" fontSize="20">{t('project.preview.noPlanGeometry')}</text></DrawingFrame>
  }
  const topo = surveyPoints.filter((point) =>
    point.x >= window.minX && point.x <= window.maxX && point.y >= window.minY && point.y <= window.maxY)
  const scene = buildPlanSheetScene({
    sheet,
    drawingSet,
    network,
    schedule,
    pipeDiameterMm,
    pipeDesign,
    buildingLabels,
    constraints,
    surveyPointCountInWindow: topo.length,
  })
  if (!scene) {
    return <DrawingFrame sheet={sheet} showFrame={showFrame}><text x="60" y="90" fontSize="20">{t('project.preview.noPlanGeometry')}</text></DrawingFrame>
  }
  const sourcePath = scene.sourcePath
  const path = scene.selectedPath
  const width = Math.max(window.maxX - window.minX, 1)
  const height = Math.max(window.maxY - window.minY, 1)
  const content = { x: 55, y: 70, width: 1080, height: 590 }
  const scale = Math.min(content.width / width, content.height / height)
  const x = (value: number) => content.x + (value - window.minX) * scale
  const y = (value: number) => content.y + content.height - (value - window.minY) * scale
  const route = path.map((point) => `${x(point.x)},${y(point.y)}`).join(' ')
  const stride = Math.max(1, Math.ceil(topo.length / 450))
  const overview = sourcePath
  const minX = Math.min(...overview.map((point) => point.x))
  const maxX = Math.max(...overview.map((point) => point.x))
  const minY = Math.min(...overview.map((point) => point.y))
  const maxY = Math.max(...overview.map((point) => point.y))
  const overviewScale = Math.min(150 / Math.max(maxX - minX, 1), 88 / Math.max(maxY - minY, 1))
  const ox = (value: number) => 955 + (value - minX) * overviewScale
  const oy = (value: number) => 45 + 88 - (value - minY) * overviewScale
  const linePoints = (points: Array<{ x: number; y: number }>) => points.map((point) => `${x(point.x)},${y(point.y)}`).join(' ')

  /**
   * Раскладка подписей: место выбирается свободное, а не по чётности номера.
   *
   * Прежнее правило ставило колодцы через один вправо-влево без всякой проверки
   * занятости. На реальном объекте это давало 44 пересекающиеся пары: 41 %
   * площади подписей закрывалось соседями, ВК-10 исчезал с листа целиком, а у
   * ВК-12 рамка соседа съедала первую букву — читалось «К-12».
   *
   * Кандидаты перебираются по восьми направлениям от точки; берётся первое
   * место, свободное от уже занятых. Если свободного нет — подпись всё равно
   * ставится в первом кандидате: спрятать номер колодца хуже, чем наложить.
   */
  const placed: Array<{ x: number; y: number; w: number; h: number }> = []
  const overlaps = (box: { x: number; y: number; w: number; h: number }) =>
    placed.some((other) => box.x < other.x + other.w && box.x + box.w > other.x
      && box.y < other.y + other.h && box.y + box.h > other.y)
  const placeLabel = (cx: number, cy: number, w: number, h: number) => {
    const offsets: Array<[number, number]> = [
      [10, -22], [-w - 10, -22], [10, 8], [-w - 10, 8],
      [10, -40], [-w - 10, -40], [10, 26], [-w - 10, 26],
    ]
    for (const [dx, dy] of offsets) {
      const box = { x: cx + dx, y: cy + dy, w, h }
      if (!overlaps(box)) { placed.push(box); return box }
    }
    const fallback = { x: cx + offsets[0][0], y: cy + offsets[0][1], w, h }
    placed.push(fallback)
    return fallback
  }

  // Подпись помещается, если её ширина не больше длины участка на листе.
  const pipeOnSheetLength = (pipe: typeof scene.pipes[number]) => {
    const points = pipe.fragments.flat()
    if (points.length < 2) return 0
    const first = points[0]
    const last = points[points.length - 1]
    return Math.hypot(x(last.x) - x(first.x), y(last.y) - y(first.y))
  }
  /**
   * Подпись участка ступенчатая: полная, если помещается; иначе один диаметр;
   * иначе ничего. Строгое правило «или полностью, или никак» на этом объекте
   * снимало все 13 подписей разом — самый длинный участок 69 м даёт на листе
   * 108 точек против 130 у полной подписи, — и план оставался без диаметров.
   * Уклон и длина при этом не пропадают: они в боковике профиля.
   */
  const CHAR_WIDTH = 5.2
  const shownPipeLabels = scene.pipes.map((pipe) => {
    const available = pipeOnSheetLength(pipe)
    if (available >= Math.max(52, pipe.label.length * CHAR_WIDTH)) return { pipe, text: pipe.label }
    const short = pipe.diameterMm ? `Ø${pipe.diameterMm}` : null
    if (short && available >= short.length * CHAR_WIDTH + 6) return { pipe, text: short }
    return { pipe, text: null }
  }).filter((item): item is { pipe: typeof scene.pipes[number]; text: string } => item.text !== null)
  const shortened = shownPipeLabels.filter((item) => item.text !== item.pipe.label).length
  const hiddenPipeLabels = scene.pipes.length - shownPipeLabels.length
  return (
    <DrawingFrame sheet={sheet} showFrame={showFrame}>
      <defs><clipPath id={`clip-${sheet.id}`}><rect x={content.x} y={content.y} width={content.width} height={content.height} /></clipPath></defs>
      <text x="55" y="48" fontSize="17" fontWeight="700">{sheet.title}</text>
      <g clipPath={`url(#clip-${sheet.id})`}>
        <CadContextLayer constraints={constraints} x={x} y={y} bounds={window} />
        {(constraints?.hardObstacleRings ?? []).map((ring, index) => <polygon key={`building-${index}`} points={linePoints(ring)} fill="#d7d7d7" stroke="#555" />)}
        {(constraints?.buildingPolygons ?? []).map((ring, index) => <polygon key={`building-polygon-${index}`} points={linePoints(ring)} fill="#d7d7d7" stroke="#555" />)}
        {(constraints?.parcelRings ?? []).map((ring, index) => <polygon key={`parcel-${index}`} points={linePoints(ring)} fill="none" stroke="#777" strokeDasharray="4 3" />)}
        {(constraints?.forbiddenRings ?? []).map((ring, index) => <polygon key={`forbidden-${index}`} points={linePoints(ring)} fill="#f6d7d7" fillOpacity="0.5" stroke="#b42318" />)}
        {[...(constraints?.protectionZoneRings ?? []), ...(constraints?.protectionZones ?? [])].map((ring, index) => <polygon key={`protection-${index}`} points={linePoints(ring)} fill="#fff1d6" fillOpacity="0.35" stroke="#c07800" strokeDasharray="8 5" />)}
        {[...(constraints?.approvedCrossingRings ?? []), ...(constraints?.approvedCrossingZones ?? [])].map((ring, index) => <polygon key={`approved-crossing-${index}`} points={linePoints(ring)} fill="#dff5e7" fillOpacity="0.4" stroke="#168047" strokeDasharray="6 4" />)}
        {(constraints?.waterRings ?? []).map((ring, index) => <polygon key={`water-ring-${index}`} points={linePoints(ring)} fill="#d8f1f8" stroke="#2685b5" />)}
        {(constraints?.corridorRings ?? []).map((ring, index) => <polygon key={`corridor-${index}`} points={linePoints(ring)} fill="none" stroke="#d33232" strokeWidth="1.5" strokeDasharray="8 5" />)}
        {(constraints?.roadLines ?? []).map((line, index) => <polyline key={`road-${index}`} points={linePoints(line.points)} fill="none" stroke="#8b734f" strokeWidth="3" />)}
        {(constraints?.waterLines ?? []).map((line, index) => <polyline key={`water-${index}`} points={linePoints(line.points)} fill="none" stroke="#2685b5" strokeWidth="2" />)}
        {(constraints?.utilityLines ?? []).map((line, index) => <polyline key={`utility-${index}`} points={linePoints(line.points)} fill="none" stroke="#9b2c8c" strokeWidth="1.5" strokeDasharray="6 4" />)}
        {(constraints?.redLines ?? []).map((line, index) => <polyline key={`red-${index}`} points={linePoints(line.points)} fill="none" stroke="#d22" strokeWidth="2" />)}
        {(constraints?.guideLines ?? []).map((line, index) => <polyline key={`guide-${index}`} points={linePoints(line.points)} fill="none" stroke="#168047" strokeWidth="1.5" strokeDasharray="8 4" />)}
        {(constraints?.hardObstacles ?? []).map((line, index) => <polyline key={`hard-obstacle-${index}`} points={linePoints(line.points)} fill="none" stroke="#333" strokeWidth="2" />)}
        {showTopography && topo.filter((_, index) => index % stride === 0).map((point, index) => (
          <g key={`${point.x}-${point.y}-${index}`}>
            <circle cx={x(point.x)} cy={y(point.y)} r="1" fill="#777" />
            {index % 12 === 0 && <text x={x(point.x) + 3} y={y(point.y) - 3} fontSize="7" fill="#777">{point.z.toFixed(2)}</text>}
          </g>
        ))}
        {scene.pipes.flatMap((pipe) => pipe.fragments.map((fragment, index) => (
          <polyline
            key={`${pipe.pipeId}-${index}`}
            data-plan-pipe={pipe.pipeId}
            points={linePoints(fragment)}
            fill="none"
            stroke={pipe.active ? '#1746b5' : '#4776bd'}
            strokeWidth={pipe.active ? 3.5 : 1.7}
            strokeLinejoin="round"
          />
        )))}
        <polyline points={route} fill="none" stroke="#1746b5" strokeWidth="5" strokeLinejoin="round" />
        {/*
          Пикеты кладутся тем же раскладчиком, что и колодцы. Раньше они
          ставились в x+8, y−8 без всякой проверки, и рамки колодцев их резали:
          от «ПК4+6.36» оставалось «36», от «ПК2+84.06» — «.06».
        */}
        {scene.stations.map((station) => {
          const box = placeLabel(x(station.x), y(station.y), Math.max(34, station.label.length * 5.6), 13)
          return (
          <g key={`station-${station.chainageM}`} data-plan-station={station.chainageM}>
            {station.boundary && <line x1={x(station.x)} y1={content.y} x2={x(station.x)} y2={content.y + content.height} stroke="#d33" strokeDasharray="8 6" />}
            <line x1={x(station.x)} y1={y(station.y) - 7} x2={x(station.x)} y2={y(station.y) + 7} stroke="#111" />
            <circle cx={x(station.x)} cy={y(station.y)} r={station.boundary ? 5 : 3} fill="#fff" stroke="#1746b5" strokeWidth="2" />
            <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="#fff" fillOpacity="0.85" stroke="none" />
            <text x={box.x + 2} y={box.y + 10} fontSize="9" fontWeight="700">{station.label}</text>
          </g>
          )
        })}
        {scene.nodes.map((node) => {
          const labelWidth = Math.max(32, node.label.length * 6)
          const box = placeLabel(x(node.x), y(node.y), labelWidth, 16)
          return <g key={node.id} data-plan-node={node.id}>
            {node.kind === 'source'
              ? <rect x={x(node.x) - 5} y={y(node.y) - 5} width="10" height="10" fill="#fff" stroke="#1746b5" strokeWidth="2" />
              : <circle cx={x(node.x)} cy={y(node.y)} r="5" fill="#fff" stroke="#1746b5" strokeWidth="2" />}
            <line x1={x(node.x)} y1={y(node.y)} x2={box.x + box.w / 2} y2={box.y + box.h} stroke="#333" strokeWidth="0.7" />
            <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="#fff" stroke="#555" />
            <text x={box.x + 4} y={box.y + 11} fontSize="9">{node.label}</text>
          </g>
        })}
        {/*
          Подпись участка ставится только там, где она короче самого участка.
          Замер на реальном объекте: «Ø450 · i=13.14‰ · L=26.6 м» — это 130
          точек, а участок P-6 длиной 13,4 м занимает на листе 21 точку, то есть
          подпись в шесть раз длиннее того, что подписывает. При 1:500 она
          покрывает 83 м местности. Раскладкой это не лечится: 41 % площади
          подписей закрывалось соседями, ВК-10 исчезал с листа целиком, а ВК-12
          читался как «К-12».
          Пропущенные величины не теряются: диаметр, уклон и длина каждого
          участка стоят в боковике продольного профиля. Число пропущенных
          подписей выводится под чертежом — молча ничего не исчезает.
        */}
        {shownPipeLabels.map(({ pipe, text }) => {
          const px = x(pipe.labelPoint.x)
          const py = y(pipe.labelPoint.y) - 10
          const labelWidth = Math.max(26, text.length * CHAR_WIDTH + 6)
          return <g key={`label-${pipe.pipeId}`} data-plan-pipe-label={pipe.pipeId} transform={`translate(${px} ${py}) rotate(${-pipe.labelAngleDeg})`}>
            <rect x="-3" y="-11" width={labelWidth} height="15" fill="#fff" stroke="#1746b5" />
            <text x="1" y="0" fontSize="8.5" fill="#1746b5">{text}</text>
          </g>
        })}
      </g>
      <rect x={content.x} y={content.y} width={content.width} height={content.height} fill="none" stroke="#222" />
      {!scene.hasPlanContext && <g data-plan-context-missing="true">
        <rect x="370" y="76" width="440" height="40" fill="#fff4dc" stroke="#c07800" strokeWidth="1.5" />
        <text x="590" y="92" textAnchor="middle" fontSize="11" fontWeight="700" fill="#8a4c00">{t('project.preview.incompletePlan')}</text>
        <text x="590" y="107" textAnchor="middle" fontSize="9" fill="#8a4c00">{t('project.preview.incompletePlanHint')}</text>
      </g>}
      <g>
        <rect x="940" y="32" width="185" height="112" fill="#fff" stroke="#222" />
        <polyline points={overview.map((point) => `${ox(point.x)},${oy(point.y)}`).join(' ')} fill="none" stroke="#999" strokeWidth="1.5" />
        <polyline points={path.map((point) => `${ox(point.x)},${oy(point.y)}`).join(' ')} fill="none" stroke="#1746b5" strokeWidth="4" />
        <text x="947" y="140" fontSize="8">{t('project.preview.sheetPosition')}</text>
      </g>
      <g transform="translate(78 105)">
        <line x1="0" y1="28" x2="0" y2="0" stroke="#111" />
        <path d="M0 0 L-5 10 M0 0 L5 10" stroke="#111" fill="none" />
        <text x="0" y="-5" textAnchor="middle" fontSize="10">С</text>
      </g>
      <g transform="translate(62 610)" fontSize="8">
        <rect x="0" y="0" width="300" height="45" fill="#fff" stroke="#aaa" />
        <line x1="10" y1="12" x2="38" y2="12" stroke="#1746b5" strokeWidth="4" /><text x="45" y="15">{t('project.preview.legendAxis')}</text>
        <line x1="120" y1="12" x2="148" y2="12" stroke="#9b2c8c" strokeDasharray="6 4" /><text x="155" y="15">{t('project.preview.legendUtilities')}</text>
        <line x1="10" y1="31" x2="38" y2="31" stroke="#d22" /><text x="45" y="34">{t('project.preview.legendRedLines')}</text>
      </g>
      {/*
        Пояснение под чертежом разбито на две строки: одной оно дотягивалось до
        середины листа и налезало на отметку статуса.
      */}
      <text x="55" y="676" fontSize="9">
        В окне: {scene.contextFeatureCount} объектов подосновы, {topo.length} высотных отметок, {scene.pipes.length} участков сети, {scene.nodes.length} сооружений.
      </text>
      {(shortened > 0 || hiddenPipeLabels > 0) && (
        <text x="55" y="688" fontSize="9">
          {shortened > 0 && `Подписей сокращено до диаметра: ${shortened} — уклон и длина в боковике профиля.`}
          {hiddenPipeLabels > 0 && ` Не поместилось совсем: ${hiddenPipeLabels} из ${scene.pipes.length}.`}
        </text>
      )}
    </DrawingFrame>
  )
}

function NetworkPlanPreview({
  sheet,
  drawingSet,
  surveyPoints,
  showTopography,
  showFrame,
  constraints,
}: {
  sheet: WorkingDrawingSheet
  drawingSet: WorkingDrawingSet
  surveyPoints: SurveyPoint[]
  showTopography: boolean
  showFrame: boolean
  constraints?: RouteConstraintInput | null
}) {
  const { t } = useTranslation()
  const networkPoints = drawingSet.networkPaths.flatMap((path) => path.points)
  if (networkPoints.length < 2) {
    return <DrawingFrame sheet={sheet} showFrame={showFrame}><text x="60" y="90" fontSize="20">{t('project.preview.noNetworkGeometry')}</text></DrawingFrame>
  }
  const rawMinX = Math.min(...networkPoints.map((point) => point.x))
  const rawMaxX = Math.max(...networkPoints.map((point) => point.x))
  const rawMinY = Math.min(...networkPoints.map((point) => point.y))
  const rawMaxY = Math.max(...networkPoints.map((point) => point.y))
  const margin = Math.max(Math.max(rawMaxX - rawMinX, rawMaxY - rawMinY) * 0.04, 60)
  const minX = rawMinX - margin
  const maxX = rawMaxX + margin
  const minY = rawMinY - margin
  const maxY = rawMaxY + margin
  const content = { x: 55, y: 70, width: 1080, height: 590 }
  const scale = Math.min(content.width / Math.max(maxX - minX, 1), content.height / Math.max(maxY - minY, 1))
  const x = (value: number) => content.x + (value - minX) * scale
  const y = (value: number) => content.y + content.height - (value - minY) * scale
  const linePoints = (points: Array<{ x: number; y: number }>) => points.map((point) => `${x(point.x)},${y(point.y)}`).join(' ')
  const topo = surveyPoints.filter((point) => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY)
  const stride = Math.max(1, Math.ceil(topo.length / 450))
  return (
    <DrawingFrame sheet={sheet} showFrame={showFrame}>
      <defs><clipPath id={`clip-${sheet.id}`}><rect x={content.x} y={content.y} width={content.width} height={content.height} /></clipPath></defs>
      <text x="55" y="48" fontSize="17" fontWeight="700">{sheet.title}</text>
      <g clipPath={`url(#clip-${sheet.id})`}>
        <CadContextLayer constraints={constraints} x={x} y={y} bounds={{ minX, maxX, minY, maxY }} />
        {(constraints?.hardObstacleRings ?? []).map((ring, index) => <polygon key={`building-${index}`} points={linePoints(ring)} fill="#d7d7d7" stroke="#555" />)}
        {(constraints?.waterRings ?? []).map((ring, index) => <polygon key={`water-ring-${index}`} points={linePoints(ring)} fill="#d8f1f8" stroke="#2685b5" />)}
        {(constraints?.corridorRings ?? []).map((ring, index) => <polygon key={`corridor-${index}`} points={linePoints(ring)} fill="none" stroke="#d33232" strokeWidth="1.5" strokeDasharray="8 5" />)}
        {(constraints?.roadLines ?? []).map((line, index) => <polyline key={`road-${index}`} points={linePoints(line.points)} fill="none" stroke="#8b734f" strokeWidth="3" />)}
        {(constraints?.waterLines ?? []).map((line, index) => <polyline key={`water-${index}`} points={linePoints(line.points)} fill="none" stroke="#2685b5" strokeWidth="2" />)}
        {(constraints?.utilityLines ?? []).map((line, index) => <polyline key={`utility-${index}`} points={linePoints(line.points)} fill="none" stroke="#9b2c8c" strokeWidth="1.5" strokeDasharray="6 4" />)}
        {(constraints?.redLines ?? []).map((line, index) => <polyline key={`red-${index}`} points={linePoints(line.points)} fill="none" stroke="#d22" strokeWidth="2" />)}
        {showTopography && topo.filter((_, index) => index % stride === 0).map((point, index) => (
          <circle key={`${point.x}-${point.y}-${index}`} cx={x(point.x)} cy={y(point.y)} r="1" fill="#777" />
        ))}
        {drawingSet.networkPaths.map((path) => (
          <polyline key={path.pipeId} points={linePoints(path.points)} fill="none" stroke="#1746b5" strokeWidth="5" strokeLinejoin="round" />
        ))}
      </g>
      <rect x={content.x} y={content.y} width={content.width} height={content.height} fill="none" stroke="#222" />
      <text x="62" y="680" fontSize="9">Показаны все {drawingSet.networkPaths.length} полилиний сети, включая ветви вне главного профиля.</text>
    </DrawingFrame>
  )
}

/**
 * Продольный профиль.
 *
 * Боковик объявлял шесть граф, а заполнял четыре: «Уклон / длина» и
 * «Расстояние, м» оставались пустыми — треть высоты боковика (62 точки из 186)
 * занимали пустые строки с заголовками. Обе величины считаются из тех же
 * станций, что и линии, и никаких новых исходных данных не требуют.
 *
 * Номер колодца брать неоткуда, пока в вид не передана ведомость: у станции
 * профиля есть только `nodeId`, а марка колодца живёт в `schedule.manholes`.
 */
function ProfilePreview({ sheet, profile, schedule, showFrame }: {
  sheet: WorkingDrawingSheet
  profile: GravityProfile | null
  schedule: SewerSchedule | null
  showFrame: boolean
}) {
  const { t } = useTranslation()
  const stations = (profile?.stations ?? []).filter((station) => !sheet.interval
    || (station.chainageM >= sheet.interval.fromM - 1e-9 && station.chainageM <= sheet.interval.toM + 1e-9))
  if (stations.length < 2) {
    return <DrawingFrame sheet={sheet} showFrame={showFrame}><text x="60" y="90" fontSize="20">{t('project.preview.noProfileStations')}</text></DrawingFrame>
  }
  const from = stations[0].chainageM
  const to = stations[stations.length - 1].chainageM
  const minElevation = Math.floor(Math.min(...stations.map((station) => station.invertElevationM)) - 1)
  const maxElevation = Math.ceil(Math.max(...stations.map((station) => station.groundElevationM)) + 1)
  const x = (chainageM: number) => 180 + ((chainageM - from) / Math.max(to - from, 1)) * 930
  const y = (elevationM: number) => 420 - ((elevationM - minElevation) / Math.max(maxElevation - minElevation, 1)) * 300
  // Масштаб считается от геометрии листа и подписывается как есть.
  //
  // Прежняя редакция округляла знаменатель вверх по ряду 100/200/500, но чертёж
  // при этом не перестраивала — подпись расходилась с рисунком вдвое: по
  // вертикали выходило 1:100,6, а на листе стояло «1:200». Подписать
  // округлённый масштаб можно только вместе с перестроением; иначе это
  // выдуманное число на чертеже, а по нему инженер снимает размеры.
  //
  // Ширина холста 1180 единиц соответствует ширине листа А3 — 420 мм.
  const MM_PER_UNIT = 420 / 1180
  const horizontalScale = Math.round(Math.max(to - from, 1) * 1000 / (930 * MM_PER_UNIT))
  const verticalScale = Math.round(Math.max(maxElevation - minElevation, 1) * 1000 / (300 * MM_PER_UNIT))
  // Превышение вертикали над горизонталью: на продольном профиле его принято
  // держать около 5:1, здесь оно задано пропорциями холста и потому больше.
  const exaggeration = (horizontalScale / Math.max(verticalScale, 1)).toFixed(1)

  const ground = stations.map((station) => `${x(station.chainageM)},${y(station.groundElevationM)}`).join(' ')
  const invert = stations.map((station) => `${x(station.chainageM)},${y(station.invertElevationM)}`).join(' ')
  // Марка колодца ведомости, если она есть; иначе — обозначение узла сети.
  // Пустой графы быть не должно: инженер по ней и находит колодец на плане.
  const labelByNode = new Map((schedule?.manholes ?? [])
    .filter((manhole) => manhole.nodeId)
    .map((manhole) => [manhole.nodeId as string, manhole.label]))
  const manholeLabel = (nodeId: string) => labelByNode.get(nodeId) ?? nodeId

  const rows = PROFILE_ROWS
  return (
    <DrawingFrame sheet={sheet} showFrame={showFrame}>
      <text x="55" y="48" fontSize="17" fontWeight="700">{sheet.title}</text>
      <text x="55" y="84" fontSize="10">{t('project.profileSheet.horizonAndScale', {
        horizon: minElevation.toFixed(2),
        horizontal: horizontalScale,
        vertical: verticalScale,
        exaggeration,
      })}</text>
      {/*
        Линии сетки без отметок высоту прочесть не дают: их было семь, и ни одна
        не подписана. Подпись ставится слева, у самой линии.
      */}
      {Array.from({ length: 7 }, (_, index) => {
        const lineY = 120 + index * 50
        const elevation = minElevation + (420 - lineY) / 300 * (maxElevation - minElevation)
        return (
          <g key={index}>
            <line x1="180" y1={lineY} x2="1110" y2={lineY} stroke="#ddd" />
            <text x="176" y={lineY + 3} textAnchor="end" fontSize="7.5" fill="#555">
              {elevation.toFixed(2)}
            </text>
          </g>
        )
      })}
      <polyline points={ground} fill="none" stroke="#6c5134" strokeWidth="2.5" />
      <polyline points={invert} fill="none" stroke="#1746b5" strokeWidth="3.5" />
      {stations.map((station) => (
        <line key={station.nodeId} x1={x(station.chainageM)} y1={y(station.groundElevationM)} x2={x(station.chainageM)} y2={y(station.invertElevationM)} stroke="#111" />
      ))}
      {rows.map((label, index) => (
        <g key={label}>
          <rect x="55" y={470 + index * 31} width="1055" height="31" fill="none" stroke="#111" />
          <line x1="175" y1={470 + index * 31} x2="175" y2={501 + index * 31} stroke="#111" />
          <text x="61" y={490 + index * 31} fontSize="9">{label}</text>
        </g>
      ))}
      {stations.map((station, index) => {
        // Колонки ближе 26 точек не вмещают «685.55» рядом: числа сливаются в
        // «685.55685.46». Тесная колонка опускается на второй ярус — приём
        // чертёжника, а не уменьшение шрифта до нечитаемого.
        const previousX = index > 0 ? x(stations[index - 1].chainageM) : -Infinity
        const tight = x(station.chainageM) - previousX < 26
        const drop = tight ? 9 : 0
        return (
        <g key={`table-${station.nodeId}`}>
          <line x1={x(station.chainageM)} y1="470" x2={x(station.chainageM)} y2="656" stroke="#bbb" />
          <text x={x(station.chainageM)} y={489 + drop} textAnchor="middle" fontSize="8">{station.invertElevationM.toFixed(2)}</text>
          <text x={x(station.chainageM)} y={520 + drop} textAnchor="middle" fontSize="8">{station.groundElevationM.toFixed(2)}</text>
          <text x={x(station.chainageM)} y={551 + drop} textAnchor="middle" fontSize="8">{station.diameterMm}</text>
          <text x={x(station.chainageM)} y={641 + drop} textAnchor="middle" fontSize="7.5">
            {manholeLabel(station.nodeId)}
          </text>
          <text x={x(station.chainageM)} y={651 + drop} textAnchor="middle" fontSize="7">
            {picket(station.chainageM)}
          </text>
        </g>
        )
      })}
      {/*
        Уклон, длина и расстояние относятся к участку между станциями, а не к
        станции, поэтому подписываются посередине пролёта.
      */}
      {stations.slice(1).map((station, index) => {
        const previous = stations[index]
        const lengthM = station.chainageM - previous.chainageM
        const fall = previous.invertElevationM - station.invertElevationM
        const middle = (x(previous.chainageM) + x(station.chainageM)) / 2
        return (
          <g key={`span-${previous.nodeId}-${station.nodeId}`}>
            <text x={middle} y="582" textAnchor="middle" fontSize="7.5">
              {lengthM > 0 ? `${(fall / lengthM * 1000).toFixed(1)}‰ · ${lengthM.toFixed(1)}` : '—'}
            </text>
            <text x={middle} y="613" textAnchor="middle" fontSize="7.5">{lengthM.toFixed(2)}</text>
          </g>
        )
      })}
    </DrawingFrame>
  )
}

function MaterialPreview({ sheet, schedule, manholeConstructions, showFrame }: { sheet: WorkingDrawingSheet; schedule: SewerSchedule | null; manholeConstructions: SelectedManholeConstruction[]; showFrame: boolean }) {
  const { t } = useTranslation()
  const range = sheet.dataRange ?? { start: 0, end: schedule?.manholes.length ?? 0, total: schedule?.manholes.length ?? 0 }
  const rows = schedule?.manholes.slice(range.start, range.end) ?? []
  const constructionByLabel = new Map(manholeConstructions.map((item) => [item.manholeLabel, item]))
  return (
    <DrawingFrame sheet={sheet} showFrame={showFrame}>
      <text x="55" y="55" fontSize="17" fontWeight="700">{sheet.title}</text>
      <text x="55" y="82" fontSize="10">{t('project.preview.needManholeCatalog')}</text>
      <g transform="translate(55 105)">
        {['Марка', 'Пикет', 'Глубина, м', 'Диаметр, мм', 'Конструкция'].map((label, index) => (
          <g key={label}><rect x={index * 205} y="0" width="205" height="34" fill="#f2f2f2" stroke="#111" /><text x={index * 205 + 8} y="21" fontSize="10" fontWeight="700">{label}</text></g>
        ))}
        {rows.map((row, rowIndex) => [row.label, row.picket, (row.depthMm / 1000).toFixed(2), row.pipeDiameterMm, constructionByLabel.get(row.label)?.typeCode ?? 'не подобрано'].map((value, colIndex) => (
          <g key={`${rowIndex}-${colIndex}`}><rect x={colIndex * 205} y={34 + rowIndex * 34} width="205" height="34" fill="#fff" stroke="#111" /><text x={colIndex * 205 + 8} y={56 + rowIndex * 34} fontSize="10">{value}</text></g>
        )))}
      </g>
    </DrawingFrame>
  )
}

function DetailPreview({ sheet, drawingSet, schedule, manholeConstructions, showFrame }: { sheet: WorkingDrawingSheet; drawingSet: WorkingDrawingSet; schedule: SewerSchedule | null; manholeConstructions: SelectedManholeConstruction[]; showFrame: boolean }) {
  const { t } = useTranslation()
  if (sheet.variant === 'protective_grid') {
    const design = drawingSet.protectiveGridDesign
    if (!design) {
      return <DrawingFrame sheet={sheet} showFrame={showFrame}><text x="55" y="80" fontSize="18">{t('project.preview.noGridParams')}</text></DrawingFrame>
    }
    const drawingWidth = Math.min(620, 340 * design.overallWidthMm / Math.max(design.overallHeightMm, 1))
    const drawingHeight = Math.min(340, 620 * design.overallHeightMm / Math.max(design.overallWidthMm, 1))
    const x0 = 100
    const y0 = 125
    const verticalBars = Math.max(0, Math.floor(design.overallWidthMm / design.barSpacingMm) - 1)
    const horizontalBars = Math.max(0, Math.floor(design.overallHeightMm / design.barSpacingMm) - 1)
    return (
      <DrawingFrame sheet={sheet} showFrame={showFrame}>
        <text x="55" y="55" fontSize="17" fontWeight="700">{sheet.title}</text>
        <text x="55" y="82" fontSize="10">{t('project.preview.gridFromCard')}</text>
        <rect x={x0} y={y0} width={drawingWidth} height={drawingHeight} fill="none" stroke="#111" strokeWidth="4" />
        {Array.from({ length: verticalBars }, (_, index) => {
          const x = x0 + (index + 1) * design.barSpacingMm / design.overallWidthMm * drawingWidth
          return <line key={`v-${index}`} x1={x} y1={y0} x2={x} y2={y0 + drawingHeight} stroke="#111" />
        })}
        {Array.from({ length: horizontalBars }, (_, index) => {
          const y = y0 + (index + 1) * design.barSpacingMm / design.overallHeightMm * drawingHeight
          return <line key={`h-${index}`} x1={x0} y1={y} x2={x0 + drawingWidth} y2={y} stroke="#111" />
        })}
        <text x={x0} y={y0 + drawingHeight + 28} fontSize="12">Габарит {design.overallWidthMm}×{design.overallHeightMm} мм; шаг {design.barSpacingMm} мм</text>
        <text x="770" y="145" fontSize="11">Количество: {design.quantity.toFixed(3)} шт.</text>
        <text x="770" y="175" fontSize="11">Рама: {design.frameProfile}</text>
        <text x="770" y="205" fontSize="11">Стержни: {design.barProfile}</text>
        <text x="770" y="235" fontSize="11">Материал: {design.material}</text>
        <text x="770" y="265" fontSize="11">Покрытие: {design.coating}</text>
        <text x="770" y="295" fontSize="11">Крепление: {design.fixing}</text>
        <text x="770" y="325" fontSize="9">Источник: {design.source}</text>
      </DrawingFrame>
    )
  }
  const isCrossingSheet = sheet.id.startsWith('crossings-')
  const rows = isCrossingSheet
    ? sheet.sources.map((source) => [source.label, source.detail ?? '—', source.available ? 'есть' : 'нет', source.verified ? 'проверено' : 'не проверено'])
    : (schedule?.manholes ?? []).slice(0, 12).map((row) => {
      const selected = manholeConstructions.find((item) => item.manholeLabel === row.label)
      return [row.label, row.picket, `${(row.depthMm / 1000).toFixed(2)} м`, selected?.typeCode ?? 'не подобрано']
    })
  return (
    <DrawingFrame sheet={sheet} showFrame={showFrame}>
      <text x="55" y="55" fontSize="17" fontWeight="700">{sheet.title}</text>
      <text x="55" y="82" fontSize="10">{isCrossingSheet
        ? 'Карточки пересечений должны содержать отметки, просвет, способ работ, футляр, источник и согласование.'
        : 'Конструкции выбираются параметрически по глубине, диаметру и числу подключений из активного каталога.'}</text>
      <g transform="translate(55 110)">
        {(isCrossingSheet ? ['Источник', 'Состав', 'Наличие', 'Статус'] : ['Сооружение', 'Пикет', 'Глубина', 'Труба']).map((label, index) => (
          <g key={label}><rect x={index * 255} y="0" width="255" height="34" fill="#f2f2f2" stroke="#111" /><text x={index * 255 + 8} y="22" fontSize="10" fontWeight="700">{label}</text></g>
        ))}
        {rows.map((row, rowIndex) => row.map((value, colIndex) => (
          <g key={`${rowIndex}-${colIndex}`}><rect x={colIndex * 255} y={34 + rowIndex * 34} width="255" height="34" fill="#fff" stroke="#111" /><text x={colIndex * 255 + 8} y={56 + rowIndex * 34} fontSize="9">{value}</text></g>
        )))}
      </g>
    </DrawingFrame>
  )
}

function SpecificationPreview({ sheet, schedule, manholeConstructions, showFrame }: { sheet: WorkingDrawingSheet; schedule: SewerSchedule | null; manholeConstructions: SelectedManholeConstruction[]; showFrame: boolean }) {
  const { t } = useTranslation()
  const componentTotals = new Map<string, { name: string; code: string; unit: string; quantity: number }>()
  for (const construction of manholeConstructions) {
    for (const component of construction.components) {
      const key = `${component.catalogCode ?? ''}\u0000${component.name}\u0000${component.unit}`
      const current = componentTotals.get(key)
      componentTotals.set(key, {
        name: component.name,
        code: component.catalogCode ?? '—',
        unit: component.unit,
        quantity: (current?.quantity ?? 0) + component.quantity,
      })
    }
  }
  const allRows: Array<[string, string, string, string]> = [
    ...(schedule?.pipes ?? []).map((row): [string, string, string, string] => [row.designation, row.agskCode || '—', 'м', row.lengthM.toFixed(2)]),
    ...[...componentTotals.values()].map((row): [string, string, string, string] => [row.name, row.code, row.unit, row.quantity.toFixed(3)]),
  ]
  const range = sheet.dataRange ?? { start: 0, end: allRows.length, total: allRows.length }
  const rows = allRows.slice(range.start, range.end)
  return (
    <DrawingFrame sheet={sheet} showFrame={showFrame}>
      <text x="55" y="55" fontSize="17" fontWeight="700">{sheet.title}</text>
      <text x="55" y="82" fontSize="10">{t('project.preview.billRecomputed')}</text>
      <g transform="translate(55 110)">
        {['Позиция', 'Наименование', 'Код', 'Ед. / количество'].map((label, index) => (
          <g key={label}><rect x={index * 255} y="0" width="255" height="34" fill="#f2f2f2" stroke="#111" /><text x={index * 255 + 8} y="22" fontSize="10" fontWeight="700">{label}</text></g>
        ))}
        {rows.map((row, rowIndex) => [range.start + rowIndex + 1, row[0], row[1], `${row[2]} / ${row[3]}`].map((value, colIndex) => (
          <g key={`${rowIndex}-${colIndex}`}><rect x={colIndex * 255} y={34 + rowIndex * 34} width="255" height="34" fill="#fff" stroke="#111" /><text x={colIndex * 255 + 8} y={56 + rowIndex * 34} fontSize="9">{value}</text></g>
        )))}
      </g>
    </DrawingFrame>
  )
}

export function WorkingDrawingPreview({
  sheet,
  drawingSet,
  network,
  pipeDiameterMm,
  pipeDesign,
  buildingLabels,
  surveyPoints,
  profile,
  schedule,
  showTopography = true,
  showFrame = true,
  constraints = null,
  manholeConstructions,
}: {
  sheet: WorkingDrawingSheet
  drawingSet: WorkingDrawingSet
  network: TracedNetwork
  pipeDiameterMm: Map<string, number>
  pipeDesign?: Map<string, PlanPipeDesign>
  buildingLabels?: Map<string, string>
  surveyPoints: SurveyPoint[]
  profile: GravityProfile | null
  schedule: SewerSchedule | null
  showTopography?: boolean
  showFrame?: boolean
  constraints?: RouteConstraintInput | null
  manholeConstructions: SelectedManholeConstruction[]
}) {
  if (sheet.kind === 'plan') return <PlanPreview sheet={sheet} drawingSet={drawingSet} network={network} schedule={schedule} pipeDiameterMm={pipeDiameterMm} pipeDesign={pipeDesign} buildingLabels={buildingLabels} surveyPoints={surveyPoints} showTopography={showTopography} showFrame={showFrame} constraints={constraints} />
  if (sheet.kind === 'network_plan') return <NetworkPlanPreview sheet={sheet} drawingSet={drawingSet} surveyPoints={surveyPoints} showTopography={showTopography} showFrame={showFrame} constraints={constraints} />
  if (sheet.kind === 'profile') return <ProfilePreview sheet={sheet} profile={sheet.profileData ?? profile} schedule={schedule} showFrame={showFrame} />
  if (sheet.kind === 'material_table') return <MaterialPreview sheet={sheet} schedule={schedule} manholeConstructions={manholeConstructions} showFrame={showFrame} />
  if (sheet.kind === 'specification') return <SpecificationPreview sheet={sheet} schedule={schedule} manholeConstructions={manholeConstructions} showFrame={showFrame} />
  return <DetailPreview sheet={sheet} drawingSet={drawingSet} schedule={schedule} manholeConstructions={manholeConstructions} showFrame={showFrame} />
}
