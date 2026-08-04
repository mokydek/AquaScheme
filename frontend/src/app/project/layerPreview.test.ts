import { describe, expect, it } from 'vitest'
import { layerPreview, segmentsExtent } from './layerPreview'

const line = (layer: string, points: Array<[number, number]>) =>
  ({ layer, points: points.map(([x, y]) => ({ x, y })) })

/** Все числа пути: по ним проверяются габариты и попадание в кадр. */
const numbers = (path: string) =>
  path.replace(/[ML]/g, ' ').trim().split(/\s+/).map(Number)

describe('набросок слоя', () => {
  it('берёт только свой слой', () => {
    const preview = layerPreview([
      line('СЕТИ', [[0, 0], [100, 0]]),
      line('РЕЛЬЕФ', [[0, 0], [100, 100]]),
    ], 'СЕТИ')
    expect(preview?.totalSegments).toBe(1)
  })

  it('без кадра чертежа вписывает слой в его собственный габарит', () => {
    // Квадрат 100×100 в границах 120×80 упирается в высоту: картинка 80×80,
    // и чертёж занимает её целиком — полей нет.
    const preview = layerPreview([line('L', [[0, 0], [100, 0], [100, 100], [0, 100]])], 'L')
    expect([preview?.width, preview?.height]).toEqual([80, 80])
    expect(preview?.paths[0]).toBe('M0 80 L80 80 L80 0 L0 0')
    expect(preview?.frame).toBe('layer')
    expect(preview?.spanXM).toBe(100)
    expect(preview?.spanYM).toBe(100)
  })

  it('картинка принимает пропорции чертежа, а не отведённых границ', () => {
    // Талдыколь — полоса 3,6 × 10,1 км. В поле постоянных пропорций она
    // занимала треть ширины, остальное уходило в пустые поля.
    const drawing = [line('L', [[0, 0], [3619, 10103]])]
    const preview = layerPreview(drawing, 'L', { extent: segmentsExtent(drawing) })!
    expect(preview.height).toBe(80)
    expect(preview.width).toBe(Math.round(80 * 3619 / 10103))
    // Диагональ полосы проходит по всей картинке из угла в угол.
    expect(preview.box.width).toBeCloseTo(preview.width, 0)
    expect(preview.box.height).toBeCloseTo(preview.height, 0)
  })

  it('крайне вытянутый чертёж не вырождается в нить', () => {
    const drawing = [line('L', [[0, 0], [10000, 3]])]
    const preview = layerPreview(drawing, 'L', { extent: segmentsExtent(drawing) })!
    expect(preview.height).toBeGreaterThanOrEqual(10)
    expect(numbers(preview.paths[0]).every(Number.isFinite)).toBe(true)
  })

  it('в общем кадре мелкий слой остаётся мелким', () => {
    // Ради этого кадр и общий: иначе одно здание и вся сеть на площадке
    // выглядят одинаково — оба растянуты на всю картинку.
    const drawing = [
      line('СЕТЬ', [[0, 0], [1000, 1000]]),
      line('ДОМ', [[10, 10], [20, 10], [20, 20], [10, 20]]),
    ]
    const extent = segmentsExtent(drawing)
    const house = layerPreview(drawing, 'ДОМ', { extent })
    const network = layerPreview(drawing, 'СЕТЬ', { extent })
    expect(house?.frame).toBe('drawing')
    expect(house!.box.width).toBeLessThan(2)
    expect(network!.box.width).toBeCloseTo(network!.width, 0)
    // Габарит в подписи при этом честный, в метрах самого слоя.
    expect(house?.spanXM).toBe(10)
    expect(network?.spanXM).toBe(1000)
  })

  it('габарит слоя в кадре показывает, где слой лежит', () => {
    const drawing = [
      line('ВСЁ', [[0, 0], [1000, 0], [1000, 1000], [0, 1000]]),
      line('УГОЛ', [[900, 900], [1000, 1000]]),
    ]
    const corner = layerPreview(drawing, 'УГОЛ', { extent: segmentsExtent(drawing) })!
    // Правый верхний угол чертежа: большой x, малый y (ось SVG вниз).
    expect(corner.box.x + corner.box.width).toBeCloseTo(corner.width, 1)
    expect(corner.box.y).toBeCloseTo(0, 1)
    expect(corner.box.x).toBeGreaterThan(corner.width * 0.85)
  })

  it('ось Y чертежа направлена вверх, а SVG вниз: набросок не перевёрнут', () => {
    // Точка с большим Y должна оказаться выше — то есть с меньшим y в SVG.
    const preview = layerPreview([line('L', [[0, 0], [0, 100], [100, 100]])], 'L')
    const [, firstY, , secondY] = numbers(preview!.paths[0])
    expect(firstY).toBeGreaterThan(secondY)
  })

  it('прореживает равномерно, а не берёт первые', () => {
    // Иначе набросок показал бы один угол площадки и соврал бы о её форме.
    const segments = Array.from({ length: 1000 }, (_, index) =>
      line('L', [[index, 0], [index, 1]]))
    const preview = layerPreview(segments, 'L', { maxSegments: 100 })
    expect(preview?.totalSegments).toBe(1000)
    expect(preview!.shownSegments).toBeLessThanOrEqual(100)
    // Первый и последний сегменты попали в набросок: значит взят весь размах.
    const xs = preview!.paths.map((path) => numbers(path)[0])
    expect(Math.min(...xs)).toBeLessThan(preview!.width * 0.05)
    expect(Math.max(...xs)).toBeGreaterThan(preview!.width * 0.95)
  })

  it('точки ближе полпикселя в разметку не идут, но линия доходит до конца', () => {
    // Горизонталь в 500 вершин на картинке в 80 точек ничем не отличается от
    // полусотни, а разметки требует в шестнадцать раз больше: на реальной
    // топооснове Станкевича это 1022 КБ против 129 КБ.
    const dense = {
      layer: 'L',
      points: Array.from({ length: 500 }, (_, index) => ({ x: index * 0.2, y: 0 })),
    }
    const preview = layerPreview([dense], 'L')!
    const values = numbers(preview.paths[0])
    expect(values.length / 2).toBeLessThan(300)
    expect(values.length / 2).toBeGreaterThan(100)
    // Первая и последняя вершины на месте: линия не укоротилась.
    expect(values[0]).toBe(0)
    expect(values[values.length - 2]).toBeCloseTo(preview.width, 1)
  })

  it('линия, целиком уместившаяся в полпикселя, не исчезает', () => {
    // Мелкий слой в общем кадре: все его точки сливаются, но линия должна
    // остаться — иначе слой выглядел бы пустым.
    const drawing = [line('ВСЁ', [[0, 0], [10000, 10000]]), line('L', [[1, 1], [2, 2]])]
    const preview = layerPreview(drawing, 'L', { extent: segmentsExtent(drawing) })!
    expect(preview.paths).toHaveLength(1)
    expect(numbers(preview.paths[0])).toHaveLength(4)
  })

  it('слой из одной прямой не делит на ноль', () => {
    const horizontal = layerPreview([line('L', [[0, 50], [100, 50]])], 'L')
    expect(numbers(horizontal!.paths[0]).every(Number.isFinite)).toBe(true)
    expect(horizontal?.spanYM).toBe(0)
    const vertical = layerPreview([line('L', [[50, 0], [50, 100]])], 'L')
    expect(numbers(vertical!.paths[0]).every(Number.isFinite)).toBe(true)
    expect(vertical?.spanXM).toBe(0)
  })

  it('вырожденный кадр всего чертежа не делит на ноль', () => {
    const drawing = [line('L', [[10, 10], [10, 10.0000001]])]
    const preview = layerPreview(drawing, 'L', { extent: segmentsExtent(drawing) })
    expect(numbers(preview!.paths[0]).every(Number.isFinite)).toBe(true)
    expect(Number.isFinite(preview!.box.width)).toBe(true)
  })

  it('слой без линий наброска не даёт', () => {
    expect(layerPreview([], 'L')).toBeNull()
    expect(layerPreview([line('L', [[0, 0]])], 'L')).toBeNull()
    expect(layerPreview([line('ДРУГОЙ', [[0, 0], [1, 1]])], 'L')).toBeNull()
  })

  it('линия из одной годной точки и мусора не считается линией', () => {
    // Две точки в записи, но рисовать нечего: путь из одной точки — не линия.
    const broken = { layer: 'L', points: [{ x: Number.NaN, y: 0 }, { x: 5, y: 5 }] }
    expect(layerPreview([broken], 'L')).toBeNull()
  })

  it('нечисловые координаты не ломают габарит', () => {
    const broken = {
      layer: 'L',
      points: [{ x: Number.NaN, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 100 }],
    }
    const preview = layerPreview([broken], 'L')
    expect(preview?.spanXM).toBe(100)
    expect(preview!.paths[0]).not.toContain('NaN')
  })

  it('весь набросок укладывается в картинку', () => {
    const preview = layerPreview([
      line('L', [[-500, -300], [700, 900]]),
      line('L', [[0, 0], [123.456, 654.321]]),
    ], 'L')!
    for (const path of preview.paths) {
      const values = numbers(path)
      for (let index = 0; index < values.length; index += 2) {
        expect(values[index]).toBeGreaterThanOrEqual(-0.05)
        expect(values[index]).toBeLessThanOrEqual(preview.width + 0.05)
        expect(values[index + 1]).toBeGreaterThanOrEqual(-0.05)
        expect(values[index + 1]).toBeLessThanOrEqual(preview.height + 0.05)
      }
    }
  })
})

describe('габарит чертежа', () => {
  it('без годных точек габарита нет', () => {
    expect(segmentsExtent([])).toBeNull()
    expect(segmentsExtent([{ points: [{ x: Number.NaN, y: Number.NaN }] }])).toBeNull()
  })

  it('считает по всем слоям', () => {
    expect(segmentsExtent([
      line('A', [[0, 0], [10, 10]]),
      line('B', [[-5, 3], [4, 40]]),
    ])).toEqual({ minX: -5, minY: 0, maxX: 10, maxY: 40 })
  })
})
