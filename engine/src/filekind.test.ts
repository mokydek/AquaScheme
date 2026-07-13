import { describe, expect, it } from 'vitest'
import { detectFileKind } from './filekind'

const ascii = (text: string): Uint8Array => new Uint8Array([...text].map((c) => c.charCodeAt(0)))

describe('detectFileKind', () => {
  it('recognises DWG by magic bytes even with a wrong extension', () => {
    expect(detectFileKind('drawing.dwg', ascii('AC1032rest'))).toBe('dwg')
    expect(detectFileKind('drawing.dxf', ascii('AC1018rest'))).toBe('dwg')
    expect(detectFileKind('noext', ascii('AC1032'))).toBe('dwg')
  })

  it('recognises PDF and spreadsheets by magic bytes', () => {
    expect(detectFileKind('report.pdf', ascii('%PDF-1.7'))).toBe('pdf')
    expect(detectFileKind('data.bin', ascii('%PDF-1.4'))).toBe('pdf')
    expect(detectFileKind('catalog.xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('xlsx')
    expect(detectFileKind('old.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]))).toBe('xlsx')
  })

  it('recognises DXF by extension and by group code structure', () => {
    expect(detectFileKind('plan.dxf', ascii('0\r\nSECTION\r\n2\r\nENTITIES'))).toBe('dxf')
    expect(detectFileKind('noext', ascii('999\ncomment\n0\nSECTION\n2\nHEADER'))).toBe('dxf')
    expect(detectFileKind('noext', ascii('AutoCAD Binary DXF\r\n'))).toBe('dxf')
  })

  it('recognises GeoJSON by extension and by content for txt/csv', () => {
    expect(detectFileKind('net.geojson', ascii('{"type":"FeatureCollection"}'))).toBe('geojson')
    expect(detectFileKind('net.json', ascii('{}'))).toBe('geojson')
    expect(detectFileKind('survey.txt', ascii('{"type":"FeatureCollection"}'))).toBe('geojson')
    expect(detectFileKind('noext', ascii('  {"type":"FeatureCollection"}'))).toBe('geojson')
  })

  it('recognises CSV by extension including BOM content', () => {
    expect(detectFileKind('survey.csv', ascii('x;y;z\n1;2;3'))).toBe('csv')
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...ascii('x,y,z\n1,2,3')])
    expect(detectFileKind('survey.txt', withBom)).toBe('csv')
  })

  it('returns unknown for unrecognised content', () => {
    expect(detectFileKind('archive.rar', new Uint8Array([0x52, 0x61, 0x72, 0x21]))).toBe('unknown')
    expect(detectFileKind('noext', ascii('hello world'))).toBe('unknown')
  })
})
