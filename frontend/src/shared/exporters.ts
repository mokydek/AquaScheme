import { buildSpecification } from '@aquascheme/engine'
import type { ExportInput } from '@aquascheme/engine'
import { convertDrawing } from './upload'
import { buildProjectAlbumDoc, buildProjectSheetDoc } from './projectAlbum'
import type { ProjectAlbumInput } from './projectAlbum'

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
  crossings?: import('@aquascheme/engine').CrossingRecord[]
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

/** Per-picket profile sheet set («Профиль К2 ПК…-ПК…»), one DXF per sheet. */
export async function generateProfileSheetSetDxf(
  projectName: string,
  profile: import('@aquascheme/engine').GravityProfile,
  system: 'sewer' | 'storm',
  crossings: import('@aquascheme/engine').CrossingRecord[] = [],
): Promise<Array<{ title: string; dxf: string }>> {
  const { buildProfileSheetSetDxf } = await import('@aquascheme/engine/dxf')
  return buildProfileSheetSetDxf(projectName, profile, system, 850, crossings)
}

/** Per-picket plan sheet set («План К2 ПК…-ПК…. М1:500»), one DXF per sheet. */
export async function generatePlanSheetSetDxf(input: {
  projectName: string
  network: import('@aquascheme/engine').TracedNetwork
  pipeDiameterMm: Map<string, number>
  mainPath: Array<{ x: number; y: number }>
  buildingLabels?: Map<string, string>
  system?: 'sewer' | 'storm'
}): Promise<Array<{ title: string; dxf: string }>> {
  const { buildPlanSheetSetDxf } = await import('@aquascheme/engine/dxf')
  return buildPlanSheetSetDxf(input)
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

/** Sewer explanatory note (записка К1/К2) as a PDF blob (pdfmake, lazy). */
export async function generateSewerNotePdf(
  input: import('@aquascheme/engine').SewerNoteInput,
): Promise<Blob> {
  const [{ buildSewerNoteDoc }, pdfMakeMod, pdfFontsMod] = await Promise.all([
    import('@aquascheme/engine'),
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ])
  const pdfMake = (pdfMakeMod as { default?: unknown }).default ?? pdfMakeMod
  const vfs = pdfFontVfs(pdfFontsMod)
  const maker = pdfMake as {
    vfs?: unknown
    addVirtualFileSystem?: (files: Record<string, string>) => void
    createPdf: (doc: unknown) => PdfDocument
  }
  if (maker.addVirtualFileSystem) maker.addVirtualFileSystem(vfs)
  else maker.vfs = vfs
  return pdfDocumentBlob(maker.createPdf(buildSewerNoteDoc(input) as Record<string, unknown>))
}

interface PdfDocument {
  getBlob: () => Promise<unknown>
}

/** pdfmake 0.3 returns a Promise, but normalize defensively across runtimes. */
async function pdfDocumentBlob(document: PdfDocument): Promise<Blob> {
  const output = await document.getBlob()
  if (output instanceof Blob) return output
  if (output instanceof ArrayBuffer) return new Blob([output], { type: 'application/pdf' })
  if (ArrayBuffer.isView(output)) {
    const bytes = new Uint8Array(output.buffer, output.byteOffset, output.byteLength)
    return new Blob([bytes], { type: 'application/pdf' })
  }
  throw new TypeError('pdfmake returned an unsupported PDF data type')
}

/** pdfmake 0.3 exports the VFS object directly; 0.2 used nested wrappers. */
function pdfFontVfs(module: unknown): Record<string, string> {
  const fonts = module as {
    pdfMake?: { vfs?: Record<string, string> }
    default?: Record<string, unknown> & { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> }
    vfs?: Record<string, string>
  }
  const nested = fonts.pdfMake?.vfs ?? fonts.default?.pdfMake?.vfs ?? fonts.default?.vfs ?? fonts.vfs
  if (nested) return nested
  const direct = fonts.default
  if (direct && Object.values(direct).every((value) => typeof value === 'string')) {
    return direct as Record<string, string>
  }
  throw new Error('pdfmake font VFS is unavailable')
}

/** Per-manhole material table sheets + the protective grille sheet. */
export async function generateManholeSheetsDxf(
  projectName: string,
  schedule: import('@aquascheme/engine').SewerSchedule,
  constructions: import('@aquascheme/engine').SelectedManholeConstruction[] = [],
): Promise<{ tables: Array<{ title: string; dxf: string }>; grille?: string }> {
  const { buildManholeMaterialSheetsDxf, buildProtectiveGrilleSheetDxf } = await import('@aquascheme/engine/dxf')
  const grilleComponents = constructions.flatMap((construction) => construction.components
    .filter((component) => /сетк/i.test(component.name))
    .map((component) => ({ quantity: component.quantity, source: construction.source })))
  return {
    tables: buildManholeMaterialSheetsDxf(projectName, schedule, constructions),
    ...(grilleComponents.length > 0 ? {
      grille: buildProtectiveGrilleSheetDxf(
        projectName,
        grilleComponents.reduce((sum, item) => sum + item.quantity, 0),
        [...new Set(grilleComponents.map((item) => item.source))].join('; '),
      ),
    } : {}),
  }
}

/** Sewer specification sheet (ГОСТ 21.110 form, НК.С) as DXF. */
export async function generateSewerSpecSheetDxf(
  projectName: string,
  items: import('@aquascheme/engine').SpecItem[],
): Promise<string> {
  const { buildSpecSheetDxf } = await import('@aquascheme/engine/dxf')
  return buildSpecSheetDxf({ projectName }, items)
}

/** Sewer specification as an XLSX byte array (with the АГСК code column). */
export async function generateSewerSpecXlsx(
  items: import('@aquascheme/engine').SpecItem[],
): Promise<Uint8Array> {
  const XLSX = await import('xlsx')
  const rows = items.map((i) => ({
    'Поз.': i.pos,
    'Наименование': i.name,
    'Тип, марка': i.spec,
    'Код (АГСК-3, раздел)': i.code ?? '',
    'Ед. изм.': i.unit,
    'Кол-во': i.quantity,
  }))
  const sheet = XLSX.utils.json_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Спецификация')
  return xlsxBytes(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
}

/** Sewer (К1) manhole and pipe schedule as an XLSX byte array (two sheets). */
export async function generateSewerScheduleXlsx(
  schedule: import('@aquascheme/engine').SewerSchedule,
  manholeConstructions: import('@aquascheme/engine').SelectedManholeConstruction[] = [],
): Promise<Uint8Array> {
  const XLSX = await import('xlsx')
  const book = XLSX.utils.book_new()
  const constructionByLabel = new Map(manholeConstructions.map((item) => [item.manholeLabel, item]))
  const wells = schedule.manholes.map((m) => ({
    'Колодец': m.label,
    'ПК': m.picket,
    'Глубина, мм': m.depthMm,
    'Ø трубы, мм': m.pipeDiameterMm,
    'Тип конструкции': constructionByLabel.get(m.label)?.typeCode ?? 'не подобрано',
    'Источник конструкции': constructionByLabel.get(m.label)?.source ?? '',
  }))
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(wells), 'Колодцы')
  const pipes = schedule.pipes.map((p) => ({
    'Обозначение': p.designation,
    'Ø, мм': p.diameterMm,
    'Длина, м': p.lengthM,
    'Код АГСК-3': p.agskCode,
  }))
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(pipes), 'Трубы')
  if (manholeConstructions.length > 0) {
    const components = manholeConstructions.flatMap((construction) => construction.components.map((component) => ({
      'Колодец': construction.manholeLabel,
      'Тип конструкции': construction.typeCode,
      'Наименование элемента': component.name,
      'Код': component.catalogCode ?? '',
      'Ед.': component.unit,
      'Количество': component.quantity,
      'Источник': construction.source,
    })))
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(components), 'Элементы колодцев')

    const totals = new Map<string, { name: string; code: string; unit: string; quantity: number }>()
    for (const construction of manholeConstructions) {
      for (const component of construction.components) {
        const key = `${component.catalogCode ?? ''}\u0000${component.name}\u0000${component.unit}`
        const current = totals.get(key)
        totals.set(key, {
          name: component.name,
          code: component.catalogCode ?? '',
          unit: component.unit,
          quantity: Math.round(((current?.quantity ?? 0) + component.quantity) * 1000) / 1000,
        })
      }
    }
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([...totals.values()].map((item) => ({
      'Наименование элемента': item.name,
      'Код': item.code,
      'Ед.': item.unit,
      'Количество': item.quantity,
    }))), 'Итоги по колодцам')
  }
  return xlsxBytes(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
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
  return xlsxBytes(XLSX.write(book, { type: 'array', bookType: 'xlsx' }))
}

function xlsxBytes(output: unknown): Uint8Array {
  if (output instanceof Uint8Array) return output
  if (output instanceof ArrayBuffer) return new Uint8Array(output)
  if (ArrayBuffer.isView(output)) {
    return new Uint8Array(output.buffer, output.byteOffset, output.byteLength)
  }
  throw new TypeError('SheetJS returned an unsupported XLSX data type')
}

/** Render a pdfmake document definition to a Blob (pdfmake, lazy loaded). */
async function renderPdfDoc(doc: unknown): Promise<Blob> {
  const [pdfMakeMod, pdfFontsMod] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ])
  const pdfMake = (pdfMakeMod as { default?: unknown }).default ?? pdfMakeMod
  const vfs = pdfFontVfs(pdfFontsMod)
  const maker = pdfMake as {
    vfs?: unknown
    addVirtualFileSystem?: (files: Record<string, string>) => void
    createPdf: (doc: unknown) => PdfDocument
  }
  if (maker.addVirtualFileSystem) maker.addVirtualFileSystem(vfs)
  else maker.vfs = vfs
  return pdfDocumentBlob(maker.createPdf(doc))
}

/** Data-driven working-drawing album. The reference PDF is never an input. */
export async function generateProjectAlbumPdf(input: ProjectAlbumInput): Promise<Blob> {
  return renderPdfDoc(buildProjectAlbumDoc(input))
}

/** One vector working sheet; BLOCKED/PRELIMINARY/STALE sheets are refused. */
export async function generateProjectSheetPdf(input: ProjectAlbumInput, sheetId: string): Promise<Blob> {
  return renderPdfDoc(buildProjectSheetDoc(input, sheetId))
}

/** One DXF sheet selected from the same dynamic register as the PDF album. */
export async function generateWorkingDrawingSheetDxf(input: ProjectAlbumInput, sheetId: string): Promise<string> {
  const sheet = input.drawingSet.sheets.find((item) => item.id === sheetId)
  if (!sheet) throw new Error('Лист не найден в текущем реестре.')
  if (sheet.status !== 'CALCULATED' && sheet.status !== 'VERIFIED') {
    throw new Error(`Лист ${sheet.sheetNumber} нельзя выпустить со статусом ${sheet.status}.`)
  }
  const dxf = await import('@aquascheme/engine/dxf')
  if (sheet.kind === 'plan') {
    const sheets = dxf.buildPlanSheetSetDxf({
      projectName: input.projectName,
      network: input.network,
      pipeDiameterMm: input.pipeDiameterMm,
      mainPath: input.drawingSet.mainPath,
      buildingLabels: input.buildingLabels,
      system: input.system,
    })
    const index = input.drawingSet.sheets.filter((item) => item.kind === 'plan').findIndex((item) => item.id === sheet.id)
    if (!sheets[index]) throw new Error('Геометрия нарезки DXF не совпала с реестром планов.')
    return sheets[index].dxf
  }
  if (sheet.kind === 'profile') {
    const sheets = dxf.buildProfileSheetSetDxf(
      input.projectName,
      input.profile,
      input.system,
      850,
      input.constraints?.crossings ?? [],
    )
    const index = input.drawingSet.sheets.filter((item) => item.kind === 'profile').findIndex((item) => item.id === sheet.id)
    if (!sheets[index]) throw new Error('Геометрия нарезки DXF не совпала с реестром профилей.')
    return sheets[index].dxf
  }
  if (sheet.kind === 'material_table') {
    const sheets = dxf.buildManholeMaterialSheetsDxf(input.projectName, input.schedule, input.manholeConstructions, 27)
    const index = input.drawingSet.sheets.filter((item) => item.kind === 'material_table').findIndex((item) => item.id === sheet.id)
    if (!sheets[index]) throw new Error('Ведомость DXF не совпала с реестром листов.')
    return sheets[index].dxf
  }
  if (sheet.kind === 'specification') {
    return dxf.buildWorkingDrawingSpecificationDxf(input.projectName, input.schedule, input.manholeConstructions)
  }
  if (sheet.id.startsWith('structures-')) {
    return dxf.buildManholeConstructionDetailDxf(input.projectName, input.schedule, input.manholeConstructions)
  }
  if (sheet.id.startsWith('crossings-')) {
    const index = input.drawingSet.sheets.filter((item) => item.id.startsWith('crossings-')).findIndex((item) => item.id === sheet.id)
    const crossings = input.constraints?.crossings?.slice(index * 8, index * 8 + 8) ?? []
    return dxf.buildCrossingDetailDxf(input.projectName, crossings, sheet.title)
  }
  throw new Error(`DXF для типа листа ${sheet.kind} не реализован.`)
}

/** Complete register DXF export with each family generated only once. */
export async function generateWorkingDrawingSetDxfs(input: ProjectAlbumInput): Promise<Array<{
  sheetId: string
  sheetNumber: number
  title: string
  dxf: string
}>> {
  if (!input.drawingSet.summary.finalExportAllowed) {
    throw new Error('Комплект DXF заблокирован реестром рабочих листов.')
  }
  const dxf = await import('@aquascheme/engine/dxf')
  const planFiles = dxf.buildPlanSheetSetDxf({
    projectName: input.projectName,
    network: input.network,
    pipeDiameterMm: input.pipeDiameterMm,
    mainPath: input.drawingSet.mainPath,
    buildingLabels: input.buildingLabels,
    system: input.system,
  })
  const profileFiles = dxf.buildProfileSheetSetDxf(
    input.projectName,
    input.profile,
    input.system,
    850,
    input.constraints?.crossings ?? [],
  )
  const materialFiles = dxf.buildManholeMaterialSheetsDxf(input.projectName, input.schedule, input.manholeConstructions, 27)
  let planIndex = 0
  let profileIndex = 0
  let materialIndex = 0
  let crossingIndex = 0
  return input.drawingSet.sheets.map((sheet) => {
    let drawing: string | undefined
    if (sheet.kind === 'plan') drawing = planFiles[planIndex++]?.dxf
    else if (sheet.kind === 'profile') drawing = profileFiles[profileIndex++]?.dxf
    else if (sheet.kind === 'material_table') drawing = materialFiles[materialIndex++]?.dxf
    else if (sheet.kind === 'specification') drawing = dxf.buildWorkingDrawingSpecificationDxf(input.projectName, input.schedule, input.manholeConstructions)
    else if (sheet.id.startsWith('structures-')) drawing = dxf.buildManholeConstructionDetailDxf(input.projectName, input.schedule, input.manholeConstructions)
    else if (sheet.id.startsWith('crossings-')) {
      const crossings = input.constraints?.crossings?.slice(crossingIndex * 8, crossingIndex * 8 + 8) ?? []
      crossingIndex++
      drawing = dxf.buildCrossingDetailDxf(input.projectName, crossings, sheet.title)
    }
    if (!drawing) throw new Error(`Не создан DXF для листа ${sheet.sheetNumber}: ${sheet.title}.`)
    return { sheetId: sheet.id, sheetNumber: sheet.sheetNumber, title: sheet.title, dxf: drawing }
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

type BundleData = Blob | ArrayBuffer | ArrayBufferView | string

async function toBytes(data: BundleData): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  return new Uint8Array(await data.arrayBuffer())
}

/** Bundle named files into a single ZIP blob (fflate, lazy loaded). */
export async function zipBundle(files: Record<string, BundleData>): Promise<Blob> {
  const { zipSync } = await import('fflate')
  const entries: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(files)) {
    entries[name] = await toBytes(data)
  }
  return new Blob([zipSync(entries)], { type: 'application/zip' })
}

export { CONVERTER_URL } from './upload'
