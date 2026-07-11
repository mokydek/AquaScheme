import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  computeNetworkDemand,
  NORMATIVE_DEFAULTS,
} from '@aquascheme/engine'
import type {
  ExportInput,
  FittingsPlan,
  GeologyInput,
  MaterialSelection,
  NormativeParams,
  SeismicInput,
  SurveyPoint,
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
  generateDxf,
  generatePdf,
  generateSpecXlsx,
  zipBundle,
} from '../../shared/exporters'
import type { SourceData } from './ProjectMap'
import { Panel } from './Panel'

type Job = 'drawing' | 'pdf' | 'spec' | 'bundle'
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
  buildings,
  nodes,
  pipes,
  datasets,
  lastRun,
}: {
  projectId: string
  projectName: string
  buildings: BuildingRow[]
  nodes: NodeRow[]
  pipes: PipeRow[]
  datasets: Partial<Record<DatasetKind, DatasetRow>>
  lastRun: SizingResult | null
}) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const [busy, setBusy] = useState<Job | null>(null)
  const [notice, setNotice] = useState<'done' | 'error' | 'converterError' | null>(null)
  const [withDxf, setWithDxf] = useState(true)
  const [withDwg, setWithDwg] = useState(false)
  const hasConverter = CONVERTER_URL !== ''

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
        dwg = await convertToDwg(dxf, CONVERTER_URL)
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

  const exportBundle = async () => {
    setBusy('bundle')
    setNotice(null)
    try {
      const input = assemble()
      const [{ dxf, dwg, converterFailed }, pdf, xlsx] = await Promise.all([
        buildDrawings(input),
        generatePdf(input),
        generateSpecXlsx(input),
      ])
      const files: Record<string, Blob | Uint8Array | string> = {
        [`${slug}_В1.dxf`]: dxf,
        [`${slug}_записка.pdf`]: pdf,
        [`${slug}_спецификация.xlsx`]: xlsx,
      }
      if (dwg) files[`${slug}_В1.dwg`] = dwg
      const zip = await zipBundle(files)
      downloadBlob(`${slug}_комплект.zip`, zip)
      setNotice(converterFailed ? 'converterError' : 'done')
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
