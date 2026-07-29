import type { ReactNode } from 'react'
import type {
  GravityProfile,
  RouteConstraintInput,
  SelectedManholeConstruction,
  SewerSchedule,
  SurveyPoint,
  WorkingDrawingSet,
  WorkingDrawingSheet,
} from '@aquascheme/engine'

type Point = { x: number; y: number; chainageM: number }

function pathPointAt(path: Point[], chainageM: number): Point {
  if (path.length === 0) return { x: 0, y: 0, chainageM }
  if (chainageM <= path[0].chainageM) return { ...path[0], chainageM }
  for (let index = 1; index < path.length; index++) {
    if (path[index].chainageM >= chainageM) {
      const a = path[index - 1]
      const b = path[index]
      const ratio = (chainageM - a.chainageM) / Math.max(b.chainageM - a.chainageM, 1e-9)
      return {
        x: a.x + (b.x - a.x) * ratio,
        y: a.y + (b.y - a.y) * ratio,
        chainageM,
      }
    }
  }
  return { ...path[path.length - 1], chainageM }
}

function pathSlice(path: Point[], fromM: number, toM: number): Point[] {
  if (path.length < 2) return path
  return [
    pathPointAt(path, fromM),
    ...path.filter((point) => point.chainageM > fromM && point.chainageM < toM),
    pathPointAt(path, toM),
  ]
}

function picket(chainageM: number): string {
  const pk = Math.floor(chainageM / 100)
  const rest = Math.round((chainageM - pk * 100) * 100) / 100
  return rest === 0 ? `ПК${pk}` : `ПК${pk}+${rest}`
}

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
  return (
    <svg className="working-drawing-preview" viewBox="0 0 1180 820" role="img" aria-label={`Предпросмотр: ${sheet.title}`}>
      <rect width="1180" height="820" fill="#fff" />
      {showFrame && <>
        <rect x="18" y="18" width="1144" height="784" fill="none" stroke="#111" strokeWidth="1.5" />
        <rect x="790" y="700" width="372" height="102" fill="#fff" stroke="#111" />
        <line x1="790" y1="736" x2="1162" y2="736" stroke="#111" />
        <line x1="1020" y1="700" x2="1020" y2="802" stroke="#111" />
        <line x1="1090" y1="700" x2="1090" y2="802" stroke="#111" />
        <text x="804" y="721" fontSize="12">Наружные сети канализации</text>
        <text x="804" y="756" fontSize="12" fontWeight="700">{sheet.title}</text>
        <text x="1055" y="721" textAnchor="middle" fontSize="10">{sheet.documentSet === 'working_drawings' ? 'MAIN' : 'SPEC'}</text>
        <text x="1055" y="764" textAnchor="middle" fontSize="18">{sheet.sheetNumber}</text>
        <text x="1126" y="721" textAnchor="middle" fontSize="10">Статус</text>
        <text x="1126" y="758" textAnchor="middle" fontSize="9">{sheet.status}</text>
      </>}
      {children}
      {sheet.status !== 'VERIFIED' && (
        <text
          x="590"
          y="400"
          textAnchor="middle"
          fontSize="34"
          fontWeight="700"
          fill={sheet.status === 'BLOCKED' || sheet.status === 'STALE' ? '#b42318' : '#8a5a00'}
          opacity="0.24"
          transform="rotate(-18 590 400)"
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
  const contextLines = sample(
    (constraints?.cadContextLines ?? []).filter((line) => intersectsBounds(line.points)),
    3500,
  )
  const terrainLines = sample(
    (constraints?.terrainLines ?? []).filter((line) => intersectsBounds(line.points)),
    2000,
  )
  const blocks = sample((constraints?.cadBlockEntities ?? []).filter((block) =>
    block.x >= bounds.minX && block.x <= bounds.maxX && block.y >= bounds.minY && block.y <= bounds.maxY), 500)
  const labels = sample((constraints?.cadTextEntities ?? []).filter((label) =>
    label.x >= bounds.minX && label.x <= bounds.maxX && label.y >= bounds.minY && label.y <= bounds.maxY), 900)
  const linePoints = (points: Array<{ x: number; y: number }>) => points
    .map((point) => `${x(point.x)},${y(point.y)}`)
    .join(' ')
  return <>
    {contextLines.map((line, index) => (
      <polyline key={`cad-${line.sourceHandle ?? index}`} points={linePoints(line.points)} fill="none" stroke="#c7c7c7" strokeWidth="0.65" />
    ))}
    {terrainLines.map((line, index) => (
      <polyline key={`terrain-${line.sourceHandle ?? index}`} points={linePoints(line.points)} fill="none" stroke="#78906d" strokeWidth="0.9" />
    ))}
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
  const window = sheet.window
  const sourcePath = sheet.planPathId
    ? drawingSet.planPaths.find((path) => path.id === sheet.planPathId)?.points ?? []
    : drawingSet.mainPath
  if (!window || sourcePath.length < 2) {
    return <DrawingFrame sheet={sheet} showFrame={showFrame}><text x="60" y="90" fontSize="20">Нет подтверждённой геометрии плана</text></DrawingFrame>
  }
  const width = Math.max(window.maxX - window.minX, 1)
  const height = Math.max(window.maxY - window.minY, 1)
  const content = { x: 55, y: 70, width: 1080, height: 590 }
  const scale = Math.min(content.width / width, content.height / height)
  const x = (value: number) => content.x + (value - window.minX) * scale
  const y = (value: number) => content.y + content.height - (value - window.minY) * scale
  const path = pathSlice(sourcePath, window.fromM, window.toM)
  const route = path.map((point) => `${x(point.x)},${y(point.y)}`).join(' ')
  const topo = surveyPoints.filter((point) =>
    point.x >= window.minX && point.x <= window.maxX && point.y >= window.minY && point.y <= window.maxY)
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
  return (
    <DrawingFrame sheet={sheet} showFrame={showFrame}>
      <defs><clipPath id={`clip-${sheet.id}`}><rect x={content.x} y={content.y} width={content.width} height={content.height} /></clipPath></defs>
      <text x="55" y="48" fontSize="17" fontWeight="700">{sheet.title}</text>
      <g clipPath={`url(#clip-${sheet.id})`}>
        <CadContextLayer constraints={constraints} x={x} y={y} bounds={window} />
        {(constraints?.hardObstacleRings ?? []).map((ring, index) => <polygon key={`building-${index}`} points={linePoints(ring)} fill="#d7d7d7" stroke="#555" />)}
        {(constraints?.waterRings ?? []).map((ring, index) => <polygon key={`water-ring-${index}`} points={linePoints(ring)} fill="#d8f1f8" stroke="#2685b5" />)}
        {(constraints?.corridorRings ?? []).map((ring, index) => <polygon key={`corridor-${index}`} points={linePoints(ring)} fill="none" stroke="#d33232" strokeWidth="1.5" strokeDasharray="8 5" />)}
        {(constraints?.roadLines ?? []).map((line, index) => <polyline key={`road-${index}`} points={linePoints(line.points)} fill="none" stroke="#8b734f" strokeWidth="3" />)}
        {(constraints?.waterLines ?? []).map((line, index) => <polyline key={`water-${index}`} points={linePoints(line.points)} fill="none" stroke="#2685b5" strokeWidth="2" />)}
        {(constraints?.utilityLines ?? []).map((line, index) => <polyline key={`utility-${index}`} points={linePoints(line.points)} fill="none" stroke="#9b2c8c" strokeWidth="1.5" strokeDasharray="6 4" />)}
        {(constraints?.redLines ?? []).map((line, index) => <polyline key={`red-${index}`} points={linePoints(line.points)} fill="none" stroke="#d22" strokeWidth="2" />)}
        {showTopography && topo.filter((_, index) => index % stride === 0).map((point, index) => (
          <g key={`${point.x}-${point.y}-${index}`}>
            <circle cx={x(point.x)} cy={y(point.y)} r="1" fill="#777" />
            {index % 12 === 0 && <text x={x(point.x) + 3} y={y(point.y) - 3} fontSize="7" fill="#777">{point.z.toFixed(2)}</text>}
          </g>
        ))}
        <polyline points={route} fill="none" stroke="#1746b5" strokeWidth="5" strokeLinejoin="round" />
        {path.map((point, index) => index === 0 || index === path.length - 1 ? (
          <g key={`bound-${index}`}>
            <circle cx={x(point.x)} cy={y(point.y)} r="5" fill="#fff" stroke="#1746b5" strokeWidth="2" />
            <text x={x(point.x) + 8} y={y(point.y) - 8} fontSize="11" fontWeight="700">{picket(point.chainageM)}</text>
          </g>
        ) : null)}
      </g>
      <rect x={content.x} y={content.y} width={content.width} height={content.height} fill="none" stroke="#222" />
      <g>
        <rect x="940" y="32" width="185" height="112" fill="#fff" stroke="#222" />
        <polyline points={overview.map((point) => `${ox(point.x)},${oy(point.y)}`).join(' ')} fill="none" stroke="#999" strokeWidth="1.5" />
        <polyline points={path.map((point) => `${ox(point.x)},${oy(point.y)}`).join(' ')} fill="none" stroke="#1746b5" strokeWidth="4" />
        <text x="947" y="140" fontSize="8">Положение текущего листа</text>
      </g>
      <g transform="translate(78 105)">
        <line x1="0" y1="28" x2="0" y2="0" stroke="#111" />
        <path d="M0 0 L-5 10 M0 0 L5 10" stroke="#111" fill="none" />
        <text x="0" y="-5" textAnchor="middle" fontSize="10">С</text>
      </g>
      <g transform="translate(62 610)" fontSize="8">
        <rect x="0" y="0" width="300" height="45" fill="#fff" stroke="#aaa" />
        <line x1="10" y1="12" x2="38" y2="12" stroke="#1746b5" strokeWidth="4" /><text x="45" y="15">проектная ось</text>
        <line x1="120" y1="12" x2="148" y2="12" stroke="#9b2c8c" strokeDasharray="6 4" /><text x="155" y="15">коммуникации</text>
        <line x1="10" y1="31" x2="38" y2="31" stroke="#d22" /><text x="45" y="34">красные линии / коридор</text>
      </g>
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
  const networkPoints = drawingSet.networkPaths.flatMap((path) => path.points)
  if (networkPoints.length < 2) {
    return <DrawingFrame sheet={sheet} showFrame={showFrame}><text x="60" y="90" fontSize="20">Нет подтверждённой геометрии сети</text></DrawingFrame>
  }
  const contextPoints = [
    ...(constraints?.hardObstacleRings ?? []).flat(),
    ...(constraints?.waterRings ?? []).flat(),
    ...(constraints?.corridorRings ?? []).flat(),
    ...(constraints?.roadLines ?? []).flatMap((line) => line.points),
    ...(constraints?.waterLines ?? []).flatMap((line) => line.points),
    ...(constraints?.utilityLines ?? []).flatMap((line) => line.points),
    ...(constraints?.redLines ?? []).flatMap((line) => line.points),
    ...(constraints?.cadContextLines ?? []).flatMap((line) => line.points),
    ...(constraints?.terrainLines ?? []).flatMap((line) => line.points),
    ...(constraints?.cadTextEntities ?? []),
    ...(constraints?.cadBlockEntities ?? []),
  ]
  const allPoints = [...networkPoints, ...contextPoints]
  const rawMinX = Math.min(...allPoints.map((point) => point.x))
  const rawMaxX = Math.max(...allPoints.map((point) => point.x))
  const rawMinY = Math.min(...allPoints.map((point) => point.y))
  const rawMaxY = Math.max(...allPoints.map((point) => point.y))
  const margin = Math.max(Math.max(rawMaxX - rawMinX, rawMaxY - rawMinY) * 0.04, 10)
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

function ProfilePreview({ sheet, profile, showFrame }: { sheet: WorkingDrawingSheet; profile: GravityProfile | null; showFrame: boolean }) {
  const stations = (profile?.stations ?? []).filter((station) => !sheet.interval
    || (station.chainageM >= sheet.interval.fromM - 1e-9 && station.chainageM <= sheet.interval.toM + 1e-9))
  if (stations.length < 2) {
    return <DrawingFrame sheet={sheet} showFrame={showFrame}><text x="60" y="90" fontSize="20">Нет подтверждённых станций профиля</text></DrawingFrame>
  }
  const from = stations[0].chainageM
  const to = stations[stations.length - 1].chainageM
  const minElevation = Math.floor(Math.min(...stations.map((station) => station.invertElevationM)) - 1)
  const maxElevation = Math.ceil(Math.max(...stations.map((station) => station.groundElevationM)) + 1)
  const x = (chainageM: number) => 180 + ((chainageM - from) / Math.max(to - from, 1)) * 930
  const y = (elevationM: number) => 420 - ((elevationM - minElevation) / Math.max(maxElevation - minElevation, 1)) * 300
  const ground = stations.map((station) => `${x(station.chainageM)},${y(station.groundElevationM)}`).join(' ')
  const invert = stations.map((station) => `${x(station.chainageM)},${y(station.invertElevationM)}`).join(' ')
  const rows = ['Отметка лотка, м', 'Отметка земли, м', 'Диаметр, мм', 'Уклон / длина', 'Расстояние, м', 'Колодец / ПК']
  return (
    <DrawingFrame sheet={sheet} showFrame={showFrame}>
      <text x="55" y="48" fontSize="17" fontWeight="700">{sheet.title}</text>
      <text x="55" y="84" fontSize="10">Условный горизонт: {minElevation.toFixed(2)} м</text>
      {Array.from({ length: 7 }, (_, index) => <line key={index} x1="180" y1={120 + index * 50} x2="1110" y2={120 + index * 50} stroke="#ddd" />)}
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
      {stations.map((station) => (
        <g key={`table-${station.nodeId}`}>
          <line x1={x(station.chainageM)} y1="470" x2={x(station.chainageM)} y2="656" stroke="#bbb" />
          <text x={x(station.chainageM)} y="489" textAnchor="middle" fontSize="8">{station.invertElevationM.toFixed(2)}</text>
          <text x={x(station.chainageM)} y="520" textAnchor="middle" fontSize="8">{station.groundElevationM.toFixed(2)}</text>
          <text x={x(station.chainageM)} y="551" textAnchor="middle" fontSize="8">{station.diameterMm}</text>
          <text x={x(station.chainageM)} y="644" textAnchor="middle" fontSize="8">{picket(station.chainageM)}</text>
        </g>
      ))}
    </DrawingFrame>
  )
}

function MaterialPreview({ sheet, schedule, manholeConstructions, showFrame }: { sheet: WorkingDrawingSheet; schedule: SewerSchedule | null; manholeConstructions: SelectedManholeConstruction[]; showFrame: boolean }) {
  const range = sheet.dataRange ?? { start: 0, end: schedule?.manholes.length ?? 0, total: schedule?.manholes.length ?? 0 }
  const rows = schedule?.manholes.slice(range.start, range.end) ?? []
  const constructionByLabel = new Map(manholeConstructions.map((item) => [item.manholeLabel, item]))
  return (
    <DrawingFrame sheet={sheet} showFrame={showFrame}>
      <text x="55" y="55" fontSize="17" fontWeight="700">{sheet.title}</text>
      <text x="55" y="82" fontSize="10">Количества конструктивных элементов выпускаются только после выбора подтверждённого каталога колодцев.</text>
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
  if (sheet.variant === 'protective_grid') {
    const design = drawingSet.protectiveGridDesign
    if (!design) {
      return <DrawingFrame sheet={sheet} showFrame={showFrame}><text x="55" y="80" fontSize="18">Нет подтверждённых параметров защитной сетки.</text></DrawingFrame>
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
        <text x="55" y="82" fontSize="10">Чертёж сформирован из подтверждённой карточки изделия; размеры эталонного проекта не используются.</text>
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
      <text x="55" y="82" fontSize="10">Ведомость пересчитывается из геометрии сети, гидравлики и активных параметрических каталогов.</text>
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
  surveyPoints: SurveyPoint[]
  profile: GravityProfile | null
  schedule: SewerSchedule | null
  showTopography?: boolean
  showFrame?: boolean
  constraints?: RouteConstraintInput | null
  manholeConstructions: SelectedManholeConstruction[]
}) {
  if (sheet.kind === 'plan') return <PlanPreview sheet={sheet} drawingSet={drawingSet} surveyPoints={surveyPoints} showTopography={showTopography} showFrame={showFrame} constraints={constraints} />
  if (sheet.kind === 'network_plan') return <NetworkPlanPreview sheet={sheet} drawingSet={drawingSet} surveyPoints={surveyPoints} showTopography={showTopography} showFrame={showFrame} constraints={constraints} />
  if (sheet.kind === 'profile') return <ProfilePreview sheet={sheet} profile={sheet.profileData ?? profile} showFrame={showFrame} />
  if (sheet.kind === 'material_table') return <MaterialPreview sheet={sheet} schedule={schedule} manholeConstructions={manholeConstructions} showFrame={showFrame} />
  if (sheet.kind === 'specification') return <SpecificationPreview sheet={sheet} schedule={schedule} manholeConstructions={manholeConstructions} showFrame={showFrame} />
  return <DetailPreview sheet={sheet} drawingSet={drawingSet} schedule={schedule} manholeConstructions={manholeConstructions} showFrame={showFrame} />
}
