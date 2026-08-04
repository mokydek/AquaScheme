import { describe, expect, it } from 'vitest'
import { structureKindForBlockName, structuresFromBlocks } from './structures-from-blocks'
import type { DxfBlockEntity } from './dxfread'

const block = (name: string, x = 0, y = 0, layer = '0'): DxfBlockEntity =>
  ({ name, x, y, layer } as DxfBlockEntity)

describe('сооружения по именам блоков', () => {
  it('узнаёт обозначения реального чертежа', () => {
    // Имена взяты с топоосновы Талдыколя: 24 + 8 + 7 колодцев на слое «0».
    expect(structureKindForBlockName('кол.Кан')).toBe('колодец канализации')
    expect(structureKindForBlockName('кол.Лив')).toBe('колодец ливневой канализации')
    expect(structureKindForBlockName('кол.вод.')).toBe('колодец водопровода')
  })

  it('регистр и разделители значения не имеют', () => {
    for (const name of ['КОЛ.КАН', 'кол кан', 'колКан', ' Кол.Кан ']) {
      expect(structureKindForBlockName(name), name).toBe('колодец канализации')
    }
  })

  it('ливневый колодец не путается с канализационным', () => {
    // «Ливневая канализация» содержит оба корня; порядок правил решает.
    expect(structureKindForBlockName('кол.лив.кан')).toBe('колодец ливневой канализации')
  })

  it('незнакомое имя не угадывается', () => {
    for (const name of ['BL_2009', 'A$C4F876A45', '72342000', 'shotlin', '']) {
      expect(structureKindForBlockName(name), name).toBeNull()
    }
  })

  it('нераспознанные имена возвращаются с числом вставок, а не отбрасываются', () => {
    // Среди них может быть сооружение с местным обозначением; решает инженер.
    const result = structuresFromBlocks([
      block('кол.Кан', 10, 20), block('BL_2009'), block('BL_2009'), block('shotlin'),
    ])
    expect(result.structures).toHaveLength(1)
    expect(result.unrecognized).toEqual([
      { blockName: 'BL_2009', count: 2, layer: '0' },
      { blockName: 'shotlin', count: 1, layer: '0' },
    ])
  })

  it('точка вставки сохраняется как есть: она измерена съёмкой', () => {
    const result = structuresFromBlocks([block('кол.Кан', 1234.56, -789.01, 'СЕТИ')])
    expect(result.structures[0]).toEqual({
      x: 1234.56, y: -789.01, kind: 'колодец канализации', blockName: 'кол.Кан', layer: 'СЕТИ',
    })
  })

  it('имя блока возвращается вместе с видом', () => {
    // Соглашение об именах у каждой организации своё, и проверяющий должен
    // видеть, из чего вид выведен.
    const result = structuresFromBlocks([block('кол.Кан')])
    expect(result.structures[0].blockName).toBe('кол.Кан')
    expect(result.reason).toMatch(/вид выведен из имени блока/)
  })

  it('назначение инженера важнее соглашения об именах', () => {
    const result = structuresFromBlocks([block('BL_56'), block('кол.Кан')], { BL_56: 'камера' })
    expect(result.structures.map((item) => item.kind)).toEqual(['камера', 'колодец канализации'])
    expect(result.unrecognized).toEqual([])
  })

  it('вставка без координат не превращается в сооружение', () => {
    const broken = [
      { name: 'кол.Кан', x: Number.NaN, y: 0 } as DxfBlockEntity,
      { name: 'кол.Кан', x: 0 } as DxfBlockEntity,
      block('   '),
    ]
    expect(structuresFromBlocks(broken).structures).toEqual([])
  })

  it('свод называет виды и их число', () => {
    const result = structuresFromBlocks([
      block('кол.Кан'), block('кол.Кан'), block('кол.Лив'), block('кол.вод.'),
    ])
    expect(result.structures).toHaveLength(4)
    expect(result.reason).toMatch(/колодец канализации — 2/)
    expect(result.reason).toMatch(/Опознано сооружений: 4/)
  })

  it('пустой чертёж не выдаётся за распознанный', () => {
    const empty = structuresFromBlocks([])
    expect(empty.structures).toEqual([])
    expect(empty.reason).toMatch(/не опознано/)
  })
})
