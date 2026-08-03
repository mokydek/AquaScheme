import { describe, expect, it } from 'vitest'
import { contourStepFor, contoursFromSurvey, triangulateSurvey, type TerrainPoint } from './contours'

/** Ровный скат: z растёт по x, значит горизонтали — прямые вдоль y. */
function slope(step = 10, size = 5): TerrainPoint[] {
  const points: TerrainPoint[] = []
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) points.push({ x: i * step, y: j * step, z: 100 + i * 0.5 })
  }
  return points
}

/** Конус: отметка падает от центра — горизонтали замкнутые. */
function cone(): TerrainPoint[] {
  const points: TerrainPoint[] = []
  for (let i = -6; i <= 6; i++) {
    for (let j = -6; j <= 6; j++) {
      points.push({ x: i * 5, y: j * 5, z: 110 - Math.hypot(i * 5, j * 5) * 0.2 })
    }
  }
  return points
}

describe('сечение рельефа', () => {
  it('выбирается по перепаду отметок', () => {
    expect(contourStepFor(4)).toBe(0.5)
    expect(contourStepFor(12)).toBe(1)
    expect(contourStepFor(30)).toBe(2)
  })
})

describe('триангуляция съёмки', () => {
  it('покрывает площадку: треугольников примерно вдвое больше точек', () => {
    const points = slope()
    const tris = triangulateSurvey(points)
    // Для 25 точек сетки 5×5 разбиение квадратов даёт ровно 32 треугольника.
    expect(tris).toHaveLength(32)
  })

  it('совпадающие в плане точки не вырождают окружность', () => {
    const points = [...slope(10, 3), { x: 0, y: 0, z: 101 }]
    expect(() => triangulateSurvey(points)).not.toThrow()
    expect(triangulateSurvey(points).length).toBeGreaterThan(0)
  })

  it('точки на одной прямой треугольников не дают', () => {
    expect(triangulateSurvey([
      { x: 0, y: 0, z: 1 }, { x: 10, y: 0, z: 2 }, { x: 20, y: 0, z: 3 },
    ])).toHaveLength(0)
  })

  it('индексы возвращаются в исходном массиве', () => {
    const points = slope(10, 3)
    for (const t of triangulateSurvey(points)) {
      for (const i of [t.a, t.b, t.c]) {
        expect(i).toBeGreaterThanOrEqual(0)
        expect(i).toBeLessThan(points.length)
      }
    }
  })
})

describe('горизонтали по съёмке', () => {
  it('на ровном скате идут прямыми поперёк уклона', () => {
    // Перепад 2 м на 5 столбцов → сечение 0,5 м, уровни 100.5…101.5.
    const result = contoursFromSurvey(slope())
    expect(result.stepM).toBe(0.5)
    expect(result.zMinM).toBe(100)
    expect(result.zMaxM).toBe(102)
    expect(result.lines.map((l) => l.levelM).sort()).toEqual([100.5, 101, 101.5])

    const at101 = result.lines.filter((l) => l.levelM === 101)
    expect(at101).toHaveLength(1)
    // z = 101 при x = 20 — линия должна стоять ровно там по всей высоте.
    for (const p of at101[0].points) expect(p.x).toBeCloseTo(20, 6)
    expect(Math.min(...at101[0].points.map((p) => p.y))).toBeCloseTo(0, 6)
    expect(Math.max(...at101[0].points.map((p) => p.y))).toBeCloseTo(40, 6)
    expect(at101[0].closed).toBe(false)
  })

  it('точно ложится на поверхность, а не приближает её', () => {
    // Наклонная плоскость: отметка каждой точки горизонтали обязана совпасть
    // с её сечением до счётной погрешности. Сеточная интерполяция такого не
    // даёт — она сглаживает.
    const points: TerrainPoint[] = []
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        points.push({ x: i * 10, y: j * 10, z: 100 + 0.037 * i * 10 + 0.021 * j * 10 })
      }
    }
    const result = contoursFromSurvey(points)
    expect(result.lines.length).toBeGreaterThan(0)
    for (const line of result.lines) {
      for (const p of line.points) {
        expect(100 + 0.037 * p.x + 0.021 * p.y).toBeCloseTo(line.levelM, 9)
      }
    }
  })

  it('не сглаживает одиночный провал — вокруг него замыкается горизонталь', () => {
    // Скат с одной вдавленной пикетной отметкой: измерение должно остаться
    // на плане, а не раствориться в поверхности.
    const points = slope().map((p, i) => ({ ...p, z: i === 12 ? 99 : p.z + 0.2 }))
    const result = contoursFromSurvey(points)
    const rings = result.lines.filter((l) => l.closed && l.levelM === 100)
    expect(rings).toHaveLength(1)
    // Кольцо должно охватывать сам провал — точку (20, 20).
    expect(Math.min(...rings[0].points.map((p) => p.x))).toBeLessThan(20)
    expect(Math.max(...rings[0].points.map((p) => p.x))).toBeGreaterThan(20)
    expect(Math.min(...rings[0].points.map((p) => p.y))).toBeLessThan(20)
    expect(Math.max(...rings[0].points.map((p) => p.y))).toBeGreaterThan(20)
  })

  it('на конусе даёт замкнутые линии', () => {
    const result = contoursFromSurvey(cone())
    const closed = result.lines.filter((l) => l.closed)
    expect(closed.length).toBeGreaterThan(0)
    const ring = closed[0]
    expect(ring.points[0].x).toBeCloseTo(ring.points[ring.points.length - 1].x, 6)
    expect(ring.points[0].y).toBeCloseTo(ring.points[ring.points.length - 1].y, 6)
  })

  it('каждая пятая помечается утолщённой', () => {
    const result = contoursFromSurvey(cone(), { stepM: 0.5 })
    const indexed = result.lines.filter((l) => l.index).map((l) => l.levelM)
    // Кратные 2,5 м при сечении 0,5 м.
    for (const level of indexed) expect(Math.round(level * 10) % 25).toBe(0)
    expect(indexed.length).toBeGreaterThan(0)
  })

  it('не проводит горизонталь через неснятый разрыв', () => {
    // Две полосы съёмки, между ними 200 м без единой отметки.
    const points = [...slope(10, 5), ...slope(10, 5).map((p) => ({ ...p, x: p.x + 240 }))]
    const result = contoursFromSurvey(points)
    expect(result.skippedTriangles).toBeGreaterThan(0)
    expect(result.reason).toContain('неснятые участки')
    // Ни одна линия не должна пересекать пустоту между полосами.
    for (const line of result.lines) {
      for (const p of line.points) expect(p.x < 45 || p.x > 235).toBe(true)
    }
  })

  it('порог длины ребра можно задать явно', () => {
    const points = [...slope(10, 5), ...slope(10, 5).map((p) => ({ ...p, x: p.x + 240 }))]
    const wide = contoursFromSurvey(points, { maxEdgeM: 1000 })
    expect(wide.skippedTriangles).toBe(0)
    expect(wide.maxEdgeM).toBe(1000)
  })

  it('на плоской площадке горизонталей нет, и это сказано прямо', () => {
    const flat = slope().map((p) => ({ ...p, z: 100 }))
    const result = contoursFromSurvey(flat)
    expect(result.lines).toHaveLength(0)
    expect(result.reason).toContain('меньше половины сечения')
  })

  it('меньше трёх точек — поверхности нет', () => {
    const result = contoursFromSurvey([{ x: 0, y: 0, z: 1 }, { x: 1, y: 1, z: 2 }])
    expect(result.lines).toHaveLength(0)
    expect(result.reason).toContain('меньше трёх')
  })

  it('нечисловые отметки отбрасываются, а не ломают расчёт', () => {
    const points = [...slope(), { x: 5, y: 5, z: Number.NaN }]
    const result = contoursFromSurvey(points)
    expect(result.lines.length).toBeGreaterThan(0)
    expect(Number.isFinite(result.zMaxM)).toBe(true)
  })

  it('линия не рвётся на стыке треугольников', () => {
    // Каждый узел цепочки, кроме концов, должен встречаться один раз:
    // повтор означал бы, что отрезок пришит дважды.
    const result = contoursFromSurvey(cone())
    for (const line of result.lines) {
      const keys = line.points.map((p) => `${p.x.toFixed(6)}|${p.y.toFixed(6)}`)
      const body = line.closed ? keys.slice(0, -1) : keys
      expect(new Set(body).size).toBe(body.length)
    }
  })
})
