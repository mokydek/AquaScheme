import { describe, expect, it } from 'vitest'
import type { DxfNetworkData } from './dxfread'
import { extractExistingUtilities, suggestMainDepthThreshold } from './existing-utilities'

function survey(
  texts: Array<[number, number, string, string?]>,
  segments: DxfNetworkData['segments'] = [],
): DxfNetworkData {
  return {
    ok: true,
    points: [],
    layers: [{ name: 'NAD_MКАНАЛИЗ', segments: 0, points: 0 }],
    segments,
    textEntities: texts.map(([x, y, text, layer]) => ({ x, y, text, layer: layer ?? 'NAD_MКАНАЛИЗ' })),
  }
}

const line = (layer: string, a: [number, number], b: [number, number]) =>
  ({ layer, points: [{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }] })

describe('existing utilities recovered from survey annotation', () => {
  it('pairs rim and invert labels into chambers with a depth', () => {
    const result = extractExistingUtilities(survey([
      [-224.15, 8115.31, '685.21'],
      [-224.22, 8113.91, '682.30'],
      [-88.12, 8065.71, '685.86'],
      [-88.28, 8064.42, '682.06'],
    ]))
    expect(result.manholes).toHaveLength(2)
    expect(result.manholes[0].rimElevationM).toBe(685.21)
    expect(result.manholes[0].invertElevationM).toBe(682.30)
    expect(result.manholes[0].depthM).toBeCloseTo(2.91, 2)
  })

  it('reads material and bore from the run caption', () => {
    const result = extractExistingUtilities(survey([
      [-220.54, 8101.68, 'кер.300'],
      [-39.78, 8054.78, 'кер.150'],
      [-6.23, 8016.35, 'чуг 200'],
      [0, 8000, 'пэ.160'],
      [5, 8000, 'а/ц 150'],
    ]))
    expect(result.pipeLabels.map((label) => [label.material, label.diameterMm])).toEqual([
      ['керамика', 300], ['керамика', 150], ['чугун', 200],
      ['полиэтилен', 160], ['асбестоцемент', 150],
    ])
  })

  it('does not read two unrelated spot heights as a chamber', () => {
    // Same elevation twice: no depth, so no chamber.
    const flat = extractExistingUtilities(survey([[0, 0, '686.10'], [1, 0, '686.10']]))
    expect(flat.manholes).toHaveLength(0)
    // Far apart: different chambers, not a pair.
    const distant = extractExistingUtilities(survey([[0, 0, '686.10'], [40, 0, '682.10']]))
    expect(distant.manholes).toHaveLength(0)
    // Implausibly deep for a gravity manhole caption.
    const deep = extractExistingUtilities(survey([[0, 0, '686.10'], [1, 0, '650.10']]))
    expect(deep.manholes).toHaveLength(0)
  })

  it('orders the chain along the flow, starting at the highest invert', () => {
    const result = extractExistingUtilities(survey([
      [0, 0, '690.00'], [0, 1, '687.00'],
      [50, 0, '689.00'], [50, 1, '686.00'],
      [100, 0, '688.00'], [100, 1, '685.00'],
    ]))
    expect(result.chain.map((m) => m.invertElevationM)).toEqual([687, 686, 685])
    expect(result.chainLengthM).toBeCloseTo(100, 0)
  })

  it('breaks the run at an implausible jump instead of stitching branches', () => {
    // Three chambers 40 m apart, then one 400 m away: a different branch.
    const result = extractExistingUtilities(survey([
      [0, 0, '690.00'], [0, 1, '687.00'],
      [40, 0, '689.00'], [40, 1, '686.50'],
      [80, 0, '688.00'], [80, 1, '686.00'],
      [480, 0, '687.00'], [480, 1, '685.00'],
    ]))
    expect(result.manholes).toHaveLength(4)
    expect(result.chain).toHaveLength(3)
    expect(result.detachedCount).toBe(1)
    expect(result.maxStepM).toBeLessThan(100)
    expect(result.reason).toContain('вне цепочки')
  })

  it('сшивает трассу через поворот, а не бросает камеры за ним', () => {
    // Г-образная трасса по двум улицам: сначала вдоль X, затем вдоль Y. Лоток
    // вдоль неё падает не строго — у камеры на повороте отметка выше, чем у
    // предыдущей, как и бывает на реальной съёмке. Обход строго вниз по лотку
    // на такой камере обрывался, и всё, что за поворотом, в порядок вообще не
    // попадало: на объекте так терялось 6 камер из 17.
    const result = extractExistingUtilities(survey([
      [0, 0, '690.00'], [0, 1, '686.00'],
      [40, 0, '689.50'], [40, 1, '685.60'],
      [80, 0, '689.00'], [80, 1, '685.90'],
      [80, 40, '688.50'], [81, 40, '685.20'],
      [80, 80, '688.00'], [81, 80, '684.80'],
    ]))
    expect(result.manholes).toHaveLength(5)
    expect(result.chain).toHaveLength(5)
    expect(result.detachedCount).toBe(0)
    // Ни одного скачка через квартал: шаг остаётся уличным.
    expect(result.maxStepM).toBeLessThan(45)
  })

  it('голова цепочки — верховой конец, а не произвольный', () => {
    const result = extractExistingUtilities(survey([
      [0, 0, '690.00'], [0, 1, '686.00'],
      [40, 0, '689.00'], [40, 1, '685.00'],
      [80, 0, '688.00'], [80, 1, '684.00'],
    ]))
    expect(result.chain[0].invertElevationM).toBeGreaterThan(
      result.chain[result.chain.length - 1].invertElevationM)
  })


  it('врезки отделяются от магистрали по заданной инженером глубине', () => {
    // Мелкая камера между магистральными — врезка: попав в цепочку, она
    // удлиняет трассу и сбивает шаг между колодцами, а на плане встаёт как
    // магистральная. Порог задаёт инженер: съёмка сама их не различает.
    const survey5 = survey([
      [0, 0, '690.00'], [0, 1, '686.00'],
      [40, 0, '689.00'], [40, 1, '687.20'],
      [80, 0, '688.00'], [80, 1, '684.00'],
    ])
    const asIs = extractExistingUtilities(survey5)
    expect(asIs.chain).toHaveLength(3)
    expect(asIs.laterals).toHaveLength(0)

    const filtered = extractExistingUtilities(survey5, /канализ/i, { minMainDepthM: 2.5 })
    expect(filtered.manholes).toHaveLength(3)
    expect(filtered.chain).toHaveLength(2)
    expect(filtered.laterals).toHaveLength(1)
    expect(filtered.laterals[0].depthM).toBeCloseTo(1.8, 2)
    expect(filtered.reason).toContain('отнесено к врезкам')
  })

  it('без порога ни одна камера врезкой не считается', () => {
    const result = extractExistingUtilities(survey([
      [0, 0, '690.00'], [0, 1, '689.30'],
      [40, 0, '689.00'], [40, 1, '685.00'],
      [80, 0, '688.00'], [80, 1, '684.00'],
    ]))
    expect(result.laterals).toEqual([])
    expect(result.chain).toHaveLength(3)
  })


  it('границы объекта обрезают цепочку по номерам концевых колодцев', () => {
    // Съёмка шире объекта: границы заданы техническими условиями и в чертеже
    // ничем не отмечены. На ул. Станкевича крайняя камера лежала за концом
    // трассы, и длина выходила 483,4 м против 458,94 по документам.
    const four = survey([
      [0, 0, '690.00'], [0, 1, '686.00'],
      [40, 0, '689.00'], [40, 1, '685.00'],
      [80, 0, '688.00'], [80, 1, '684.00'],
      [120, 0, '687.00'], [120, 1, '683.00'],
    ])
    const whole = extractExistingUtilities(four)
    expect(whole.chain).toHaveLength(4)
    expect(whole.chainLengthM).toBeCloseTo(120, 0)
    expect(whole.outsideBounds).toEqual([])

    const bounded = extractExistingUtilities(four, /канализ/i, { firstChamber: 1, lastChamber: 3 })
    expect(bounded.chain).toHaveLength(3)
    expect(bounded.chainLengthM).toBeCloseTo(80, 0)
    expect(bounded.outsideBounds).toHaveLength(1)
    expect(bounded.reason).toContain('за границами объекта')
    // Камера за границей остаётся измеренным фактом, а не исчезает.
    expect(bounded.manholes).toHaveLength(4)
  })

  it('бессмысленные границы не обрезают ничего', () => {
    const three = survey([
      [0, 0, '690.00'], [0, 1, '686.00'],
      [40, 0, '689.00'], [40, 1, '685.00'],
      [80, 0, '688.00'], [80, 1, '684.00'],
    ])
    // Конец раньше начала: обрезать по такому нельзя, цепочка остаётся целой.
    expect(extractExistingUtilities(three, /канализ/i, { firstChamber: 3, lastChamber: 1 }).chain)
      .toHaveLength(3)
    // Номер за пределом цепочки не создаёт пустоты.
    expect(extractExistingUtilities(three, /канализ/i, { lastChamber: 99 }).chain).toHaveLength(3)
  })


  it('камера переносится с подписи на объект по выноске', () => {
    // Отметки подписывают сбоку от колодца и соединяют выноской: подпись стоит
    // там, где для неё есть место. Пока координатой служила позиция подписи,
    // каждая вершина трассы несла сдвиг в несколько метров, и ломаная выходила
    // длиннее настоящей — на ул. Станкевича трасса удлинялась на 4,9 м.
    const result = extractExistingUtilities(survey(
      [
        [0, 0, '690.00'], [0, 1, '686.00'],
        // Подпись отнесена на 3 м вбок от трубы, к ней ведёт выноска.
        [40, 3, '689.00'], [40, 4, '685.00'],
        [80, 0, '688.00'], [80, 1, '684.00'],
      ],
      [
        line('SIT_LКАНАЛИЗ', [0, 0], [40, 0]),
        line('SIT_LКАНАЛИЗ', [40, 0], [80, 0]),
        line('NAD_MКАНАЛИЗ', [40, 3], [40, 0]),
      ],
    ))
    const middle = result.chain[1]
    expect(middle.y).toBeCloseTo(0, 2)
    expect(result.chainLengthM).toBeCloseTo(80, 1)
  })

  it('без линий сети и без выноски позиция остаётся прежней', () => {
    // Гадать, в какую сторону сдвигать камеру, нельзя.
    const bare = extractExistingUtilities(survey([
      [40, 3, '689.00'], [40, 4, '685.00'],
    ]))
    expect(bare.manholes[0].y).toBeCloseTo(3, 2)

    const noLeader = extractExistingUtilities(survey(
      [[40, 3, '689.00'], [40, 4, '685.00']],
      [line('SIT_LКАНАЛИЗ', [0, 0], [80, 0])],
    ))
    expect(noLeader.manholes[0].y).toBeCloseTo(3, 2)
  })

  it('ignores annotation of other utilities', () => {
    const result = extractExistingUtilities(survey([
      [0, 0, '685.00', 'NAD_MТЕПЛОТР'],
      [0, 1, '682.00', 'NAD_MТЕПЛОТР'],
      [10, 0, 'кер.300', 'NAD_MВОДОПРО'],
    ]))
    expect(result.manholes).toHaveLength(0)
    expect(result.pipeLabels).toHaveLength(0)
    expect(result.reason).toContain('не найдены')
  })
})

describe('порог врезок выводится из самих данных', () => {
  const chamber = (depthM: number) => ({ x: 0, y: 0, rimElevationM: 690, invertElevationM: 690 - depthM, depthM })

  it('находит разрыв между двумя кучками глубин', () => {
    // Так распределены глубины на реальном объекте: три врезки и магистраль.
    const found = suggestMainDepthThreshold(
      [1.70, 1.75, 2.06, 2.91, 2.97, 3.44, 3.50, 3.60, 3.62, 3.64, 3.69, 3.80, 3.84, 3.96, 4.04, 4.47, 4.50]
        .map(chamber))
    expect(found?.lateralCount).toBe(3)
    expect(found?.minMainDepthM).toBeCloseTo(2.49, 2)
    expect(found?.gapM).toBeCloseTo(0.85, 2)
    expect(found?.reason).toContain('2.06')
  })

  it('ровный ряд порога не даёт: две кучки надо ещё увидеть', () => {
    // Глубины идут с равным шагом — врезок здесь нет, и выдумывать границу
    // нельзя: выдуманный порог хуже отсутствующего.
    const even = Array.from({ length: 12 }, (_, index) => chamber(3 + index * 0.1))
    expect(suggestMainDepthThreshold(even)).toBeNull()
  })

  it('разрыв посередине выборки врезками не считается', () => {
    // Половина камер мельче другой половины — это разные глубины заложения,
    // а не врезки: их обычно единицы.
    const halves = [...Array.from({ length: 6 }, () => chamber(1.5)),
      ...Array.from({ length: 6 }, () => chamber(4.0))]
    expect(suggestMainDepthThreshold(halves)).toBeNull()
  })

  it('на малой выборке не гадает', () => {
    expect(suggestMainDepthThreshold([1.7, 4.0, 4.1].map(chamber))).toBeNull()
  })

  it('без ввода инженера врезки отделяются сами, и основание видно', () => {
    const survey5 = survey([
      [0, 0, '690.00'], [0, 1, '686.00'],
      [40, 0, '689.00'], [40, 1, '685.00'],
      [80, 0, '688.00'], [80, 1, '684.00'],
      [120, 0, '687.00'], [120, 1, '683.10'],
      [160, 0, '686.00'], [160, 1, '682.10'],
      [200, 0, '685.00'], [200, 1, '684.30'],
    ])
    const auto = extractExistingUtilities(survey5)
    expect(auto.depthThreshold).not.toBeNull()
    expect(auto.laterals).toHaveLength(1)
    expect(auto.reason).toContain('порог выведен из данных')
  })

  it('заданный инженером порог предложенный не перебивается', () => {
    const survey5 = survey([
      [0, 0, '690.00'], [0, 1, '686.00'],
      [40, 0, '689.00'], [40, 1, '685.00'],
      [80, 0, '688.00'], [80, 1, '684.00'],
      [120, 0, '687.00'], [120, 1, '683.10'],
      [160, 0, '686.00'], [160, 1, '682.10'],
      [200, 0, '685.00'], [200, 1, '684.30'],
    ])
    // Порог инженера 1,0 м отсекает камеру глубиной 0,70 — то же, что нашла бы
    // программа, но по решению человека, и в основании это так и сказано.
    const manual = extractExistingUtilities(survey5, /канализ/i, { minMainDepthM: 1.0 })
    expect(manual.depthThreshold).toBeNull()
    expect(manual.laterals).toHaveLength(1)
    expect(manual.reason).toContain('порог задан инженером')
  })
})
