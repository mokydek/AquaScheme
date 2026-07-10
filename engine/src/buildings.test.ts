import { describe, expect, it } from 'vitest'
import { parseBuildingsCsv } from './buildings'

describe('parseBuildingsCsv', () => {
  it('parses buildings with labels', () => {
    const result = parseBuildingsCsv('x,y,floors,residents,label\n100,200,5,80,Д1\n170,200,2,32\n')
    expect(result.buildings).toEqual([
      { x: 100, y: 200, floors: 5, residents: 80, label: 'Д1' },
      { x: 170, y: 200, floors: 2, residents: 32 },
    ])
    expect(result.issues).toHaveLength(0)
  })

  it('rejects rows with invalid floors', () => {
    const result = parseBuildingsCsv('10,20,0,40\n10,20,2.5,40\n10,20,3,40')
    expect(result.buildings).toHaveLength(1)
    expect(result.issues.map((i) => i.row)).toEqual([1, 2])
  })

  it('rejects rows with too few columns', () => {
    const result = parseBuildingsCsv('10,20,3')
    expect(result.buildings).toHaveLength(0)
    expect(result.issues).toEqual([{ row: 1, kind: 'badColumns' }])
  })
})
