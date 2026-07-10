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
import type { SourceData } from './ProjectMap'
import { Panel } from './Panel'

type Job = 'dxf' | 'pdf' | 'csv'

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
  const [notice, setNotice] = useState<'done' | 'error' | null>(null)

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
      buildings.map((b) => ({ id: b.id, residents: b.residents ?? 0 })),
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
    kind: 'dxf_plan' | 'pdf_note' | 'spec_csv',
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

  const exportDxf = async () => {
    setBusy('dxf')
    setNotice(null)
    try {
      const input = assemble()
      const { buildNetworkDxf } = await import('@aquascheme/engine/dxf')
      const dxf = buildNetworkDxf(input)
      const blob = new Blob([dxf], { type: 'application/dxf' })
      downloadBlob(`${slug}_В1.dxf`, blob)
      await archive('dxf_plan', `${slug}_В1.dxf`, blob, 'application/dxf')
      setNotice('done')
    } catch {
      setNotice('error')
    } finally {
      setBusy(null)
    }
  }

  const exportCsv = async () => {
    setBusy('csv')
    setNotice(null)
    try {
      const input = assemble()
      const { buildSpecification, specificationToCsv } = await import('@aquascheme/engine')
      const csv = specificationToCsv(buildSpecification(input))
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      downloadBlob(`${slug}_спецификация.csv`, blob)
      await archive('spec_csv', `${slug}_спецификация.csv`, blob, 'text/csv')
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
      const input = assemble()
      const [{ buildNoteDoc }, pdfMakeMod, pdfFontsMod] = await Promise.all([
        import('@aquascheme/engine'),
        import('pdfmake/build/pdfmake'),
        import('pdfmake/build/vfs_fonts'),
      ])
      const pdfMake = (pdfMakeMod as { default?: unknown }).default ?? pdfMakeMod
      const fonts = pdfFontsMod as unknown as {
        pdfMake?: { vfs: Record<string, string> }
        default?: { pdfMake?: { vfs: Record<string, string> }; vfs?: Record<string, string> }
        vfs?: Record<string, string>
      }
      const vfs =
        fonts.pdfMake?.vfs ?? fonts.default?.pdfMake?.vfs ?? fonts.default?.vfs ?? fonts.vfs
      const maker = pdfMake as { vfs?: unknown; createPdf: (doc: unknown) => { download: (name: string) => void; getBlob: (cb: (b: Blob) => void) => void } }
      maker.vfs = vfs
      const doc = buildNoteDoc(input)
      const pdf = maker.createPdf(doc)
      pdf.download(`${slug}_записка.pdf`)
      pdf.getBlob((blob) => {
        void archive('pdf_note', `${slug}_записка.pdf`, blob, 'application/pdf')
      })
      setNotice('done')
    } catch {
      setNotice('error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel title={t('project.export.title')} status={canExport ? 'filled' : 'empty'}>
      <p className="hint">{t('project.export.hint')}</p>
      {!canExport && <p className="stat-line warn">{t('project.export.needData')}</p>}
      <div className="section-actions">
        <button type="button" className="btn btn-sm" disabled={!canExport || busy !== null} onClick={() => void exportDxf()}>
          {busy === 'dxf' ? t('project.export.generating') : t('project.export.dxf')}
        </button>
        <button type="button" className="btn btn-sm" disabled={!canExport || busy !== null} onClick={() => void exportPdf()}>
          {busy === 'pdf' ? t('project.export.generating') : t('project.export.pdf')}
        </button>
        <button type="button" className="btn btn-sm" disabled={!canExport || busy !== null} onClick={() => void exportCsv()}>
          {busy === 'csv' ? t('project.export.generating') : t('project.export.csv')}
        </button>
      </div>
      {notice === 'done' && <p className="stat-line ok">{t('project.export.done')}</p>}
      {notice === 'error' && <p className="notice error">{t('project.export.error')}</p>}
    </Panel>
  )
}
