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
  try {
    response = await fetch(`${CONVERTER_URL}/convert?to=${to}&version=ACAD2018`, {
      method: 'POST',
      body: form,
    })
  } catch {
    throw new UploadError('converterFailed', from)
  }
  if (!response.ok) throw new UploadError('converterFailed', from)
  return response.blob()
}

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

export async function routeUpload(file: File, allowed: RoutedKind[]): Promise<RoutedUpload> {
  const kind = await detectFileKind(file)
  if (kind === 'unknown') throw new UploadError('unknownType', kind)
  if (kind === 'dwg') {
    if (!allowed.includes('dxf')) throw new UploadError('unsupportedType', kind)
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
