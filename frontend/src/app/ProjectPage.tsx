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
import { fetchCatalogs } from '../shared/catalog'
import type { CatalogRow } from '../shared/catalog'
import { ExistingNetworkSection } from './project/ExistingNetworkSection'
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
import { NormRegistrySection } from './project/NormRegistrySection'
import { analyzeParcelViolations } from '@aquascheme/engine'
import type { ViolationPipe } from '@aquascheme/engine'
import { autoAssignParcels, fetchParcels, parcelPolygons } from '../shared/parcels'
import type { ParcelRow } from '../shared/parcels'
import type { SizingResult } from '@aquascheme/engine/sizing'

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
  const [buildings, setBuildings] = useState<BuildingRow[]>([])
  const [nodes, setNodes] = useState<NodeRow[]>([])
  const [pipes, setPipes] = useState<PipeRow[]>([])
  const [lastRun, setLastRun] = useState<SizingResult | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'notFound'>('loading')
  const [demoBusy, setDemoBusy] = useState(false)
  const [demoNotice, setDemoNotice] = useState<'demoDone' | 'demoError' | null>(null)
  const [demoFailures, setDemoFailures] = useState<string[]>([])
  const [demoStage, setDemoStage] = useState<string | null>(null)
  const [demoCanCancel, setDemoCanCancel] = useState(false)
  const demoCancelRef = useRef<(() => void) | null>(null)
  const [pipelineBusy, setPipelineBusy] = useState(false)
  const [pipelineNotice, setPipelineNotice] = useState<'done' | 'error' | 'migrationNeeded' | 'needData' | null>(null)
  const [parcels, setParcels] = useState<ParcelRow[]>([])
  const [catalogs, setCatalogs] = useState<CatalogRow[]>([])
  const [existing, setExisting] = useState<ExistingPipeRow[]>([])
  const [boreholes, setBoreholes] = useState<Borehole[]>([])
  const [violationPipeIds, setViolationPipeIds] = useState<string[] | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const [projectRes, datasetsRes, buildingsRes, nodesRes, pipesRes, runRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).maybeSingle(),
      supabase.from('datasets').select('*').eq('project_id', id),
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
    if (!projectRes.data) {
      setState('notFound')
      return
    }
    setProject(projectRes.data)
    const map: Partial<Record<DatasetKind, DatasetRow>> = {}
    for (const row of (datasetsRes.data ?? []) as DatasetRow[]) {
      map[row.kind] = row
    }
    setDatasets(map)
    setBuildings(buildingsRes.data ?? [])
    setNodes((nodesRes.data ?? []) as NodeRow[])
    setPipes((pipesRes.data ?? []) as PipeRow[])
    // Gravity (К1/К2) runs share calc_runs; keep lastRun for the water pressure
    // result only, so the water panels never receive a gravity summary.
    const summary = runRes.data?.summary as (SizingResult & { kind?: string }) | null
    setLastRun(summary && summary.kind !== 'gravity' ? summary : null)
    try {
      setParcels(await fetchParcels(id))
    } catch {
      setParcels([])
    }
    try {
      setCatalogs(await fetchCatalogs(id))
    } catch {
      setCatalogs([])
    }
    try {
      setExisting(await fetchExisting(id))
    } catch {
      setExisting([])
    }
    try {
      setBoreholes(await fetchGeology(id))
    } catch {
      setBoreholes([])
    }
    setState('ready')
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void syncNormRegistry()
    void syncRegions()
  }, [])

  const loadDemo = async (): Promise<boolean> => {
    if (!id || demoBusy) return false
    setDemoBusy(true)
    setDemoNotice(null)
    setDemoFailures([])
    try {
      const { REAL_STORM_PROJECT_NAME, seedStormProject } = await import('../shared/stormDemo')
      const update = await supabase
        .from('projects')
        .update({ name: REAL_STORM_PROJECT_NAME, system_type: 'storm', work_type: 'new' })
        .eq('id', id)
      if (update.error) throw update.error
      const result = await seedStormProject(id, {
        onRouteProgress: setDemoStage,
        onRouteCancelReady: (cancel) => {
          demoCancelRef.current = cancel
          setDemoCanCancel(Boolean(cancel))
        },
      })
      await load()
      if (result.failures.length > 0) {
        setDemoFailures(result.failures)
        setDemoNotice('demoError')
        return false
      }
      setDemoNotice('demoDone')
      return true
    } catch {
      setDemoNotice('demoError')
      return false
    } finally {
      demoCancelRef.current = null
      setDemoCanCancel(false)
      setDemoStage(null)
      setDemoBusy(false)
    }
  }

  const runPipeline = async (): Promise<void> => {
    if (!id || pipelineBusy) return
    setPipelineBusy(true)
    setPipelineNotice(null)
    try {
      const [buildingsRes, datasetsRes] = await Promise.all([
        supabase.from('buildings').select('id,x,y,floors,residents,specific_demand_lpd').eq('project_id', id),
        supabase.from('datasets').select('kind,content').eq('project_id', id),
      ])
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
        buildings: freshBuildings.map((b) => ({
          id: b.id,
          x: b.x,
          y: b.y,
          floors: b.floors,
          residents: b.residents ?? 0,
          specificDemandLpd: b.specific_demand_lpd ?? undefined,
        })),
        source: { x: source.x, y: source.y, availableHead: source.availableHead ?? 45 },
        surveyPoints,
        norms,
        geology,
        seismicity,
        isoTimestamp: new Date().toISOString(),
        activeCatalogId: project?.active_catalog_id ?? null,
      })
      setPipelineNotice(result.ok ? 'done' : result.reason)
      await load()
    } catch {
      setPipelineNotice('error')
    } finally {
      setPipelineBusy(false)
    }
  }

  const demoAndRun = async (): Promise<void> => {
    const ok = await loadDemo()
    if (ok && project?.system_type === 'water') await runPipeline()
  }

  const topoPoints = useMemo<SurveyPoint[]>(() => {
    const content = datasets.topography?.content as { points?: SurveyPoint[] } | null | undefined
    return content?.points ?? []
  }, [datasets.topography])

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
              disabled={demoBusy || pipelineBusy || !isWater}
              onClick={() => void demoAndRun()}
            >
              {pipelineBusy || demoBusy ? t('project.pipeline.running') : t('project.pipeline.demoRun')}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={demoBusy || pipelineBusy || !isWater}
              onClick={() => void runPipeline()}
            >
              {t('project.pipeline.run')}
            </button>
            <button
              type="button"
              className={`btn btn-ghost btn-sm${demoBusy ? ' is-loading' : ''}`}
              disabled={demoBusy || pipelineBusy}
              aria-busy={demoBusy}
              onClick={() => void loadDemo()}
            >
              {demoBusy && <span className="button-spinner" aria-hidden="true" />}
              {demoBusy ? 'Загрузка проекта…' : t('project.demo')}
            </button>
          </div>
        </div>
        <p className="hint">{t('project.pipeline.hint')}</p>
        {demoBusy && (
          <div className="export-progress" role="status" aria-live="polite">
            <span className="export-progress-spinner" aria-hidden="true" />
            <div className="export-progress-copy">
              <strong>{demoStage ?? 'Загружаются данные проекта 2024-51-НК'}</strong>
              <span>Полный набор отметок DWG, ограничения, ОС, ЛНС, геология, каталог и расчётная трасса</span>
            </div>
            {demoCanCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={() => demoCancelRef.current?.()}>Отменить расчёт</button>}
            <span className="export-progress-bar" aria-hidden="true"><i /></span>
          </div>
        )}
        {demoNotice === 'demoError' && <p className="notice error">{t('project.demoError')}</p>}
        {demoFailures.length > 0 && (
          <p className="notice error">Не загрузились разделы: {demoFailures.join(', ')}</p>
        )}
        {pipelineNotice && (
          <p className={`notice ${pipelineNotice === 'done' ? 'info' : 'error'}`}>
            {t(`project.pipeline.${pipelineNotice}`)}
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
                basisDataset={datasets.basis}
                parcels={parcels}
                activeCatalogId={project.active_catalog_id ?? null}
                routeStatus={effectiveRouteStatus}
                onChanged={load}
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
              basisDataset={datasets.basis}
              parcels={parcels}
              activeCatalogId={project.active_catalog_id ?? null}
              routeStatus={effectiveRouteStatus}
              onChanged={load}
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
          <TopographySection projectId={project.id} dataset={datasets.topography} onSaved={load} />
          {!isWater && (
            <CatalogSection
              projectId={project.id}
              catalogs={catalogs}
              activeCatalogId={project.active_catalog_id ?? null}
              onChanged={load}
            />
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
            onChanged={load}
          />
          <SeismicSection projectId={project.id} dataset={datasets.seismic} onSaved={load} />
          <NormsSection projectId={project.id} dataset={datasets.normative} onSaved={load} />
          {isWater && <DemandSection buildings={buildings} normsDataset={datasets.normative} />}
          <NormRegistrySection />
        </div>
      </div>
    </section>
  )
}
