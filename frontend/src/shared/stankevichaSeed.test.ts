import { describe, expect, it, vi } from 'vitest'
import { STANKEVICHA_CHAMBERS, STANKEVICHA_CONDITIONS, stankevichaChainLengthM } from './stankevichaDemo'

// Модуль тянет клиент базы, а он требует переменных окружения, которых в тесте
// нет. Проверяется чистая сборка сети, до базы дело не доходит.
vi.mock('./supabase', () => ({ supabase: {} }))

const { buildStankevichaNetwork } = await import('./stankevichaSeed')

describe('сеть объекта для загрузки в проект', () => {
  const network = buildStankevichaNetwork()

  it('узел на каждую камеру, труба между соседними', () => {
    expect(network.nodes).toHaveLength(STANKEVICHA_CHAMBERS.length)
    expect(network.pipes).toHaveLength(STANKEVICHA_CHAMBERS.length - 1)
  })

  it('низовой конец помечен выпуском: по нему конвейер считает сток', () => {
    expect(network.nodes.filter((node) => node.kind === 'outlet')).toHaveLength(1)
    expect(network.nodes[network.nodes.length - 1].kind).toBe('outlet')
  })

  it('трубы связаны в цепочку без разрывов', () => {
    for (let i = 0; i < network.pipes.length; i++) {
      expect(network.pipes[i].fromNode).toBe(network.nodes[i].id)
      expect(network.pipes[i].toNode).toBe(network.nodes[i + 1].id)
    }
  })

  it('сумма длин труб равна длине цепочки, а не расходится с ней', () => {
    // Иначе ведомость и план показывали бы разные числа на одних данных.
    const total = network.pipes.reduce((sum, pipe) => sum + (pipe.lengthM ?? 0), 0)
    expect(total).toBeCloseTo(stankevichaChainLengthM(), 0)
  })

  it('диаметр везде из технических условий, а не подобран', () => {
    expect([...new Set(network.pipes.map((pipe) => pipe.diameterMm))])
      .toEqual([STANKEVICHA_CONDITIONS.designDiameterMm])
  })
})
