import { buildSpecification } from '@aquascheme/engine'
import type { ExportInput } from '@aquascheme/engine'
import { convertDrawing } from './upload'

/** DXF drawing text. */
export async function generateDxf(input: ExportInput): Promise<string> {
  const { buildNetworkDxf } = await import('@aquascheme/engine/dxf')
  return buildNetworkDxf(input)
}

/** "Общие данные" sheet as DXF (requirements update 3, O1). */
export async function generateGeneralDataDxf(input: ExportInput): Promise<string> {
  const { buildGeneralDataDxf } = await import('@aquascheme/engine/dxf')
  return buildGeneralDataDxf(input)
}

/** Specification sheet (GOST 21.110 form) as DXF. */
export async function generateSpecSheetDxf(input: ExportInput): Promise<string> {
  const { buildSpecSheetDxf } = await import('@aquascheme/engine/dxf')
  return buildSpecSheetDxf(input)
}

/** Sewer (К1) longitudinal profile sheet as DXF (GOST 21.704 form 2). */
export async function generateSewerProfileDxf(input: {
  projectName: string
  profile: import('@aquascheme/engine').GravityProfile
}): Promise<string> {
  const { buildSewerProfileDxf } = await import('@aquascheme/engine/dxf')
  return buildSewerProfileDxf(input)
}

/** Sewer (К1) network plan as DXF (GOST 21.704 5.1). */
export async function generateSewerPlanDxf(input: {
  projectName: string
  network: import('@aquascheme/engine').TracedNetwork
  pipeDiameterMm: Map<string, number>
  buildingLabels?: Map<string, string>
}): Promise<string> {
  const { buildSewerPlanDxf } = await import('@aquascheme/engine/dxf')
  return buildSewerPlanDxf(input)
}

/** Sewer (К1) general data sheet as DXF (ведомости, показатели, акты). */
export async function generateSewerGeneralDataDxf(input: {
  projectName: string
  schedule: import('@aquascheme/engine').SewerSchedule
  outletFlowLps: number
  maxDepthM: number
}): Promise<string> {
  const { buildSewerGeneralDataDxf } = await import('@aquascheme/engine/dxf')
  return buildSewerGeneralDataDxf(input)
}

/** Situational scheme (ситуационная схема, без масштаба) as DXF. */
export async function generateSituationDxf(
  input: import('@aquascheme/engine').SituationInput,
): Promise<string> {
  const { buildSituationDxf } = await import('@aquascheme/engine/dxf')
  return buildSituationDxf(input)
}

/** Sewer (К1) manhole and pipe schedule as an XLSX byte array (two sheets). */
export async function generateSewerScheduleXlsx(
  schedule: import('@aquascheme/engine').SewerSchedule,
): Promise<Uint8Array> {
  const XLSX = await import('xlsx')
  const book = XLSX.utils.book_new()
  const wells = schedule.manholes.map((m) => ({
    'Колодец': m.label,
    'ПК': m.picket,
    'Глубина, мм': m.depthMm,
    'Ø трубы, мм': m.pipeDiameterMm,
  }))
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(wells), 'Колодцы')
  const pipes = schedule.pipes.map((p) => ({
    'Обозначение': p.designation,
    'Ø, мм': p.diameterMm,
    'Длина, м': p.lengthM,
    'Код АГСК-3': p.agskCode,
  }))
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(pipes), 'Трубы')
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

/** Bill of materials as an XLSX byte array (SheetJS), ГОСТ 21.110 form 1. */
export async function generateSpecXlsx(input: ExportInput): Promise<Uint8Array> {
  const XLSX = await import('xlsx')
  const rows = buildSpecification(input).map((i) => ({
    'Поз.': i.pos,
    'Наименование и техническая характеристика': i.name,
    'Тип, марка, обозначение документа, опросного листа': i.spec,
    'Код продукции': i.code ?? '',
    'Ед. измерения': i.unit,
    'Кол.': i.quantity,
  }))
  const sheet = XLSX.utils.json_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Спецификация')
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

/** Render a pdfmake document definition to a Blob (pdfmake, lazy loaded). */
async function renderPdfDoc(doc: unknown): Promise<Blob> {
  const [pdfMakeMod, pdfFontsMod] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ])
  const pdfMake = (pdfMakeMod as { default?: unknown }).default ?? pdfMakeMod
  const fonts = pdfFontsMod as unknown as {
    pdfMake?: { vfs: Record<string, string> }
    default?: { pdfMake?: { vfs: Record<string, string> }; vfs?: Record<string, string> }
    vfs?: Record<string, string>
  }
  const vfs = fonts.pdfMake?.vfs ?? fonts.default?.pdfMake?.vfs ?? fonts.default?.vfs ?? fonts.vfs
  const maker = pdfMake as {
    vfs?: unknown
    createPdf: (doc: unknown) => { getBlob: (cb: (b: Blob) => void) => void }
  }
  maker.vfs = vfs
  return new Promise((resolve) => {
    maker.createPdf(doc).getBlob(resolve)
  })
}

/** Explanatory note as a PDF blob (pdfmake, lazy loaded). */
export async function generatePdf(input: ExportInput): Promise<Blob> {
  const { buildNoteDoc } = await import('@aquascheme/engine')
  return renderPdfDoc(buildNoteDoc(input))
}

/** Test / acceptance / disinfection / input-control act forms as a PDF (НБ2). */
export async function generateActFormsPdf(input: ExportInput): Promise<Blob> {
  const { buildActFormsDoc } = await import('@aquascheme/engine')
  return renderPdfDoc(buildActFormsDoc(input))
}

/** Design task, TEP list and project passport form Ф-2 as a PDF (НБ2). */
export async function generateProjectDocsPdf(input: ExportInput): Promise<Blob> {
  const { buildProjectDocsDoc } = await import('@aquascheme/engine')
  return renderPdfDoc(buildProjectDocsDoc(input))
}

/** Convert a DXF drawing to DWG via the converter microservice. */
export async function convertToDwg(dxf: string): Promise<Blob> {
  return convertDrawing(dxf, 'dwg')
}

async function toBytes(data: Blob | Uint8Array | string): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Uint8Array) return data
  return new Uint8Array(await data.arrayBuffer())
}

/** Bundle named files into a single ZIP blob (fflate, lazy loaded). */
export async function zipBundle(files: Record<string, Blob | Uint8Array | string>): Promise<Blob> {
  const { zipSync } = await import('fflate')
  const entries: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(files)) {
    entries[name] = await toBytes(data)
  }
  return new Blob([zipSync(entries)], { type: 'application/zip' })
}

export { CONVERTER_URL } from './upload'
