import { buildSpecification } from '@aquascheme/engine'
import type { ExportInput } from '@aquascheme/engine'
import { convertDrawing } from './upload'

/** DXF drawing text. */
export async function generateDxf(input: ExportInput): Promise<string> {
  const { buildNetworkDxf } = await import('@aquascheme/engine/dxf')
  return buildNetworkDxf(input)
}

/** Bill of materials as an XLSX byte array (SheetJS). */
export async function generateSpecXlsx(input: ExportInput): Promise<Uint8Array> {
  const XLSX = await import('xlsx')
  const rows = buildSpecification(input).map((i) => ({
    'Поз.': i.pos,
    'Наименование': i.name,
    'Тип, марка': i.spec,
    'Ед. изм.': i.unit,
    'Кол-во': i.quantity,
  }))
  const sheet = XLSX.utils.json_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Спецификация')
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

/** Explanatory note as a PDF blob (pdfmake, lazy loaded). */
export async function generatePdf(input: ExportInput): Promise<Blob> {
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
  const vfs = fonts.pdfMake?.vfs ?? fonts.default?.pdfMake?.vfs ?? fonts.default?.vfs ?? fonts.vfs
  const maker = pdfMake as {
    vfs?: unknown
    createPdf: (doc: unknown) => { getBlob: (cb: (b: Blob) => void) => void }
  }
  maker.vfs = vfs
  return new Promise((resolve) => {
    maker.createPdf(buildNoteDoc(input)).getBlob(resolve)
  })
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
