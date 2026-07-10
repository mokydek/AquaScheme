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
import type { SizingResult } from '@aquascheme/engine/sizing'

interface ProjectInfo {
  id: string
  name: string
}

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

  const load = useCallback(async () => {
    if (!id) return
    const [projectRes, datasetsRes, buildingsRes, nodesRes, pipesRes, runRes] = await Promise.all([
      supabase.from('projects').select('id,name').eq('id', id).maybeSingle(),
      supabase.from('datasets').select('*').eq('project_id', id),
      supabase
        .from('buildings')
        .select('id,label,x,y,floors,residents')
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
    setState('ready')
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const loadDemo = async () => {
    if (!id || demoBusy) return
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
    } catch {
      setDemoNotice('demoError')
    } finally {
      setDemoBusy(false)
    }
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

  const deleteBuilding = useCallback(
    async (buildingId: string) => {
      await supabase.from('buildings').delete().eq('id', buildingId)
      await load()
    },
    [load],
  )

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
          <h1>{project.name}</h1>
          <div className="project-head-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={demoBusy}
              onClick={() => void loadDemo()}
            >
              {t('project.demo')}
            </button>
          </div>
        </div>
        <p className="hint">{t('project.demoHint')}</p>
        {demoNotice && (
          <p className={`notice ${demoNotice === 'demoDone' ? 'info' : 'error'}`}>
            {t(`project.${demoNotice}`)}
          </p>
        )}
        <div className="panels">
          <ProjectMap
            points={topoPoints}
            buildings={buildings}
            source={sourceData}
            networkLines={networkLines}
            networkJunctions={networkJunctions}
            fittings={fittingsGeo}
            problems={problemsGeo}
            pressureByBuilding={pressureByBuilding}
            hasResults={hasResults}
            onAddBuilding={addBuildingAt}
            onMoveSource={moveSourceTo}
            onDeleteBuilding={deleteBuilding}
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
          <TopographySection projectId={project.id} dataset={datasets.topography} onSaved={load} />
          <BuildingsSection projectId={project.id} buildings={buildings} onChanged={load} />
          <SourceSection projectId={project.id} dataset={datasets.source} onSaved={load} />
          <GeologySection projectId={project.id} dataset={datasets.geology} onSaved={load} />
          <SeismicSection projectId={project.id} dataset={datasets.seismic} onSaved={load} />
          <NormsSection projectId={project.id} dataset={datasets.normative} onSaved={load} />
          <DemandSection buildings={buildings} normsDataset={datasets.normative} />
        </div>
      </div>
    </section>
  )
}
