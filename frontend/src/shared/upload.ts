import type { TFunction } from 'i18next'
import { detectFileKind as detectKindFromBytes } from '@aquascheme/engine'
import type { UploadFileKind } from '@aquascheme/engine'

/**
 * Single upload router (requirements update 3, change 2). Every file input in
 * the app goes through routeUpload: the real kind of the chosen file is
 * detected from its extension and magic bytes, DWG drawings are converted to
 * DXF through the converter microservice before parsing, and unsupported
 * kinds produce a human message that says where such a file belongs.
 */

export const CONVERTER_URL = (
  (import.meta.env.VITE_CONVERTER_URL as string | undefined) ?? ''
).replace(/\/+$/, '')

export type UploadErrorCode =
  | 'unsupportedType'
  | 'unknownType'
  | 'converterNotConfigured'
  | 'converterFailed'

export class UploadError extends Error {
  readonly code: UploadErrorCode
  readonly kind: UploadFileKind

  constructor(code: UploadErrorCode, kind: UploadFileKind) {
    super(`${code}: ${kind}`)
    this.name = 'UploadError'
    this.code = code
    this.kind = kind
  }
}

/** Kind of a browser File, from its name and first bytes. */
export async function detectFileKind(file: File): Promise<UploadFileKind> {
  const bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  return detectKindFromBytes(file.name, bytes)
}

/** Convert a drawing through the converter microservice (DXF ↔ DWG). */
export async function convertDrawing(data: Blob | string, to: 'dwg' | 'dxf'): Promise<Blob> {
  const from: UploadFileKind = to === 'dxf' ? 'dwg' : 'dxf'
  if (CONVERTER_URL === '') throw new UploadError('converterNotConfigured', from)
  const blob = typeof data === 'string' ? new Blob([data], { type: 'application/dxf' }) : data
  const form = new FormData()
  form.append('file', blob, `drawing.${from}`)
  let response: Response
  const controller = new AbortController()
  // Render's free instance may need about a minute to wake up. Three minutes
  // still leaves enough headroom while guaranteeing that the UI can recover.
  // `setTimeout`, а не `window.setTimeout`: маршрут не обязан жить в DOM.
  // Привязка к `window` мешала прогнать его вне браузера — а прогон по
  // настоящему файлу владельца и есть единственное доказательство, что он
  // работает.
  const timeout = setTimeout(() => controller.abort(), 180_000)
  try {
    response = await fetch(`${CONVERTER_URL}/convert?to=${to}&version=ACAD2018`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })
  } catch {
    throw new UploadError('converterFailed', from)
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) throw new UploadError('converterFailed', from)
  return response.blob()
}

/**
 * Этап маршрута, о котором можно сказать вслух.
 *
 * Конвертация — не разбор. На бесплатном тарифе первая загрузка DWG после
 * простоя это около минуты пробуждения сервиса плюс сама конвертация, и всё
 * это время экран показывал одно многоточие: отличить пробуждение от зависания
 * было нечем. Маршрут знает, чего именно ждёт, — и говорит об этом вызвавшему.
 *
 * Этапов ровно столько, сколько маршрут различает. Процентов и обратного
 * отсчёта здесь нет и не будет: их никто не считает, и показывать их значило бы
 * выдумывать.
 */
export type UploadStage = 'converting'

/** Kinds a section can receive after routing (DWG arrives as DXF text). */
export type RoutedKind = Exclude<UploadFileKind, 'dwg' | 'unknown'>

export interface RoutedUpload {
  kind: RoutedKind
  file: File
  /** Content for the text kinds (dxf, geojson, csv). */
  text?: string
  /** True when the DXF text was produced from an uploaded DWG. */
  fromDwg?: boolean
}

export async function routeUpload(
  file: File,
  allowed: RoutedKind[],
  onStage?: (stage: UploadStage) => void,
): Promise<RoutedUpload> {
  const kind = await detectFileKind(file)
  if (kind === 'unknown') throw new UploadError('unknownType', kind)
  if (kind === 'dwg') {
    if (!allowed.includes('dxf')) throw new UploadError('unsupportedType', kind)
    onStage?.('converting')
    const dxf = await convertDrawing(file, 'dxf')
    return { kind: 'dxf', file, text: await dxf.text(), fromDwg: true }
  }
  if (!allowed.includes(kind)) throw new UploadError('unsupportedType', kind)
  if (kind === 'dxf' || kind === 'geojson' || kind === 'csv') {
    return { kind, file, text: await file.text() }
  }
  return { kind, file }
}

/** Human message for routing errors; null when the error is not one. */
export function uploadErrorText(t: TFunction, error: unknown): string | null {
  if (!(error instanceof UploadError)) return null
  if (error.code === 'unknownType') return t('upload.unknown')
  if (error.code === 'converterNotConfigured') return t('upload.converterNeeded')
  if (error.code === 'converterFailed') return t('upload.converterFailed')
  return t('upload.unsupported', {
    kind: t(`upload.kindLabel.${error.kind}`),
    use: t(`upload.use.${error.kind}`),
  })
}
