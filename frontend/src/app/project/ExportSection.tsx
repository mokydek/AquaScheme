import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  computeNetworkDemand,
  NORMATIVE_DEFAULTS,
} from '@aquascheme/engine'
import type {
  Borehole,
  ExportInput,
  FittingsPlan,
  GeologyAttributes,
  GeologyInput,
  MaterialSelection,
  NormativeParams,
  SeismicInput,
  SurveyPoint,
  SystemType,
  WorkType,
} from '@aquascheme/engine'
import type { SizingResult } from '@aquascheme/engine/sizing'
import { supabase } from '../../shared/supabase'
import { useAuth } from '../../shared/auth'
import { networkFromRows } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import type { BuildingRow, DatasetKind, DatasetRow } from '../../shared/datasets'
import {
  CONVERTER_URL,
  convertToDwg,
  generateActFormsPdf,
  generateDxf,
  generateGeneralDataDxf,
  generatePdf,
  generateProjectDocsPdf,
  generateSituationDxf,
  generateSpecSheetDxf,
  generateSpecXlsx,
  zipBundle,
} from '../../shared/exporters'
import type { RegionDatasetContent } from '../../shared/regions'
import type { SourceData } from '../../shared/datasets'
import { Panel } from './Panel'

type Job = 'drawing' | 'pdf' | 'spec' | 'acts' | 'docs' | 'situation' | 'bundle'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function slugify(name: string): string {
  return name.trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '').slice(0, 40) || 'project'
}

export function ExportSection({
  projectId,
  projectName,
  workType,
  systemType,
  buildings,
  nodes,
  pipes,
  datasets,
  boreholes,
  lastRun,
}: {
  projectId: string
  projectName: string
  workType: WorkType
  systemType: SystemType
  buildings: BuildingRow[]
  nodes: NodeRow[]
  pipes: PipeRow[]
  datasets: Partial<Record<DatasetKind, DatasetRow>>
  boreholes: Borehole[]
  lastRun: SizingResult | null
}) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const hasConverter = CONVERTER_URL !== ''
  const [busy, setBusy] = useState<Job | null>(null)
  const [notice, setNotice] = useState<'done' | 'error' | 'converterError' | null>(null)
  const [withDxf, setWithDxf] = useState(true)
  // DWG is the default drawing format (requirements update 3, change 2) as
  // soon as the converter service is configured.
  const [withDwg, setWithDwg] = useState(hasConverter)

  const equipment = datasets.equipment?.content as
    | { material: MaterialSelection; fittings: FittingsPlan }
    | undefined
  const source = datasets.source?.content as SourceData | undefined

  const canExport =
    !!lastRun && !!equipment && !!source && !!datasets.geology && !!datasets.seismic

  const assemble = (): ExportInput => {
    const norms: NormativeParams = {
      ...NORMATIVE_DEFAULTS,
      ...((datasets.normative?.content ?? {}) as Partial<NormativeParams>),
    }
    const topo = datasets.topography?.content as { points?: SurveyPoint[] } | undefined
    const region = datasets.region?.content as RegionDatasetContent | undefined
    const network = networkFromRows(nodes, pipes)
    const demand = computeNetworkDemand(
      buildings.map((b) => ({
        id: b.id,
        residents: b.residents ?? 0,
        specificDemandLpd: b.specific_demand_lpd ?? undefined,
      })),
      norms,
    )
    return {
      projectName,
      dateIso: new Date().toISOString(),
      source: {
        x: source!.x,
        y: source!.y,
        groundElevation: source!.groundElevation ?? 0,
        availableHead: source!.availableHead ?? 45,
      },
      buildings: buildings.map((b) => ({
        id: b.id,
        label: b.label ?? '',
        x: b.x,
        y: b.y,
        floors: b.floors,
        residents: b.residents ?? 0,
      })),
      network,
      sizing: lastRun!,
      demand,
      material: equipment!.material,
      fittings: equipment!.fittings,
      norms,
      geology: datasets.geology!.content as GeologyInput,
      seismicity: datasets.seismic!.content as SeismicInput,
      surveyPoints: topo?.points,
      region: region ? { name: region.name, source: region.source } : null,
      boreholes,
      geologyAttributes: (datasets.geology?.content ?? {}) as Partial<GeologyAttributes>,
      workType,
      systemType,
    }
  }

  const archive = async (
    kind: 'dxf_plan' | 'pdf_note' | 'spec_xlsx',
    fileName: string,
    blob: Blob,
    contentType: string,
  ): Promise<void> => {
    if (!session) return
    const path = `${session.user.id}/${projectId}/${fileName}`
    const upload = await supabase.storage
      .from('exports')
      .upload(path, blob, { upsert: true, contentType })
    if (upload.error) return
    await supabase.from('exports').insert({
      project_id: projectId,
      kind,
      file_name: fileName,
      storage_path: path,
    })
  }

  const slug = slugify(projectName)

  /** DXF text plus, if selected and configured, a converted DWG blob. */
  const buildDrawings = async (input: ExportInput) => {
    const dxf = await generateDxf(input)
    let dwg: Blob | null = null
    let converterFailed = false
    if (withDwg && hasConverter) {
      try {
        dwg = await convertToDwg(dxf)
      } catch {
        converterFailed = true
      }
    }
    return { dxf, dwg, converterFailed }
  }

  const exportDrawing = async () => {
    setBusy('drawing')
    setNotice(null)
    try {
      const input = assemble()
      const { dxf, dwg, converterFailed } = await buildDrawings(input)
      if (withDxf || !dwg) {
        const blob = new Blob([dxf], { type: 'application/dxf' })
        downloadBlob(`${slug}_В1.dxf`, blob)
        await archive('dxf_plan', `${slug}_В1.dxf`, blob, 'application/dxf')
      }
      if (dwg) downloadBlob(`${slug}_В1.dwg`, dwg)
      setNotice(converterFailed ? 'converterError' : 'done')
    } catch {
      setNotice('error')
    } finally {
      setBusy(null)
    }
  }

  const exportSpec = async () => {
    setBusy('spec')
    setNotice(null)
    try {
      const bytes = await generateSpecXlsx(assemble())
      const blob = new Blob([bytes], { type: XLSX_TYPE })
      downloadBlob(`${slug}_спецификация.xlsx`, blob)
      await archive('spec_xlsx', `${slug}_спецификация.xlsx`, blob, XLSX_TYPE)
      setNotice('done')
    } catch {
      setNotice('error')
    } finally {
      setBusy(null)
    }
  }

  const exportPdf = async () => {
    setBusy('pdf')
    setNotice(null)
    try {
      const blob = await generatePdf(assemble())
      downloadBlob(`${slug}_записка.pdf`, blob)
      await archive('pdf_note', `${slug}_записка.pdf`, blob, 'application/pdf')
      setNotice('done')
    } catch {
      setNotice('error')
    } finally {
      setBusy(null)
    }
  }

  const exportSituation = async () => {
    setBusy('situation')
    setNotice(null)
    try {
      const input = assemble()
      const dxf = await generateSituationDxf({
        projectName,
        systemType,
        network: input.network,
        buildings: input.buildings.map((b) => ({ x: b.x, y: b.y, label: b.label })),
        surveyPoints: input.surveyPoints,
        pipeDiameterMm: new Map(input.sizing.pipes.map((p) => [p.id, p.nominalMm])),
      })
      const blob = new Blob([dxf], { type: 'application/dxf' })
      downloadBlob(`${slug}_ситуационная_схема.dxf`, blob)
      setNotice('done')
    } catch {
      setNotice('error')
    } finally {
      setBusy(null)
    }
  }

  const exportActs = async () => {
    setBusy('acts')
    setNotice(null)
    try {
      const blob = await generateActFormsPdf(assemble())
      downloadBlob(`${slug}_формы_актов.pdf`, blob)
      setNotice('done')
    } catch {
      setNotice('error')
    } finally {
      setBusy(null)
    }
  }

  const exportDocs = async () => {
    setBusy('docs')
    setNotice(null)
    try {
      const blob = await generateProjectDocsPdf(assemble())
      downloadBlob(`${slug}_проектные_документы.pdf`, blob)
      setNotice('done')
    } catch {
      setNotice('error')
    } finally {
      setBusy(null)
    }
  }

  const exportBundle = async () => {
    setBusy('bundle')
    setNotice(null)
    try {
      const input = assemble()
      const [{ dxf, dwg, converterFailed }, generalDxf, specDxf, pdf, xlsx, actsPdf, docsPdf, situationDxf] =
        await Promise.all([
          buildDrawings(input),
          generateGeneralDataDxf(input),
          generateSpecSheetDxf(input),
          generatePdf(input),
          generateSpecXlsx(input),
          generateActFormsPdf(input),
          generateProjectDocsPdf(input),
          generateSituationDxf({
            projectName,
            systemType,
            network: input.network,
            buildings: input.buildings.map((b) => ({ x: b.x, y: b.y, label: b.label })),
            surveyPoints: input.surveyPoints,
            pipeDiameterMm: new Map(input.sizing.pipes.map((p) => [p.id, p.nominalMm])),
          }),
        ])
      const files: Record<string, Blob | Uint8Array | string> = {
        [`${slug}_00_ситуационная_схема.dxf`]: situationDxf,
        [`${slug}_00_общие_данные.dxf`]: generalDxf,
        [`${slug}_В1.dxf`]: dxf,
        [`${slug}_спецификация_лист.dxf`]: specDxf,
        [`${slug}_записка.pdf`]: pdf,
        [`${slug}_спецификация.xlsx`]: xlsx,
        [`${slug}_формы_актов.pdf`]: actsPdf,
        [`${slug}_проектные_документы.pdf`]: docsPdf,
      }
      // buildDrawings already produced the main В1 DWG; convert the two extra
      // sheets when the converter is configured.
      if (dwg) files[`${slug}_В1.dwg`] = dwg
      let sheetConvertFailed = false
      if (withDwg && hasConverter) {
        const extra: Array<[string, string]> = [
          [`${slug}_00_общие_данные.dwg`, generalDxf],
          [`${slug}_спецификация_лист.dwg`, specDxf],
        ]
        for (const [name, sheetDxf] of extra) {
          try {
            files[name] = await convertToDwg(sheetDxf)
          } catch {
            sheetConvertFailed = true
          }
        }
      }
      const zip = await zipBundle(files)
      downloadBlob(`${slug}_комплект.zip`, zip)
      setNotice(converterFailed || sheetConvertFailed ? 'converterError' : 'done')
    } catch {
      setNotice('error')
    } finally {
      setBusy(null)
    }
  }

  const label = (job: Job, key: string) =>
    busy === job ? t('project.export.generating') : t(key)

  return (
    <Panel title={t('project.export.title')} status={canExport ? 'filled' : 'empty'}>
      <p className="hint">{t('project.export.hint')}</p>
      {!canExport && <p className="stat-line warn">{t('project.export.needData')}</p>}

      <div className="section-actions">
        <label className="check">
          <input type="checkbox" checked={withDxf} onChange={(e) => setWithDxf(e.target.checked)} />
          <span>DXF</span>
        </label>
        <label className="check" title={hasConverter ? '' : t('project.export.dwgUnavailable')}>
          <input
            type="checkbox"
            checked={withDwg}
            disabled={!hasConverter}
            onChange={(e) => setWithDwg(e.target.checked)}
          />
          <span>DWG</span>
        </label>
        {!hasConverter && <span className="stat-line warn" style={{ marginTop: 0 }}>{t('project.export.dwgUnavailable')}</span>}
      </div>

      <div className="section-actions">
        <button type="button" className="btn btn-sm" disabled={!canExport || busy !== null || (!withDxf && !withDwg)} onClick={() => void exportDrawing()}>
          {label('drawing', 'project.export.drawing')}
        </button>
        <button type="button" className="btn btn-sm" disabled={!canExport || busy !== null} onClick={() => void exportPdf()}>
          {label('pdf', 'project.export.pdf')}
        </button>
        <button type="button" className="btn btn-sm" disabled={!canExport || busy !== null} onClick={() => void exportSpec()}>
          {label('spec', 'project.export.spec')}
        </button>
        <button type="button" className="btn btn-sm" disabled={!canExport || busy !== null} onClick={() => void exportSituation()}>
          {label('situation', 'project.export.situation')}
        </button>
        <button type="button" className="btn btn-sm" disabled={!canExport || busy !== null} onClick={() => void exportDocs()}>
          {label('docs', 'project.export.docs')}
        </button>
        <button type="button" className="btn btn-sm" disabled={!canExport || busy !== null} onClick={() => void exportActs()}>
          {label('acts', 'project.export.acts')}
        </button>
        <button type="button" className="btn btn-sm" disabled={!canExport || busy !== null} onClick={() => void exportBundle()}>
          {label('bundle', 'project.export.bundle')}
        </button>
      </div>

      {notice === 'done' && <p className="stat-line ok">{t('project.export.done')}</p>}
      {notice === 'converterError' && <p className="notice error">{t('project.export.converterError')}</p>}
      {notice === 'error' && <p className="notice error">{t('project.export.error')}</p>}
    </Panel>
  )
}
