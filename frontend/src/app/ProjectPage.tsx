import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { NORMATIVE_DEFAULTS, ROUTE_ALGORITHM_VERSION, resolveRouteFreshness } from '@aquascheme/engine'
import type { SurveyPoint } from '@aquascheme/engine'
import { supabase } from '../shared/supabase'
import type { BuildingRow, DatasetKind, DatasetRow, SourceData } from '../shared/datasets'
import type { NodeRow, PipeRow } from '../shared/network'
import { runFullPipeline } from '../shared/pipeline'
import type { GeologyInput, SeismicInput, SurveyPoint as EngineSurveyPoint } from '@aquascheme/engine'
import { TopographySection } from './project/TopographySection'
import { BuildingsSection } from './project/BuildingsSection'
import { NormsSection, RegionSection, SeismicSection, SourceSection } from './project/FormSections'
import { DeliverablesSection } from './project/DeliverablesSection'
import { CrossingsSection } from './project/CrossingsSection'
import { DemandSection } from './project/DemandSection'
import { TraceSection } from './project/TraceSection'
import { HydraulicsSection } from './project/HydraulicsSection'
import { EquipmentSection } from './project/EquipmentSection'
import { ResultsSection } from './project/ResultsSection'
import { ExportSection } from './project/ExportSection'
import { ImportSection } from './project/ImportSection'
import { ParcelsSection } from './project/ParcelsSection'
import { BasisSection } from './project/BasisSection'
import { CatalogSection } from './project/CatalogSection'
import { ManholeCatalogSection } from './project/ManholeCatalogSection'
import { PumpCatalogSection } from './project/PumpCatalogSection'
import { fetchCatalogs } from '../shared/catalog'
import type { CatalogRow } from '../shared/catalog'
import { ExistingNetworkSection } from './project/ExistingNetworkSection'
import { ReconstructionSurveySection } from './project/ReconstructionSurveySection'
import { SourceBundleRunSection } from './project/SourceBundleRunSection'
import { TuImportSection } from './project/TuImportSection'
import { StankevichaDemoView } from './project/StankevichaDemoView'
import { fetchExisting } from '../shared/existing'
import type { ExistingPipeRow } from '../shared/existing'
import { GeologySection } from './project/GeologySection'
import { fetchGeology } from '../shared/geology'
import type { Borehole } from '@aquascheme/engine'
import { DrainageSection } from './project/DrainageSection'
import { GravitySection } from './project/GravitySection'
import { SituationSchemeSection } from './project/SituationSchemeSection'
import { syncNormRegistry } from '../shared/norms'
import { syncRegions } from '../shared/regions'
import { formatAppError } from '../shared/errorFormatting'
import { NormRegistrySection } from './project/NormRegistrySection'
import { analyzeParcelViolations } from '@aquascheme/engine'
import type { ViolationPipe } from '@aquascheme/engine'
import { autoAssignParcels, fetchParcels, parcelPolygons } from '../shared/parcels'
import type { ParcelRow } from '../shared/parcels'
import type { SizingResult } from '@aquascheme/engine/sizing'
import { isPressurePipelineSystem } from '../shared/pressurePipeline'
import { classifySyntheticDemoTarget, projectPipelineMode } from '../shared/projectActions'

interface ProjectInfo {
  id: string
  name: string
  work_type?: string | null
  system_type?: string | null
  active_catalog_id?: string | null
  water_source_project_id?: string | null
  route_status?: 'stale' | 'blocked' | 'preliminary' | 'calculated' | null
  route_algorithm_version?: string | null
  route_input_hash?: string | null
  route_warnings?: string[] | null
  route_blockers?: Array<{ code?: string; message?: string; scope?: string }> | null
  route_report?: RouteStateReport | null
  route_calculated_at?: string | null
  network_revision?: number | null
}

interface RouteStateReport {
  synthetic?: boolean
  /** Проектный диаметр, записанный сборкой по съёмке: верх трубы отстоит от лотка ровно на него. */
  designDiameterMm?: number
  gravity?: { redLineCrossings?: number; utilityCrossings?: number; roadCrossings?: number; waterCrossings?: number; outsideCorridorSegments?: number }
  pressure?: { redLineCrossings?: number; utilityCrossings?: number; roadCrossings?: number; waterCrossings?: number; outsideCorridorSegments?: number }
  quality?: { totalLengthM?: number; routedTerminals?: number; outsideCorridorSegments?: number }
}

const SYSTEM_MARKS: Record<string, string> = { water: 'В1', sewer: 'К1', storm: 'К2' }

export function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [datasets, setDatasets] = useState<Partial<Record<DatasetKind, DatasetRow>>>({})
  const [datasetsLoadError, setDatasetsLoadError] = useState<string | null>(null)
  const [coreLoadError, setCoreLoadError] = useState<string | null>(null)
  const [buildings, setBuildings] = useState<BuildingRow[]>([])
  const [nodes, setNodes] = useState<NodeRow[]>([])
  const [pipes, setPipes] = useState<PipeRow[]>([])
  const [lastRun, setLastRun] = useState<SizingResult | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'notFound' | 'loadError'>('loading')
  const [demoBusy, setDemoBusy] = useState(false)
  const [demoChoiceOpen, setDemoChoiceOpen] = useState(false)
  const [realObjectShown, setRealObjectShown] = useState(false)
  const [demoNotice, setDemoNotice] = useState<'demoDone' | 'demoError' | null>(null)
  const [demoFailures, setDemoFailures] = useState<string[]>([])
  const [demoStage, setDemoStage] = useState<string | null>(null)
  const [demoCanCancel, setDemoCanCancel] = useState(false)
  const demoCancelRef = useRef<(() => void) | null>(null)
  const [pipelineBusy, setPipelineBusy] = useState(false)
  const [pipelineDetail, setPipelineDetail] = useState<string | null>(null)
  const [gravityRunRequest, setGravityRunRequest] = useState<{ projectId: string; sequence: number } | null>(null)
  const [pipelineNotice, setPipelineNotice] = useState<
    'done' | 'error' | 'migrationNeeded' | 'needData' | 'hydraulicsFailed' | 'wrongSystem' | null
  >(null)
  const [parcels, setParcels] = useState<ParcelRow[]>([])
  const [catalogs, setCatalogs] = useState<CatalogRow[]>([])
  const [existing, setExisting] = useState<ExistingPipeRow[]>([])
  const [boreholes, setBoreholes] = useState<Borehole[]>([])
  const [violationPipeIds, setViolationPipeIds] = useState<string[] | null>(null)
  const loadSequenceRef = useRef(0)
  const loadedProjectIdRef = useRef<string | null>(null)
  const datasetsProjectIdRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const requestId = ++loadSequenceRef.current
    const isCurrentRequest = () => loadSequenceRef.current === requestId
    if (loadedProjectIdRef.current !== id) {
      // React Router may reuse this component for another project. Clear the
      // previous snapshot before the first request for the new id finishes so
      // data from project A can never be rendered or saved into project B.
      setState('loading')
      setProject(null)
      setDatasets({})
      setDatasetsLoadError(null)
      setCoreLoadError(null)
      setBuildings([])
      setNodes([])
      setPipes([])
      setLastRun(null)
      setParcels([])
      setCatalogs([])
      setExisting([])
      setBoreholes([])
      datasetsProjectIdRef.current = null
    }
    const [projectRes, datasetsRes, buildingsRes, nodesRes, pipesRes, runRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('datasets')
        .select('*')
        .eq('project_id', id)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
        supabase
          .from('buildings')
          .select('*')
        .eq('project_id', id)
        .order('created_at', { ascending: true }),
        supabase
          .from('nodes')
          .select('*')
        .eq('project_id', id)
        .order('created_at', { ascending: true }),
        supabase
          .from('pipes')
          .select('*')
        .eq('project_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('calc_runs')
        .select('summary')
        .eq('project_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (!isCurrentRequest()) return
    if (projectRes.error) {
      setCoreLoadError(`Проект: ${formatAppError(projectRes.error)}`)
      setState(loadedProjectIdRef.current === id ? 'ready' : 'loadError')
      return
    }
    if (!projectRes.data) {
      loadedProjectIdRef.current = null
      datasetsProjectIdRef.current = null
      setState('notFound')
      return
    }
    loadedProjectIdRef.current = id
    setProject(projectRes.data)
    const coreErrors: string[] = []
    if (datasetsRes.error) {
      // Do not turn a failed SELECT into an empty project. Keeping the last
      // successfully loaded snapshot prevents every uploaded file from
      // visually disappearing during a transient Supabase/PostgREST failure.
      // A snapshot from a different project is never retained.
      if (datasetsProjectIdRef.current !== id) {
        setDatasets({})
        datasetsProjectIdRef.current = null
      }
      setDatasetsLoadError(formatAppError(datasetsRes.error))
    } else {
      setDatasetsLoadError(null)
      const map: Partial<Record<DatasetKind, DatasetRow>> = {}
      for (const row of (datasetsRes.data ?? []) as DatasetRow[]) {
        // Rows are ordered oldest -> newest, so legacy duplicates resolve to
        // the latest saved value until the uniqueness migration is applied.
        map[row.kind] = row
      }
      setDatasets(map)
      datasetsProjectIdRef.current = id
    }
    if (buildingsRes.error) coreErrors.push(`Здания: ${formatAppError(buildingsRes.error)}`)
    else setBuildings(buildingsRes.data ?? [])
    if (nodesRes.error) coreErrors.push(`Узлы сети: ${formatAppError(nodesRes.error)}`)
    else setNodes((nodesRes.data ?? []) as NodeRow[])
    if (pipesRes.error) coreErrors.push(`Участки сети: ${formatAppError(pipesRes.error)}`)
    else setPipes((pipesRes.data ?? []) as PipeRow[])
    // Gravity (К1/К2) runs share calc_runs; keep lastRun for the water pressure
    // result only, so the water panels never receive a gravity summary.
    if (runRes.error) coreErrors.push(`Последний расчёт: ${formatAppError(runRes.error)}`)
    else {
      const summary = runRes.data?.summary as (SizingResult & { kind?: string }) | null
      setLastRun(summary && summary.kind !== 'gravity' ? summary : null)
    }
    try {
      const rows = await fetchParcels(id)
      if (!isCurrentRequest()) return
      setParcels(rows)
    } catch (error) {
      if (!isCurrentRequest()) return
      coreErrors.push(`Земельные участки: ${formatAppError(error)}`)
    }
    try {
      const rows = await fetchCatalogs(id)
      if (!isCurrentRequest()) return
      setCatalogs(rows)
    } catch (error) {
      if (!isCurrentRequest()) return
      coreErrors.push(`Каталоги: ${formatAppError(error)}`)
    }
    try {
      const rows = await fetchExisting(id)
      if (!isCurrentRequest()) return
      setExisting(rows)
    } catch (error) {
      if (!isCurrentRequest()) return
      coreErrors.push(`Существующая сеть: ${formatAppError(error)}`)
    }
    try {
      const rows = await fetchGeology(id)
      if (!isCurrentRequest()) return
      setBoreholes(rows)
    } catch (error) {
      if (!isCurrentRequest()) return
      coreErrors.push(`Инженерная геология: ${formatAppError(error)}`)
    }
    if (!isCurrentRequest()) return
    setCoreLoadError(coreErrors.length > 0 ? coreErrors.join(' · ') : null)
    setState('ready')
  }, [id])

  useEffect(() => {
    void load()
    return () => {
      // Invalidate an in-flight request when the route changes or unmounts.
      loadSequenceRef.current += 1
    }
  }, [load])

  useEffect(() => {
    void syncNormRegistry()
    void syncRegions()
  }, [])

  const loadDemo = async (): Promise<boolean> => {
    if (!id || demoBusy) return false
    if (coreLoadError || datasetsLoadError) {
      setDemoFailures([
        'Безопасная загрузка демо остановлена: не удалось подтвердить, что проект пуст. Сначала повторите загрузку данных проекта.',
      ])
      setDemoNotice('demoError')
      return false
    }
    const demoTarget = classifySyntheticDemoTarget({
      routeReport: project?.route_report,
      routeStatus: project?.route_status,
      basisContent: datasets.basis?.content,
      datasetKinds: Object.keys(datasets),
      buildingCount: buildings.length,
      nodeCount: nodes.length,
      pipeCount: pipes.length,
      parcelCount: parcels.length,
      catalogCount: catalogs.length,
      boreholeCount: boreholes.length,
    })
    if (demoTarget === 'real') {
      setDemoFailures([
        'Безопасная загрузка демо остановлена: в проекте есть реальные исходные данные. Создайте новый пустой проект для синтетического демо — текущая схема Supabase не позволяет атомарно откатить замену всех разделов.',
      ])
      setDemoNotice('demoError')
      return false
    }
    const hasAnyCurrentData = Object.keys(datasets).length > 0
      || buildings.length > 0 || nodes.length > 0 || pipes.length > 0
      || parcels.length > 0 || catalogs.length > 0 || boreholes.length > 0
    if (hasAnyCurrentData && !window.confirm(
      demoTarget === 'synthetic'
        ? 'Пересоздать уже загруженное синтетическое демо? Учебные данные, расчёт и файлы демо будут заменены новой версией.'
        : 'Заменить выбранные настройки пустого проекта синтетическим демо?',
    )) return false
    setDemoBusy(true)
    setDemoNotice(null)
    setDemoFailures([])
    setPipelineNotice(null)
    setPipelineDetail(null)
    try {
      const { DEMO_STORM_PROJECT_NAME, seedStormProject } = await import('../shared/stormDemo')
      const result = await seedStormProject(id, {
        onRouteProgress: setDemoStage,
        onRouteCancelReady: (cancel) => {
          demoCancelRef.current = cancel
          setDemoCanCancel(Boolean(cancel))
        },
      })
      if (result.failures.length > 0) {
        await load()
        setDemoFailures(result.failures)
        setDemoNotice('demoError')
        return false
      }
      const update = await supabase
        .from('projects')
        .update({ name: DEMO_STORM_PROJECT_NAME, system_type: 'storm', work_type: 'new' })
        .eq('id', id)
      if (update.error) throw update.error
      await load()
      setDemoNotice('demoDone')
      return true
    } catch (error) {
      await load().catch(() => undefined)
      setDemoFailures([`demo: ${formatAppError(error)}`])
      setDemoNotice('demoError')
      return false
    } finally {
      demoCancelRef.current = null
      setDemoCanCancel(false)
      setDemoStage(null)
      setDemoBusy(false)
    }
  }

  /**
   * Загрузка настоящего объекта. Отдельно от синтетического демо: там сеть
   * выдумана и её не жаль, здесь данные объекта, и замена уже введённого
   * подтверждается тем же вопросом, что и в демо.
   */
  const loadRealObject = async (): Promise<boolean> => {
    if (!id || demoBusy) return false
    const hasAnyCurrentData = Object.keys(datasets).length > 0
      || buildings.length > 0 || nodes.length > 0 || pipes.length > 0
    if (hasAnyCurrentData && !window.confirm(t('project.demoChoice.replaceConfirm'))) return false
    setDemoBusy(true)
    setDemoNotice(null)
    setDemoFailures([])
    try {
      const { STANKEVICHA_PROJECT_NAME, seedStankevichaProject } = await import('../shared/stankevichaSeed')
      const result = await seedStankevichaProject(id)
      if (result.failures.length > 0) {
        await load()
        setDemoFailures(result.failures)
        setDemoNotice('demoError')
        return false
      }
      const update = await supabase
        .from('projects')
        .update({ name: STANKEVICHA_PROJECT_NAME, system_type: 'sewer', work_type: 'reconstruction' })
        .eq('id', id)
      if (update.error) throw update.error
      await load()
      setRealObjectShown(true)
      setDemoNotice('demoDone')
      return true
    } catch (error) {
      await load().catch(() => undefined)
      setDemoFailures([`объект: ${formatAppError(error)}`])
      setDemoNotice('demoError')
      return false
    } finally {
      setDemoBusy(false)
    }
  }

  const runPipeline = async (): Promise<void> => {
    if (!id || pipelineBusy) return
    setPipelineBusy(true)
    setPipelineNotice(null)
    setPipelineDetail(null)
    try {
      const [freshProjectRes, buildingsRes, datasetsRes] = await Promise.all([
        supabase
          .from('projects')
          .select('system_type,active_catalog_id')
          .eq('id', id)
          .maybeSingle(),
        supabase.from('buildings').select('id,x,y,floors,residents,specific_demand_lpd').eq('project_id', id),
        supabase.from('datasets').select('kind,content').eq('project_id', id),
      ])
      if (freshProjectRes.error) throw freshProjectRes.error
      if (!isPressurePipelineSystem(freshProjectRes.data?.system_type)) {
        setPipelineNotice('wrongSystem')
        return
      }
      const freshBuildings = buildingsRes.data ?? []
      const ds: Partial<Record<DatasetKind, { content: unknown }>> = {}
      for (const row of (datasetsRes.data ?? []) as Array<{ kind: DatasetKind; content: unknown }>) {
        ds[row.kind] = { content: row.content }
      }
      const source = ds.source?.content as SourceData | undefined
      const geology = ds.geology?.content as GeologyInput | undefined
      const seismicity = ds.seismic?.content as SeismicInput | undefined
      if (freshBuildings.length === 0 || !source || !geology || !seismicity) {
        setPipelineNotice('needData')
        return
      }
      const norms = {
        ...NORMATIVE_DEFAULTS,
        ...((ds.normative?.content ?? {}) as Partial<typeof NORMATIVE_DEFAULTS>),
      }
      const surveyPoints = (ds.topography?.content as { points?: EngineSurveyPoint[] } | undefined)?.points ?? []
      const result = await runFullPipeline({
        projectId: id,
        systemType: 'water',
        buildings: freshBuildings.map((b) => ({
          id: b.id,
          x: b.x,
          y: b.y,
          floors: b.floors,
          residents: b.residents ?? 0,
          specificDemandLpd: b.specific_demand_lpd ?? undefined,
        })),
        // Напор источника не подставляется: 45 м были выдуманной величиной, на
        // которой стоял весь подбор диаметров.
        source: { x: source.x, y: source.y, availableHead: source.availableHead as number },
        surveyPoints,
        norms,
        geology,
        seismicity,
        isoTimestamp: new Date().toISOString(),
        activeCatalogId: freshProjectRes.data.active_catalog_id ?? null,
      })
      setPipelineNotice(result.ok ? 'done' : result.reason)
      // Подробность ошибки конвейера. Сбрасывается и при успехе, и когда её
      // нет: иначе на экране осталась бы причина прошлого запуска.
      setPipelineDetail(result.ok ? null : result.detail ?? null)
      await load()
    } catch (error) {
      setPipelineDetail(formatAppError(error))
      setPipelineNotice('error')
    } finally {
      setPipelineBusy(false)
    }
  }

  const requestGravityPipeline = (): void => {
    if (!id || pipelineBusy) return
    setPipelineBusy(true)
    setPipelineNotice(null)
    setPipelineDetail(null)
    setGravityRunRequest((current) => ({
      projectId: id,
      sequence: current?.projectId === id ? current.sequence + 1 : 1,
    }))
  }

  const runProjectPipeline = async (): Promise<void> => {
    if (projectPipelineMode(project?.system_type) === 'gravity') {
      requestGravityPipeline()
      return
    }
    await runPipeline()
  }

  const demoAndRun = async (): Promise<void> => {
    // loadDemo deliberately creates a K2 gravity project. Its calculation is
    // derived by GravitySection after reload; running the B1/EPANET pipeline
    // here would reinterpret the outfall as a zero-head water reservoir.
    if (await loadDemo()) requestGravityPipeline()
  }

  const gravityPipelineFinished = useCallback((outcome: 'done' | 'needData' | 'error', detail?: string) => {
    setPipelineBusy(false)
    setPipelineNotice(outcome)
    setPipelineDetail(detail ?? null)
  }, [])

  const topoPoints = useMemo<SurveyPoint[]>(() => {
    const content = datasets.topography?.content as { points?: SurveyPoint[] } | null | undefined
    return content?.points ?? []
  }, [datasets.topography])

  // Просвет в карточке пересечения считается от верха трубы, поэтому нужен
  // проектный диаметр. Его записывает сборка по съёмке; при импорте чертежа
  // его нет, и просвет тогда честно не считается.
  const designDiameterForCrossings = project?.route_report?.designDiameterMm

  const sourceData = (datasets.source?.content ?? null) as SourceData | null

  const parcelsChanged = useCallback(async () => {
    if (!id) return
    const rows = await fetchParcels(id)
    await autoAssignParcels(rows, buildings.map((b) => ({ id: b.id, x: b.x, y: b.y })))
    setViolationPipeIds(null)
    await load()
  }, [id, buildings, load])

  const checkViolations = useCallback(() => {
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    const buildingIdByNode = new Map(nodes.filter((n) => n.building_id).map((n) => [n.id, n.building_id as string]))
    const violationInputs: ViolationPipe[] = []
    for (const pipe of pipes) {
      const a = nodeById.get(pipe.from_node)
      const b = nodeById.get(pipe.to_node)
      if (!a || !b) continue
      violationInputs.push({
        id: pipe.meta?.engineId ?? pipe.id,
        kind: pipe.meta?.kind ?? 'main',
        a: { x: a.x, y: a.y },
        b: { x: b.x, y: b.y },
        buildingId: buildingIdByNode.get(pipe.to_node) ?? buildingIdByNode.get(pipe.from_node),
      })
    }
    const violations = analyzeParcelViolations(violationInputs, parcelPolygons(parcels))
    setViolationPipeIds([...new Set(violations.map((v) => v.pipeId))])
  }, [nodes, pipes, parcels])

  const violationCount = violationPipeIds?.length ?? null

  const designedLengthM = useMemo(
    () => pipes.reduce((sum, p) => sum + (p.length_m ?? 0), 0),
    [pipes],
  )

  const systemType = project?.system_type ?? 'water'
  const workType = project?.work_type ?? 'new'
  const isWater = systemType === 'water'
  const isSewer = systemType === 'sewer'
  const isStorm = systemType === 'storm'
  const effectiveRouteStatus = (isSewer || isStorm)
    ? resolveRouteFreshness({
      storedStatus: project?.route_status,
      storedAlgorithmVersion: project?.route_algorithm_version,
      currentAlgorithmVersion: ROUTE_ALGORITHM_VERSION,
      storedInputHash: project?.route_input_hash,
    }).status
    : project?.route_status ?? 'stale'
  const isReconstruction = workType === 'reconstruction'

  if (state === 'loading') return null

  if (state === 'loadError') {
    return (
      <section className="page">
        <div className="container">
          <h1>{t('project.page.loadFailed')}</h1>
          <p className="notice error" role="alert">{coreLoadError ?? 'Сервис данных временно недоступен.'}</p>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>{t('project.page.retry')}</button>
        </div>
      </section>
    )
  }

  if (state === 'notFound' || !project) {
    return (
      <section className="page">
        <div className="container">
          <h1>{t('project.notFound')}</h1>
          <p style={{ marginTop: 16 }}>
            <Link to="/app" style={{ color: 'var(--accent)' }}>
              {t('project.back')}
            </Link>
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="page">
      <div className="container">
        <p>
          <Link to="/app" className="back-link">
            {t('project.back')}
          </Link>
        </p>
        <div className="project-head">
          <div>
            <h1>{project.name}</h1>
            <p style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <span className="badge">{t(`wizard.workType.${workType}`)}</span>
              <span className="badge ok">
                {SYSTEM_MARKS[systemType]} · {t(`wizard.systemType.${systemType}`)}
              </span>
            </p>
          </div>
          <div className="project-head-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={demoBusy || pipelineBusy}
              onClick={() => void demoAndRun()}
            >
              {pipelineBusy || demoBusy ? t('project.pipeline.running') : t('project.pipeline.demoRun')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={demoBusy || pipelineBusy}
              onClick={() => void runProjectPipeline()}
            >
              {t('project.pipeline.run')}
            </button>
            <button
              type="button"
              className={`btn btn-ghost btn-sm${demoBusy ? ' is-loading' : ''}`}
              disabled={demoBusy || pipelineBusy}
              aria-busy={demoBusy}
              aria-expanded={demoChoiceOpen}
              onClick={() => setDemoChoiceOpen((open) => !open)}
            >
              {demoBusy && <span className="button-spinner" aria-hidden="true" />}
              {demoBusy ? 'Загрузка проекта…' : t('project.demo')}
            </button>
          </div>
        </div>
        {/*
          Выбор источника демонстрации. Второй вариант читает файлы объекта, а
          не хранит их: данные реального объекта в репозиторий не попадают, и
          демо-набор ими не заполняется.
        */}
        {demoChoiceOpen && !demoBusy && (
          <div className="section-actions" role="group" aria-label={t('project.demoChoice.title')}>
            <button
              type="button"
              className="btn btn-sm"
              disabled={demoBusy || pipelineBusy}
              onClick={() => { setDemoChoiceOpen(false); void loadDemo() }}
            >
              {t('project.demoChoice.synthetic')}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={demoBusy || pipelineBusy}
              onClick={() => { setDemoChoiceOpen(false); void loadRealObject() }}
            >
              {t('project.demoChoice.realObject')}
            </button>
          </div>
        )}
        {realObjectShown && (
          <div className="panel" style={{ marginTop: 12 }}>
            <h4>{t('project.stankevicha.title')}</h4>
            <StankevichaDemoView />
          </div>
        )}
        {demoChoiceOpen && !demoBusy && <p className="hint">{t('project.demoChoice.hint')}</p>}
        <p className="hint">{t('project.pipeline.hint')}</p>
        {datasetsLoadError && (
          <p className="notice error" role="alert">
            Не удалось прочитать сохранённые данные проекта: {datasetsLoadError}
          </p>
        )}
        {coreLoadError && (
          <p className="notice error" role="alert">
            Часть данных не обновилась; показана последняя успешная версия: {coreLoadError}
          </p>
        )}
        {demoBusy && (
          <div className="export-progress" role="status" aria-live="polite">
            <span className="export-progress-spinner" aria-hidden="true" />
            <div className="export-progress-copy">
              <strong>{demoStage ?? 'Загружается синтетическая учебная модель'}</strong>
              <span>{t('project.page.fullSet')}</span>
            </div>
            {demoCanCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={() => demoCancelRef.current?.()}>{t('project.page.cancelRun')}</button>}
            <span className="export-progress-bar" aria-hidden="true"><i /></span>
          </div>
        )}
        {demoNotice === 'demoError' && <p className="notice error">{t('project.demoError')}</p>}
        {demoNotice === 'demoDone' && <p className="notice info">{t('project.demoDone')}</p>}
        {demoFailures.length > 0 && (
          <p className="notice error">Не загрузились разделы: {demoFailures.join(', ')}</p>
        )}
        {pipelineNotice && (
          <p className={`notice ${pipelineNotice === 'done' ? 'info' : 'error'}`}>
            {t(`project.pipeline.${pipelineNotice}`)}{pipelineDetail ? `: ${pipelineDetail}` : ''}
          </p>
        )}
        <div className="panels">
          <BasisSection projectId={project.id} dataset={datasets.basis} onSaved={load} />
          <ParcelsSection
            projectId={project.id}
            parcels={parcels}
            buildings={buildings}
            violationCount={violationCount}
            onChanged={parcelsChanged}
            onCheck={checkViolations}
          />
          {isReconstruction && (
            <ExistingNetworkSection
              projectId={project.id}
              existing={existing}
              points={topoPoints}
              designedLengthM={designedLengthM}
              onChanged={load}
            />
          )}
          {isReconstruction && (isSewer || isStorm) && (
            <>
              {/* Разбор ТУ стоит первым: из него берутся величины, которые
                  секция реконструкции иначе спрашивает у инженера. */}
              <TuImportSection
                projectId={project.id}
                conditionsDataset={datasets.technical_conditions}
                onSaved={load}
              />
              <ReconstructionSurveySection
                projectId={project.id}
                system={isStorm ? 'storm' : 'sewer'}
                conditionsDataset={datasets.technical_conditions}
                onSaved={load}
              />
            </>
          )}
          {/*
            Прогон комплекта исходных данных: что программа выдаст на съёмке
            реального объекта и чем это отличается от документов. Стоит рядом с
            реконструкцией, потому что отвечает на тот же вопрос — что удалось
            восстановить из съёмки, а что нет.
          */}
          {(isSewer || isStorm) && (
            <div id="source-bundle-run"><SourceBundleRunSection conditionsDataset={datasets.technical_conditions} onSaved={load} projectId={project.id} /></div>
          )}
          {(isSewer || isStorm) && (
            <>
              <ImportSection
                projectId={project.id}
                buildings={buildings}
                source={sourceData}
                points={topoPoints}
                existingNodes={nodes.length}
                existingPipes={pipes}
                systemType={isStorm ? 'storm' : 'sewer'}
                onChanged={load}
              />
            </>
          )}
          {isSewer && (
            <>
              <DrainageSection
                projectId={project.id}
                buildings={buildings}
                normsDataset={datasets.normative}
                drainageDataset={datasets.drainage}
                waterSourceProjectId={project.water_source_project_id ?? null}
                onChanged={load}
              />
              <GravitySection
                projectId={project.id}
                systemType="sewer"
                projectName={project.name}
                buildings={buildings}
                nodes={nodes}
                pipes={pipes}
                normsDataset={datasets.normative}
                geologyDataset={datasets.geology}
                drainageDataset={datasets.drainage}
                topographyDataset={datasets.topography}
              verticalPlanDataset={datasets.vertical_plan}
              gravityBasinsDataset={datasets.gravity_basins}
              pumpCatalogDataset={datasets.pump_catalog}
              conditionsDataset={datasets.technical_conditions}
                constraintsDataset={datasets.route_constraints}
                routeAuditDataset={datasets.route_audit}
                manholeCatalogDataset={datasets.manhole_catalog}
                titleBlockDataset={datasets.title_block}
                masterPlanDataset={datasets.master_plan}
                boreholes={boreholes}
                parcels={parcels}
                activeCatalogId={project.active_catalog_id ?? null}
                routeStatus={effectiveRouteStatus}
                routeBlockers={project.route_blockers ?? []}
                routeRevision={project.network_revision ?? 0}
                runRequest={gravityRunRequest?.projectId === project.id ? gravityRunRequest.sequence : 0}
                onRunComplete={gravityPipelineFinished}
              />
            </>
          )}
          {isStorm && (
            <GravitySection
              projectId={project.id}
              systemType="storm"
              projectName={project.name}
              buildings={buildings}
              nodes={nodes}
              pipes={pipes}
              normsDataset={datasets.normative}
              geologyDataset={datasets.geology}
              drainageDataset={datasets.drainage}
              topographyDataset={datasets.topography}
              verticalPlanDataset={datasets.vertical_plan}
              gravityBasinsDataset={datasets.gravity_basins}
              pumpCatalogDataset={datasets.pump_catalog}
              conditionsDataset={datasets.technical_conditions}
              constraintsDataset={datasets.route_constraints}
              routeAuditDataset={datasets.route_audit}
              manholeCatalogDataset={datasets.manhole_catalog}
              titleBlockDataset={datasets.title_block}
              masterPlanDataset={datasets.master_plan}
              boreholes={boreholes}
              parcels={parcels}
              activeCatalogId={project.active_catalog_id ?? null}
              routeStatus={effectiveRouteStatus}
              routeBlockers={project.route_blockers ?? []}
              routeRevision={project.network_revision ?? 0}
              runRequest={gravityRunRequest?.projectId === project.id ? gravityRunRequest.sequence : 0}
              onRunComplete={gravityPipelineFinished}
            />
          )}
          {(isSewer || isStorm) && (
            <SituationSchemeSection
              projectId={project.id}
              systemType={isStorm ? 'storm' : 'sewer'}
              buildings={buildings}
              nodes={nodes}
              pipes={pipes}
              geologyDataset={datasets.geology}
              basisDataset={datasets.basis}
              topographyDataset={datasets.topography}
              constraintsDataset={datasets.route_constraints}
              routeAuditDataset={datasets.route_audit}
              sourceDataset={datasets.source}
              pumpCatalogDataset={datasets.pump_catalog}
              conditionsDataset={datasets.technical_conditions}
              parcels={parcels}
              activeCatalogId={project.active_catalog_id ?? null}
              routeState={{
                status: effectiveRouteStatus,
                algorithmVersion: project.route_algorithm_version ?? null,
                inputHash: project.route_input_hash ?? null,
                calculatedAt: project.route_calculated_at ?? null,
                blockers: project.route_blockers ?? [],
                warnings: project.route_warnings ?? [],
                revision: project.network_revision ?? 0,
                report: project.route_report ?? undefined,
              }}
              onChanged={load}
            />
          )}
          {isWater && (
            <>
              <ImportSection
                projectId={project.id}
                buildings={buildings}
                source={sourceData}
                points={topoPoints}
                existingNodes={nodes.length}
                existingPipes={pipes}
                systemType="water"
                onChanged={load}
              />
              <TraceSection
                projectId={project.id}
                buildings={buildings}
                source={sourceData}
                points={topoPoints}
                nodes={nodes}
                pipes={pipes}
                onChanged={load}
              />
              <HydraulicsSection
                projectId={project.id}
                buildings={buildings}
                source={sourceData}
                normsDataset={datasets.normative}
                nodes={nodes}
                pipes={pipes}
                lastSummary={lastRun}
                activeCatalogId={project.active_catalog_id ?? null}
                surveyPoints={topoPoints}
                onChanged={load}
              />
              <ResultsSection lastRun={lastRun} nodes={nodes} buildings={buildings} />
              <ExportSection
                projectId={project.id}
                projectName={project.name}
                workType={workType as 'new' | 'reconstruction'}
                systemType={systemType as 'water' | 'sewer' | 'storm'}
                buildings={buildings}
                nodes={nodes}
                pipes={pipes}
                datasets={datasets}
                boreholes={boreholes}
                lastRun={lastRun}
              />
              <EquipmentSection
                projectId={project.id}
                geologyDataset={datasets.geology}
                seismicDataset={datasets.seismic}
                equipmentDataset={datasets.equipment}
                nodes={nodes}
                pipes={pipes}
                lastRun={lastRun}
                onChanged={load}
              />
              <CatalogSection
                projectId={project.id}
                catalogs={catalogs}
                activeCatalogId={project.active_catalog_id ?? null}
                onChanged={load}
              />
            </>
          )}
          <TopographySection projectId={project.id} dataset={datasets.topography} verticalPlanDataset={datasets.vertical_plan} onSaved={load} />
          {!isWater && (
            <>
              <CatalogSection
                projectId={project.id}
                catalogs={catalogs}
                activeCatalogId={project.active_catalog_id ?? null}
                onChanged={load}
              />
              <ManholeCatalogSection projectId={project.id} dataset={datasets.manhole_catalog} onSaved={load} />
              <PumpCatalogSection projectId={project.id} dataset={datasets.pump_catalog} onSaved={load} />
            </>
          )}
          <BuildingsSection
            projectId={project.id}
            buildings={buildings}
            onChanged={load}
            mode={isStorm ? 'inflows' : 'buildings'}
          />
          <SourceSection projectId={project.id} dataset={datasets.source} onSaved={load} />
          <RegionSection
            projectId={project.id}
            dataset={datasets.region}
            seismicDataset={datasets.seismic}
            geologyDataset={datasets.geology}
            source={sourceData}
            onSaved={load}
          />
          <GeologySection
            projectId={project.id}
            dataset={datasets.geology}
            boreholes={boreholes}
            surveyPoints={topoPoints}
            onChanged={load}
          />
          <SeismicSection projectId={project.id} dataset={datasets.seismic} onSaved={load} />
          <DeliverablesSection
            projectId={project.id}
            constraintsDataset={datasets.route_constraints}
            onSaved={load}
          />
          <CrossingsSection
            projectId={project.id}
            constraintsDataset={datasets.route_constraints}
            designDiameterMm={designDiameterForCrossings}
            onSaved={load}
          />
          <NormsSection projectId={project.id} dataset={datasets.normative} onSaved={load} />
          {isWater && <DemandSection buildings={buildings} normsDataset={datasets.normative} />}
          <NormRegistrySection
            projectId={project.id}
            dataset={datasets.normative}
            onSaved={load}
          />
        </div>
      </div>
    </section>
  )
}
