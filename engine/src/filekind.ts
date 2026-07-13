/**
 * Detection of uploaded file kinds for the single upload router (requirements
 * update 3, change 2). One upload entry point recognises the real kind of a
 * file by its extension and magic bytes and routes it to the right parser;
 * binary signatures win over the extension so a mislabelled drawing is not
 * parsed as text. Pure function of (name, first bytes), unit tested here;
 * the frontend wraps it with the File API.
 */

export type UploadFileKind = 'dwg' | 'dxf' | 'geojson' | 'csv' | 'xlsx' | 'pdf' | 'unknown'

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim())
  return match ? match[1].toLowerCase() : ''
}

function startsWithAscii(bytes: Uint8Array, ascii: string): boolean {
  if (bytes.length < ascii.length) return false
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[i] !== ascii.charCodeAt(i)) return false
  }
  return true
}

/** First bytes as latin1 text (UTF-8 BOM stripped) for structure sniffing. */
function headText(bytes: Uint8Array): string {
  const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  const end = Math.min(bytes.length, start + 2048)
  let out = ''
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i])
  return out
}

/** A DXF text file is group code / value pairs starting with 0 / SECTION, possibly after 999 comments. */
function looksLikeDxf(head: string): boolean {
  if (head.startsWith('AutoCAD Binary DXF')) return true
  const lines = head.split(/\r?\n/).map((line) => line.trim())
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i] === '999') continue
    return lines[i] === '0' && lines[i + 1].toUpperCase() === 'SECTION'
  }
  return false
}

function looksLikeJson(head: string): boolean {
  const trimmed = head.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

export function detectFileKind(name: string, bytes: Uint8Array): UploadFileKind {
  // Binary signatures first. DWG starts with an ASCII version marker such as
  // AC1032; PDF with %PDF; XLSX is a PK zip container; legacy XLS is OLE.
  if (startsWithAscii(bytes, 'AC10')) return 'dwg'
  if (startsWithAscii(bytes, '%PDF')) return 'pdf'
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx'
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'xlsx'

  const head = headText(bytes)
  const ext = extensionOf(name)
  if (ext === 'dwg') return 'dwg'
  if (ext === 'dxf') return 'dxf'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx'
  if (ext === 'geojson' || ext === 'json') return 'geojson'
  if (ext === 'csv' || ext === 'txt') {
    // Some surveys are exported as .txt or .csv but actually carry GeoJSON.
    return looksLikeJson(head) ? 'geojson' : 'csv'
  }
  if (looksLikeDxf(head)) return 'dxf'
  if (looksLikeJson(head)) return 'geojson'
  return 'unknown'
}
