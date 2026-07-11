import { describe, expect, it } from 'vitest'
import { parseDxfNetwork } from './dxfread'

const FIXTURE = [
  '0',
  'SECTION',
  '2',
  'ENTITIES',
  '0',
  'LINE',
  '8',
  'NETWORK',
  '10',
  '0.0',
  '20',
  '0.0',
  '11',
  '100.0',
  '21',
  '0.0',
  '0',
  'LWPOLYLINE',
  '8',
  'NETWORK',
  '90',
  '3',
  '10',
  '100.0',
  '20',
  '0.0',
  '10',
  '200.0',
  '20',
  '0.0',
  '10',
  '200.0',
  '20',
  '100.0',
  '0',
  'POINT',
  '8',
  'WELLS',
  '10',
  '0.0',
  '20',
  '0.0',
  '0',
  'ENDSEC',
  '0',
  'EOF',
].join('\r\n')

describe('parseDxfNetwork', () => {
  it('reads lines, polylines and points grouped by layer', () => {
    const data = parseDxfNetwork(FIXTURE)
    expect(data.ok).toBe(true)
    expect(data.segments).toHaveLength(2)
    expect(data.segments[0].layer).toBe('NETWORK')
    expect(data.segments[1].points).toHaveLength(3)
    expect(data.points).toHaveLength(1)
    expect(data.points[0].layer).toBe('WELLS')
    const network = data.layers.find((l) => l.name === 'NETWORK')
    expect(network?.segments).toBe(2)
  })

  it('returns ok false for garbage input', () => {
    expect(parseDxfNetwork('definitely not a dxf').ok).toBe(false)
  })
})
