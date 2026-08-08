import { describe, expect, it } from 'vitest'
import { createDemoDataset } from './demo'
import { interpolateElevation, traceNetwork } from './trace'
import type { TracedNetwork } from './trace'

function reachableCount(network: TracedNetwork): number {
  const adjacency = new Map<string, string[]>()
  for (const pipe of network.pipes) {
    adjacency.set(pipe.fromNode, [...(adjacency.get(pipe.fromNode) ?? []), pipe.toNode])
    adjacency.set(pipe.toNode, [...(adjacency.get(pipe.toNode) ?? []), pipe.fromNode])
  }
  const seen = new Set<string>(['SRC'])
  const queue = ['SRC']
  while (queue.length > 0) {
    const current = queue.pop() as string
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen.size
}

describe('interpolateElevation', () => {
  const points = [
    { x: 0, y: 0, z: 100 },
    { x: 10, y: 0, z: 110 },
    { x: 0, y: 10, z: 100 },
    { x: 10, y: 10, z: 110 },
  ]

  it('returns the exact value at a survey point', () => {
    expect(interpolateElevation(points, 10, 0)).toBe(110)
  })

  it('interpolates between points', () => {
    const z = interpolateElevation(points, 5, 5)
    expect(z).toBeGreaterThan(100)
    expect(z).toBeLessThan(110)
  })

  it('без съёмки отвечает null, а не нулём', () => {
    // Раньше здесь ожидался 0 — проверка закрепляла как правильное ровно ту
    // подстановку, из-за которой профиль по ул. Станкевича рисовал «Земля
    // 0.00» у всех колодцев. Ноль сам по себе законная отметка, поэтому
    // «не определено» выражается типом, а не значением.
    expect(interpolateElevation([], 5, 5)).toBeNull()
  })
})

describe('traceNetwork on the demo district', () => {
  const demo = createDemoDataset()
  const buildings = demo.buildings.map((b, i) => ({ id: `bld-${i}`, x: b.x, y: b.y }))
  const network = traceNetwork(buildings, demo.source, demo.surveyPoints)

  it('creates one source and a building node per building', () => {
    expect(network.nodes.filter((n) => n.kind === 'source')).toHaveLength(1)
    expect(network.nodes.filter((n) => n.kind === 'building')).toHaveLength(40)
  })

  it('builds a closed ring', () => {
    const ringNodes = network.nodes.filter((n) => n.kind === 'ring')
    const ringPipes = network.pipes.filter((p) => p.kind === 'ring')
    expect(ringNodes.length).toBeGreaterThanOrEqual(4)
    expect(ringPipes.length).toBe(ringNodes.length)
  })

  it('adds a cross main for the inner rows', () => {
    expect(network.pipes.some((p) => p.kind === 'cross')).toBe(true)
  })

  it('gives every building exactly one service pipe', () => {
    const services = network.pipes.filter((p) => p.kind === 'service')
    expect(services).toHaveLength(40)
    const targets = new Set(services.map((p) => p.toNode))
    expect(targets.size).toBe(40)
  })

  it('produces a fully connected network', () => {
    expect(reachableCount(network)).toBe(network.nodes.length)
  })

  it('assigns terrain elevations to all nodes', () => {
    for (const node of network.nodes) {
      expect(node.groundElevation).toBeGreaterThan(90)
      expect(node.groundElevation).toBeLessThan(110)
    }
  })

  it('has positive lengths that sum to the total', () => {
    for (const pipe of network.pipes) expect(pipe.lengthM).toBeGreaterThan(0)
    const sum = network.pipes.reduce((s, p) => s + p.lengthM, 0)
    expect(network.totalLengthM).toBeCloseTo(sum, 1)
  })

  it('is deterministic', () => {
    expect(traceNetwork(buildings, demo.source, demo.surveyPoints)).toEqual(network)
  })
})

describe('traceNetwork edge cases', () => {
  it('routes dead end mains for fewer than three buildings', () => {
    const network = traceNetwork(
      [
        { id: 'a', x: 100, y: 0 },
        { id: 'b', x: 0, y: 100 },
      ],
      { x: 0, y: 0 },
      [],
    )
    expect(network.pipes).toHaveLength(2)
    expect(network.pipes.every((p) => p.kind === 'supply')).toBe(true)
    expect(reachableCount(network)).toBe(network.nodes.length)
  })

  it('returns only the source for an empty building list', () => {
    const network = traceNetwork([], { x: 0, y: 0 }, [])
    expect(network.nodes).toHaveLength(1)
    expect(network.pipes).toHaveLength(0)
  })
})
