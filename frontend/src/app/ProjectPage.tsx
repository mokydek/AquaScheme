import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createDemoDataset, localToLonLat, NORMATIVE_DEFAULTS } from '@aquascheme/engine'
import type { SurveyPoint } from '@aquascheme/engine'
import type { Feature, FeatureCollection } from 'geojson'
import { supabase } from '../shared/supabase'
import { saveDataset } from '../shared/datasets'
import type { BuildingRow, DatasetKind, DatasetRow } from '../shared/datasets'
import type { NodeRow, PipeRow } from '../shared/network'
import { runFullPipeline } from '../shared/pipeline'
import { buildingPreset, sourcePreset } from '@aquascheme/engine'
import type { GeologyInput, SeismicInput, SurveyPoint as EngineSurveyPoint } from '@aquascheme/engine'
import { TopographySection } from './project/TopographySection'
import { BuildingsSection } from './project/BuildingsSection'
import { GeologySection, NormsSection, SeismicSection, SourceSection } from './project/FormSections'
import { DemandSection } from './project/DemandSection'
import { ProjectMap } from './project/ProjectMap'
import type { SourceData } from './project/ProjectMap'
import { TraceSection } from './project/TraceSection'
import { HydraulicsSection } from './project/HydraulicsSection'
import { EquipmentSection } from './project/EquipmentSection'
import { ResultsSection } from './project/ResultsSection'
import { ExportSection } from './project/ExportSection'
import { ImportSection } from './project/ImportSection'
import { ObjectLibrary } from './project/ObjectLibrary'
import type { Placement } from './project/ObjectLibrary'
import { ParcelsSection } from './project/ParcelsSection'
import { Panel } from './project/Panel'
import { analyzeParcelViolations } from '@aquascheme/engine'
import type { ParcelKind, Vec2, ViolationPipe } from '@aquascheme/engine'
import {
  autoAssignParcels,
  fetchParcels,
  insertParcel,
  parcelPolygons,
} from '../shared/parcels'
import type { ParcelRow } from '../shared/parcels'
import type { SizingResult } from '@aquascheme/engine/sizing'

interface ProjectInfo {
  id: string
  name: string
  work_type?: string | null
  system_type?: string | null
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
  const [pipelineBusy, setPipelineBusy] = useState(false)
  const [pipelineNotice, setPipelineNotice] = useState<'done' | 'error' | 'migrationNeeded' | 'needData' | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const [parcels, setParcels] = useState<ParcelRow[]>([])
  const [parcelDraft, setParcelDraft] = useState<{ kind: ParcelKind; vertices: Vec2[] } | null>(null)
  const [violationPipeIds, setViolationPipeIds] = useState<string[] | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const [projectRes, datasetsRes, buildingsRes, nodesRes, pipesRes, runRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).maybeSingle(),
      supabase.from('datasets').select('*').eq('project_id', id),
      supabase
        .from('buildings')
        .select('id,label,x,y,floors,residents,specific_demand_lpd')
        .eq('project_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('nodes')
        .select('id,kind,label,x,y,ground_elevation,building_id,meta')
        .eq('project_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('pipes')
        .select('id,from_node,to_node,length_m,diameter_mm,material,meta')
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
    setLastRun((runRes.data?.summary ?? null) as SizingResult | null)
    try {
      setParcels(await fetchParcels(id))
    } catch {
      setParcels([])
    }
    setState('ready')
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const loadDemo = async (): Promise<boolean> => {
    if (!id || demoBusy) return false
    setDemoBusy(true)
    setDemoNotice(null)
    try {
      const demo = createDemoDataset()
      const zs = demo.surveyPoints.map((p) => p.z)
      await saveDataset(
        id,
        'topography',
        { points: demo.surveyPoints },
        {
          total: demo.surveyPoints.length,
          accepted: demo.surveyPoints.length,
          zMin: Math.min(...zs),
          zMax: Math.max(...zs),
        },
        'demo',
      )
      await supabase.from('buildings').delete().eq('project_id', id)
      const { error: insertError } = await supabase.from('buildings').insert(
        demo.buildings.map((b) => ({
          project_id: id,
          label: b.label,
          x: b.x,
          y: b.y,
          floors: b.floors,
          residents: b.residents,
        })),
      )
      if (insertError) throw insertError
      await saveDataset(id, 'source', demo.source)
      await saveDataset(id, 'geology', demo.geology)
      await saveDataset(id, 'seismic', demo.seismicity)
      await saveDataset(id, 'normative', { ...NORMATIVE_DEFAULTS })
      setDemoNotice('demoDone')
      await load()
      return true
    } catch {
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
    if (ok) await runPipeline()
  }

  const topoPoints = useMemo<SurveyPoint[]>(() => {
    const content = datasets.topography?.content as { points?: SurveyPoint[] } | null | undefined
    return content?.points ?? []
  }, [datasets.topography])

  const sourceData = (datasets.source?.content ?? null) as SourceData | null

  const nearestZ = useCallback(
    (x: number, y: number): number | undefined => {
      let best: SurveyPoint | undefined
      let bestDist = Number.POSITIVE_INFINITY
      for (const p of topoPoints) {
        const d = (p.x - x) ** 2 + (p.y - y) ** 2
        if (d < bestDist) {
          bestDist = d
          best = p
        }
      }
      return best?.z
    },
    [topoPoints],
  )

  const addBuildingAt = useCallback(
    async (x: number, y: number) => {
      if (!id) return
      await supabase.from('buildings').insert({
        project_id: id,
        label: `Д${buildings.length + 1}`,
        x,
        y,
        floors: 2,
        residents: 32,
      })
      await load()
    },
    [id, buildings.length, load],
  )

  const moveSourceTo = useCallback(
    async (x: number, y: number) => {
      if (!id) return
      const current = (datasets.source?.content ?? { availableHead: 45 }) as SourceData
      const groundElevation = nearestZ(x, y) ?? current.groundElevation ?? 0
      await saveDataset(id, 'source', { ...current, x, y, groundElevation })
      await load()
    },
    [id, datasets.source, nearestZ, load],
  )

  const placeObject = useCallback(
    (x: number, y: number) => {
      if (!id || !placement) return
      const groundElevation = nearestZ(x, y) ?? 0
      if (placement.type === 'building') {
        const preset = buildingPreset(placement.presetId)
        if (!preset) return
        const count = buildings.filter((b) => (b.label ?? '').startsWith(preset.labelPrefix)).length
        void supabase
          .from('buildings')
          .insert({
            project_id: id,
            label: `${preset.labelPrefix}${count + 1}`,
            x,
            y,
            floors: preset.defaultFloors,
            residents: preset.defaultUnits,
            ground_elevation: groundElevation,
            specific_demand_lpd: preset.specificDemandLpd,
          })
          .then(() => load())
      } else {
        const preset = sourcePreset(placement.presetId)
        if (!preset) return
        void saveDataset(id, 'source', {
          x,
          y,
          groundElevation,
          availableHead: preset.defaultAvailableHeadM,
        }).then(() => load())
      }
    },
    [id, placement, buildings, nearestZ, load],
  )

  const deleteBuilding = useCallback(
    async (buildingId: string) => {
      await supabase.from('buildings').delete().eq('id', buildingId)
      await load()
    },
    [load],
  )

  // Parcels: drawing and violation analysis.
  const startDraw = useCallback((kind: ParcelKind) => {
    setPlacement(null)
    setParcelDraft({ kind, vertices: [] })
  }, [])
  const drawVertex = useCallback((x: number, y: number) => {
    setParcelDraft((prev) => (prev ? { ...prev, vertices: [...prev.vertices, { x, y }] } : prev))
  }, [])
  const cancelDraw = useCallback(() => setParcelDraft(null), [])
  const finishDraw = useCallback(async () => {
    if (!id || !parcelDraft || parcelDraft.vertices.length < 3) return
    await insertParcel(id, parcelDraft.kind, parcelDraft.vertices, null)
    setParcelDraft(null)
    const rows = await fetchParcels(id)
    await autoAssignParcels(rows, buildings.map((b) => ({ id: b.id, x: b.x, y: b.y })))
    await load()
  }, [id, parcelDraft, buildings, load])

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

  const parcelsGeo = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: parcels.flatMap((row) => {
        const outer = row.geometry?.coordinates?.[0]
        if (!Array.isArray(outer)) return []
        return [
          {
            type: 'Feature' as const,
            properties: { kind: row.kind, id: row.id },
            geometry: {
              type: 'Polygon' as const,
              coordinates: [outer.map((c) => localToLonLat(c[0], c[1]))],
            },
          },
        ]
      }),
    }),
    [parcels],
  )

  const violationCount = violationPipeIds?.length ?? null

  const networkLines = useMemo<FeatureCollection>(() => {
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    const labelOf = (nid: string) => nodeById.get(nid)?.label ?? nid
    const features: Feature[] = []
    for (const pipe of pipes) {
      const a = nodeById.get(pipe.from_node)
      const b = nodeById.get(pipe.to_node)
      if (!a || !b) continue
      features.push({
        type: 'Feature',
        properties: {
          kind: pipe.meta?.kind ?? 'ring',
          engineId: pipe.meta?.engineId ?? pipe.id,
          title: `${labelOf(pipe.from_node)}–${labelOf(pipe.to_node)}`,
          length: pipe.length_m ?? 0,
          diameter: pipe.diameter_mm ?? null,
          flow: pipe.meta?.flowLps != null ? Math.abs(pipe.meta.flowLps) : null,
          velocity: pipe.meta?.velocityMs ?? null,
          headloss: pipe.meta?.headlossM ?? null,
        },
        geometry: {
          type: 'LineString',
          coordinates: [localToLonLat(a.x, a.y), localToLonLat(b.x, b.y)],
        },
      })
    }
    return { type: 'FeatureCollection', features }
  }, [nodes, pipes])

  const networkJunctions = useMemo<FeatureCollection>(() => {
    const FITTING_MARK: Record<string, string> = { hydrant: 'ПГ', valve: 'З', airValve: 'В', washout: 'ВП' }
    return {
      type: 'FeatureCollection',
      features: nodes
        .filter((n) => n.kind !== 'source' && !n.building_id)
        .map((n) => ({
          type: 'Feature',
          properties: {
            label: n.label ?? '',
            elevation: n.ground_elevation ?? null,
            head: n.meta?.headM ?? null,
            pressure: n.meta?.pressureM ?? null,
            well: n.meta?.wellLabel ?? '',
            marks: (n.meta?.fittings ?? []).map((f) => FITTING_MARK[f] ?? f).join(' '),
          },
          geometry: { type: 'Point', coordinates: localToLonLat(n.x, n.y) },
        })),
    }
  }, [nodes])

  const pressureByBuilding = useMemo(() => {
    const map: Record<string, { pressureM: number; ok: boolean; requiredPressureM: number | null }> = {}
    for (const n of nodes) {
      if (!n.building_id || n.meta?.pressureM == null) continue
      map[n.building_id] = {
        pressureM: n.meta.pressureM,
        ok: n.meta.ok ?? true,
        requiredPressureM: n.meta.requiredPressureM ?? null,
      }
    }
    return map
  }, [nodes])

  const problemsGeo = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: nodes
        .filter((n) => n.meta?.ok === false)
        .map((n) => ({
          type: 'Feature',
          properties: { label: n.label ?? '' },
          geometry: { type: 'Point', coordinates: localToLonLat(n.x, n.y) },
        })),
    }),
    [nodes],
  )

  const hasResults = pipes.some((p) => p.meta?.velocityMs != null)

  const FITTING_MARKS: Record<string, string> = { hydrant: 'ПГ', valve: 'З', airValve: 'В', washout: 'ВП' }
  const fittingsGeo = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: nodes
        .filter((n) => (n.meta?.fittings?.length ?? 0) > 0 || n.meta?.wellLabel)
        .map((n) => {
          const marks = (n.meta?.fittings ?? []).map((f) => FITTING_MARKS[f] ?? f).join(' ')
          const well = n.meta?.wellLabel ?? ''
          return {
            type: 'Feature',
            properties: { marks: well ? `${well}${marks ? ' · ' + marks : ''}` : marks },
            geometry: { type: 'Point', coordinates: localToLonLat(n.x, n.y) },
          }
        }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes],
  )

  const systemType = project?.system_type ?? 'water'
  const workType = project?.work_type ?? 'new'
  const isWater = systemType === 'water'
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
              className="btn btn-ghost btn-sm"
              disabled={demoBusy || pipelineBusy}
              onClick={() => void loadDemo()}
            >
              {t('project.demo')}
            </button>
          </div>
        </div>
        <p className="hint">{t('project.pipeline.hint')}</p>
        {demoNotice === 'demoError' && <p className="notice error">{t('project.demoError')}</p>}
        {pipelineNotice && (
          <p className={`notice ${pipelineNotice === 'done' ? 'info' : 'error'}`}>
            {t(`project.pipeline.${pipelineNotice}`)}
          </p>
        )}
        <div className="panels">
          <ObjectLibrary active={placement} onSelect={setPlacement} />
          <ProjectMap
            points={topoPoints}
            buildings={buildings}
            source={sourceData}
            networkLines={networkLines}
            networkJunctions={networkJunctions}
            fittings={fittingsGeo}
            problems={problemsGeo}
            parcels={parcelsGeo}
            draftPolygon={parcelDraft?.vertices}
            violationPipeIds={violationPipeIds ?? undefined}
            pressureByBuilding={pressureByBuilding}
            hasResults={hasResults}
            placementActive={placement !== null}
            drawingActive={parcelDraft !== null}
            onAddBuilding={addBuildingAt}
            onMoveSource={moveSourceTo}
            onDeleteBuilding={deleteBuilding}
            onPlaceObject={placeObject}
            onDrawVertex={drawVertex}
          />
          <ParcelsSection
            projectId={project.id}
            parcels={parcels}
            buildings={buildings}
            draft={parcelDraft}
            violationCount={violationCount}
            onStartDraw={startDraw}
            onCancelDraw={cancelDraw}
            onFinishDraw={finishDraw}
            onChanged={parcelsChanged}
            onCheck={checkViolations}
          />
          {isReconstruction && (
            <Panel title={t('project.reconstructionSoon.title')} status="empty">
              <p className="hint">{t('project.reconstructionSoon.hint')}</p>
            </Panel>
          )}
          {!isWater && (
            <Panel title={t('project.moduleSoonTitle')} status="default">
              <p className="hint">{t(`project.moduleSoon.${systemType}`)}</p>
            </Panel>
          )}
          {isWater && (
            <>
              <ImportSection
                projectId={project.id}
                buildings={buildings}
                source={sourceData}
                points={topoPoints}
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
                onChanged={load}
              />
              <ResultsSection lastRun={lastRun} nodes={nodes} buildings={buildings} />
              <ExportSection
                projectId={project.id}
                projectName={project.name}
                buildings={buildings}
                nodes={nodes}
                pipes={pipes}
                datasets={datasets}
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
            </>
          )}
          <TopographySection projectId={project.id} dataset={datasets.topography} onSaved={load} />
          <BuildingsSection projectId={project.id} buildings={buildings} onChanged={load} />
          <SourceSection projectId={project.id} dataset={datasets.source} onSaved={load} />
          <GeologySection projectId={project.id} dataset={datasets.geology} onSaved={load} />
          <SeismicSection projectId={project.id} dataset={datasets.seismic} onSaved={load} />
          <NormsSection projectId={project.id} dataset={datasets.normative} onSaved={load} />
          {isWater && <DemandSection buildings={buildings} normsDataset={datasets.normative} />}
        </div>
      </div>
    </section>
  )
}
